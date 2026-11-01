const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;
const shortcuts = window.__TAURI__.globalShortcut;

const $ = (id) => document.getElementById(id);
const appWindow = getCurrentWindow();

/* =====================================================================
   DEFAULT HOTKEYS — change these here, or click the small hotkey label
   under START / STOP inside the app to record a new combination.
   ===================================================================== */
const DEFAULT_START_KEY = "Q";
const DEFAULT_STOP_KEY = "Q";   // same key as START = it toggles

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let running = false;
const hotkeys = {
  start: store.get("hotkey-start", DEFAULT_START_KEY),
  stop: store.get("hotkey-stop", DEFAULT_STOP_KEY),
};

/* ---------- Native-feeling behaviour ---------- */
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());
window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
});
appWindow.onFocusChanged(({ payload: focused }) => {
  document.body.classList.toggle("inactive", !focused);
  if (!focused) closeMenu();
});

/* ---------- Window chrome ---------- */
$("btn-close").addEventListener("click", () => appWindow.close());
$("btn-min").addEventListener("click", () => appWindow.minimize());

/* ---------- Themes (the stripes) ---------- */
const THEMES = {
  blue:   { bg: "#0a7aff", deep: "#064e9e", fg: "#ffffff", btnFg: "#ffffff", dim: "#0c63c9", info: "#4fc3ff", panel: "rgba(0,0,0,.55)" },
  purple: { bg: "#5e5ce6", deep: "#3b39a8", fg: "#ffffff", btnFg: "#ffffff", dim: "#4a48c0", info: "#d6d5ff", panel: "rgba(0,0,0,.55)" },
  red:    { bg: "#ff453a", deep: "#a8231a", fg: "#ffffff", btnFg: "#ffffff", dim: "#d9372d", info: "#ffd9d6", panel: "rgba(0,0,0,.55)" },
  orange: { bg: "#ff9f0a", deep: "#9c5f00", fg: "#ffffff", btnFg: "#ffffff", dim: "#d98606", info: "#ffe8bd", panel: "rgba(0,0,0,.55)" },
  yellow: { bg: "#ffd60a", deep: "#8a7200", fg: "#1c1c1e", btnFg: "#ffffff", dim: "#c9a700", info: "#fff3b0", panel: "rgba(0,0,0,.55)" },
  green:  { bg: "#30d158", deep: "#177a31", fg: "#ffffff", btnFg: "#ffffff", dim: "#28ad48", info: "#d3ffe0", panel: "rgba(0,0,0,.55)" },
  black:  { bg: "#1c1c1e", deep: "#3a3a3c", fg: "#f2f2f7", btnFg: "#ffffff", dim: "#636366", info: "#64d2ff", panel: "rgba(0,0,0,.55)" },
  white:  { bg: "#f2f2f7", deep: "#c7c7cc", fg: "#1c1c1e", btnFg: "#1c1c1e", dim: "#aeaeb2", info: "#d6e8ff", panel: "rgba(0,0,0,.55)" },
};
let theme = THEMES[store.get("theme", "blue")] ? store.get("theme", "blue") : "blue";

function applyTheme(name) {
  const t = THEMES[name];
  const root = document.documentElement.style;
  root.setProperty("--bg", t.bg);
  root.setProperty("--deep", t.deep);
  root.setProperty("--fg", t.fg);
  root.setProperty("--btn-fg", t.btnFg);
  root.setProperty("--dim", t.dim);
  root.setProperty("--info", t.info);
  root.setProperty("--panel", t.panel);
  theme = name;
  store.set("theme", name);
}
document.querySelectorAll(".stripe").forEach((s) =>
  s.addEventListener("click", () => {
    const name = s.dataset.theme;
    applyTheme(name === theme ? "blue" : name); // clicking the active stripe resets to blue
  })
);
applyTheme(theme);

/* ---------- Inputs ---------- */
const numericIds = ["interval", "clicks", "repeat", "delay"];
const num = (id) => Math.max(0, parseInt($(id).value, 10) || 0);

function autosize(input) {
  input.style.width = Math.max(input.value.length, 1) + 0.6 + "ch";
}

numericIds.forEach((id) => {
  const el = $(id);
  el.value = store.get("v-" + id, el.value);
  el.addEventListener("input", () => {
    el.value = el.value.replace(/\D/g, "").slice(0, 9);
    autosize(el);
    refreshWords();
  });
  el.addEventListener("blur", () => {
    if (el.value === "") el.value = id === "repeat" || id === "delay" ? "0" : "1";
    autosize(el);
    refreshWords();
    store.set("v-" + id, el.value);
  });
  el.addEventListener("focus", () => el.select());
  autosize(el);
});

/* ---------- Pop-up menus (custom, macOS-style) ---------- */
const PICKS = {
  "unit-pick": [["1", "Millisecond(s)"], ["1000", "Second(s)"], ["60000", "Minute(s)"]],
  "button-pick": [["Left", "Left Mouse"], ["Middle", "Middle Mouse"], ["Right", "Right Mouse"]],
};
let openMenu = null; // { el, pick, items, index }

function setPick(pick, value) {
  const opts = PICKS[pick.id];
  const o = opts.find((x) => x[0] === value) || opts[0];
  pick.dataset.value = o[0];
  pick.querySelector(".pick-text").textContent = o[1];
  store.set("v-" + pick.id, o[0]);
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.el.remove();
  openMenu.pick.setAttribute("aria-expanded", "false");
  openMenu = null;
}

function highlight(i) {
  if (!openMenu) return;
  openMenu.index = (i + openMenu.items.length) % openMenu.items.length;
  openMenu.items.forEach((el, n) => el.classList.toggle("active", n === openMenu.index));
}

function openPickMenu(pick) {
  closeMenu();
  const win = document.querySelector(".window");
  const el = document.createElement("div");
  el.className = "menu";
  el.setAttribute("role", "listbox");

  const items = PICKS[pick.id].map(([value, label]) => {
    const item = document.createElement("div");
    item.className = "menu-item" + (value === pick.dataset.value ? " selected" : "");
    item.setAttribute("role", "option");
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.textContent = "✓";
    item.append(tick, document.createTextNode(label));
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      setPick(pick, value);
      closeMenu();
    });
    el.appendChild(item);
    return item;
  });

  win.appendChild(el);
  const w = win.getBoundingClientRect();
  const p = pick.getBoundingClientRect();
  el.style.left = p.left - w.left - 6 + "px";
  el.style.top = p.bottom - w.top + 8 + "px";
  el.style.minWidth = p.width + 12 + "px";

  openMenu = { el, pick, items, index: 0 };
  pick.setAttribute("aria-expanded", "true");
  highlight(Math.max(0, PICKS[pick.id].findIndex((x) => x[0] === pick.dataset.value)));
}

Object.keys(PICKS).forEach((id) => {
  const pick = $(id);
  setPick(pick, store.get("v-" + id, PICKS[id][0][0]));
  pick.addEventListener("click", () => (openMenu && openMenu.pick === pick ? closeMenu() : openPickMenu(pick)));
});

document.addEventListener("mousedown", (e) => {
  if (openMenu && !openMenu.el.contains(e.target) && !openMenu.pick.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (!openMenu) return;
  if (e.key === "Escape") closeMenu();
  else if (e.key === "ArrowDown") highlight(openMenu.index + 1);
  else if (e.key === "ArrowUp") highlight(openMenu.index - 1);
  else if (e.key === "Enter" || e.key === " ") {
    setPick(openMenu.pick, PICKS[openMenu.pick.id][openMenu.index][0]);
    closeMenu();
  } else return;
  e.preventDefault();
});

function refreshWords() {
  $("clicks-word").textContent = num("clicks") === 1 ? "time" : "times";
  $("repeat-word").textContent = num("repeat") === 1 ? "time" : "times";
  $("delay-word").textContent = num("delay") === 1 ? "second" : "seconds";
}
refreshWords();

function lockInputs(locked) {
  numericIds.forEach((id) => ($(id).disabled = locked));
  ["unit-pick", "button-pick"].forEach((id) => $(id).classList.toggle("locked", locked));
}

/* ---------- Time display ---------- */
const pad = (n, l = 2) => String(n).padStart(l, "0");
function fmt(ms) {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}

/* ---------- Start / stop ---------- */
function setRunning(value) {
  running = value;
  document.body.classList.toggle("running", value);
  $("start").disabled = value;
  $("stop").disabled = !value;
  lockInputs(value);
  if (!value) $("next-at").textContent = "—";
}

async function start() {
  if (running) return;
  const intervalMs = Math.max(1, num("interval") * Number($("unit-pick").dataset.value));
  const delayMs = num("delay") * 1000;
  const repeat = num("repeat"); // 0 = until stopped

  const settings = {
    intervalMs,
    button: $("button-pick").dataset.value,
    clicksPerPress: Math.max(1, num("clicks")),
    repeat: repeat > 0 ? repeat : null,
    delayMs,
  };

  const ok = await invoke("start_clicking", { settings });
  if (!ok) return;
  setRunning(true);
  $("final-at").textContent =
    repeat > 0 ? fmt(Date.now() + delayMs + (repeat - 1) * intervalMs) : "until stopped";
  $("next-at").textContent = fmt(Date.now() + delayMs);
}

async function stop() {
  if (!running) return;
  await invoke("stop_clicking");
  setRunning(false);
}

$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
listen("clicker-stopped", () => setRunning(false));
listen("next-press", (e) => ($("next-at").textContent = fmt(e.payload)));

/* ---------- Global hotkeys ---------- */
const pretty = (accel) => accel.replace("Control", "Ctrl").replace("Super", "Win").replace(/\+/g, " ");

function showHotkeys() {
  $("hk-start").textContent = pretty(hotkeys.start);
  $("hk-stop").textContent = pretty(hotkeys.stop);
}

async function registerHotkeys() {
  try {
    await shortcuts.unregisterAll();
    if (hotkeys.start === hotkeys.stop) {
      // same key for both = toggle
      await shortcuts.register(hotkeys.start, (e) => e.state === "Pressed" && (running ? stop() : start()));
    } else {
      await shortcuts.register(hotkeys.start, (e) => e.state === "Pressed" && start());
      await shortcuts.register(hotkeys.stop, (e) => e.state === "Pressed" && stop());
    }
  } catch (err) {
    console.error("Could not register hotkeys:", err);
  }
}

function keyName(e) {
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return e.code; // F1–F24, Space, ArrowUp, Numpad0 ...
}

function recordHotkey(which) {
  const btn = $("hk-" + which);
  btn.textContent = "Press keys…";
  btn.classList.add("recording");
  shortcuts.unregisterAll().catch(() => {}); // so the old combo can't fire while recording

  const finish = async () => {
    window.removeEventListener("keydown", onKey, true);
    btn.classList.remove("recording");
    showHotkeys();
    await registerHotkeys();
  };

  const onKey = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    if (e.key === "Escape") return finish();

    const parts = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    parts.push(keyName(e));
    const accel = parts.join("+");

    hotkeys[which] = accel;
    store.set("hotkey-" + which, accel);
    finish();
  };
  window.addEventListener("keydown", onKey, true);
}

$("hk-start").addEventListener("click", () => recordHotkey("start"));
$("hk-stop").addEventListener("click", () => recordHotkey("stop"));

showHotkeys();
registerHotkeys();
