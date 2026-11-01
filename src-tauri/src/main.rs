#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct ClickerState {
    running: Arc<AtomicBool>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    interval_ms: u64,
    button: String,
    clicks_per_press: u64,
    repeat: Option<u64>,
    delay_ms: u64,
}

#[cfg(windows)]
fn click(button: &str) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;

    let (down, up) = match button {
        "Right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "Middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
        _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    };

    let mut inputs: [INPUT; 2] = unsafe { std::mem::zeroed() };
    for (i, flag) in [down, up].into_iter().enumerate() {
        inputs[i].r#type = INPUT_MOUSE;
        inputs[i].Anonymous.mi = MOUSEINPUT {
            dx: 0,
            dy: 0,
            mouseData: 0,
            dwFlags: flag,
            time: 0,
            dwExtraInfo: 0,
        };
    }
    unsafe {
        SendInput(2, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(windows))]
fn click(_button: &str) {
    // Windows-only app; stub so the project still compiles elsewhere.
}

/// Sleep for `ms`, waking early if the clicker is stopped.
fn interruptible_sleep(running: &AtomicBool, ms: u64) {
    let deadline = Instant::now() + Duration::from_millis(ms);
    while running.load(Ordering::Relaxed) {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        std::thread::sleep((deadline - now).min(Duration::from_millis(5)));
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn start_clicking(app: AppHandle, state: State<ClickerState>, settings: Settings) -> bool {
    if state.running.swap(true, Ordering::SeqCst) {
        return false; // already running
    }
    let running = state.running.clone();

    std::thread::spawn(move || {
        // Initial "wait before starting" delay
        interruptible_sleep(&running, settings.delay_ms);

        let mut presses: u64 = 0;
        while running.load(Ordering::SeqCst) {
            for i in 0..settings.clicks_per_press.max(1) {
                click(&settings.button);
                if i + 1 < settings.clicks_per_press {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            presses += 1;

            if let Some(limit) = settings.repeat {
                if presses >= limit {
                    break;
                }
            }

            let _ = app.emit("next-press", now_ms() + settings.interval_ms);
            interruptible_sleep(&running, settings.interval_ms.max(1));
        }

        running.store(false, Ordering::SeqCst);
        let _ = app.emit("clicker-stopped", ());
    });

    true
}

#[tauri::command]
fn stop_clicking(state: State<ClickerState>) {
    state.running.store(false, Ordering::SeqCst);
}

fn main() {
    #[cfg(windows)]
    unsafe {
        // 1 ms timer resolution so short intervals are accurate
        windows_sys::Win32::Media::timeBeginPeriod(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(ClickerState::default())
        .invoke_handler(tauri::generate_handler![start_clicking, stop_clicking])
        .run(tauri::generate_context!())
        .expect("error while running OP Auto Clicker");
}
