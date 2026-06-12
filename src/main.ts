import { changePassword, fetchPads, login, uploadSound } from "./api/client.js";
import {
  audioContext,
  countdown,
  loadBuffer,
  isPlaying,
  onVoicesChange,
  resume,
  setBuffer,
  stop,
  stopAll,
  stopAllFade,
  trigger,
} from "./audio/engine.js";
import { computePeaks, formatTime } from "./audio/waveform.js";
import { buildGrid } from "./ui/grid.js";
import { renderPadContent, setPadState } from "./ui/pad.js";
import { attachKeyboard } from "./ui/keyboard.js";
import { createBottomBar, type BottomBar } from "./ui/bottombar.js";
import { createActiveList } from "./ui/activelist.js";
import { randomQuote } from "./quotes.js";
import { BANKS, getPad, padId, setPad, state } from "./state.js";

const el = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const loginOverlay = el<HTMLElement>("#login");
const loginForm = el<HTMLFormElement>("#login-form");
const loginInput = el<HTMLInputElement>("#login-password");
const loginError = el<HTMLElement>("#login-error");
const loginCancel = el<HTMLButtonElement>("#login-cancel");
const gridEl = el<HTMLElement>("#grid");
const bottomEl = el<HTMLElement>("#bottombar");
const quoteEl = el<HTMLElement>("#quote");
const banksEl = el<HTMLElement>("#banks");

let padEls = new Map<string, HTMLElement>();
let bottomBar: BottomBar;
let pendingUploadKey: string | null = null;
let editMode = false;
let started = false;

const PANIC_FADE_SECONDS = 1.2;
const PRELOAD_CONCURRENCY = 5;
const BANK_STORAGE_KEY = "rb_bank";

// Input de ficheiro oculto, reutilizado para subir/substituír.
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "audio/*";
fileInput.hidden = true;
document.body.appendChild(fileInput);

// ---------------------------------------------------------------------------
// Arranque: a app é usable SEN clave. A clave só activa o modo de edición.
// ---------------------------------------------------------------------------
init();

async function init() {
  // A app arranca SEMPRE en modo uso (sen clave). Para editar hai que premer
  // "Modificar" e introducir a clave; así o alumnado non pode modificar nada.
  registerServiceWorker();
  await startApp();
}

async function startApp() {
  if (started) return;
  started = true;

  restoreBank();

  const pads = await fetchPads();
  state.pads.clear();
  for (const p of pads) setPad(p);

  padEls = buildGrid(gridEl, {
    onPress: handlePress,
    onRelease: handleRelease,
    onSelect: handleSelect,
    onDropFile: assignFile,
  });

  bottomBar = createBottomBar(bottomEl, {
    onPadChanged: (pad) => {
      setPad(pad);
      updateGridPad(pad.key);
    },
    requestReplace: openFileDialog,
  });

  attachKeyboard({ onPress: handlePress, onRelease: handleRelease });
  createActiveList(el<HTMLElement>("#active-list"));
  setupBanks();

  onVoicesChange((id) => {
    // id é "banco:tecla"; só actualizamos o pad se está visible no banco actual.
    const key = id.slice(id.indexOf(":") + 1);
    const pad = getPad(key);
    if (!pad || padId(pad) !== id) return;
    const e = padEls.get(key);
    if (e) setPadState(e, { playing: isPlaying(id) });
  });

  el<HTMLButtonElement>("#btn-panic").addEventListener("click", onPanicClick);
  el<HTMLButtonElement>("#btn-modify").addEventListener("click", onModifyClick);
  el<HTMLButtonElement>("#btn-password").addEventListener("click", doChangePassword);
  fileInput.addEventListener("change", onFileChosen);

  // Modal de clave para edición.
  loginForm.addEventListener("submit", onLoginSubmit);
  loginCancel.addEventListener("click", () => (loginOverlay.hidden = true));

  // Frase do pé (só visible se hai espazo; cámbiase cada pouco).
  rotateQuote();
  window.setInterval(rotateQuote, 12000);

  requestAnimationFrame(tickCountdowns);
  void preloadAll();
}

function rotateQuote() {
  quoteEl.textContent = randomQuote();
}

// ---------------------------------------------------------------------------
// Bancos de sons (a fila de números é común a todos)
// ---------------------------------------------------------------------------
function restoreBank() {
  try {
    const stored = Number(localStorage.getItem(BANK_STORAGE_KEY));
    if (BANKS.includes(stored)) state.bank = stored;
  } catch {
    /* sen localStorage (modo privado): non pasa nada */
  }
}

function setupBanks() {
  for (const btn of banksEl.querySelectorAll<HTMLButtonElement>(".bank-btn")) {
    btn.classList.toggle("active", Number(btn.dataset.bank) === state.bank);
    btn.addEventListener("click", () => setBank(Number(btn.dataset.bank)));
  }
  // F1..F4 cambian de banco desde o teclado físico.
  window.addEventListener("keydown", (ev) => {
    const m = /^F([1-4])$/.exec(ev.key);
    if (!m) return;
    ev.preventDefault();
    setBank(Number(m[1]));
  });
}

function setBank(bank: number) {
  if (!BANKS.includes(bank) || bank === state.bank) return;
  state.bank = bank;
  try {
    localStorage.setItem(BANK_STORAGE_KEY, String(bank));
  } catch {
    /* ignorámolo */
  }
  for (const btn of banksEl.querySelectorAll<HTMLButtonElement>(".bank-btn")) {
    btn.classList.toggle("active", Number(btn.dataset.bank) === bank);
  }
  // Deseleccionamos e refrescamos a grella co novo banco.
  if (state.selectedKey) {
    const prev = padEls.get(state.selectedKey);
    if (prev) setPadState(prev, { selected: false });
    state.selectedKey = null;
  }
  bottomBar.hide();
  for (const [key, e] of padEls) {
    const pad = getPad(key);
    if (!pad) continue;
    renderPadContent(e, pad);
    setPadState(e, { playing: isPlaying(padId(pad)), selected: false });
  }
}

// ---------------------------------------------------------------------------
// Modo de edición
// ---------------------------------------------------------------------------
function setEditMode(on: boolean) {
  editMode = on;
  document.body.classList.toggle("edit-mode", on);
  el<HTMLButtonElement>("#btn-modify").textContent = on ? "Saír de edición" : "Modificar";
  if (!on) {
    bottomBar.hide();
    if (state.selectedKey) {
      const e = padEls.get(state.selectedKey);
      if (e) setPadState(e, { selected: false });
      state.selectedKey = null;
    }
  }
}

async function onModifyClick() {
  if (editMode) {
    await fetch("/api/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setEditMode(false);
  } else {
    loginError.hidden = true;
    loginInput.value = "";
    loginOverlay.hidden = false;
    loginInput.focus();
  }
}

async function onLoginSubmit(ev: Event) {
  ev.preventDefault();
  loginError.hidden = true;
  try {
    await resume();
    await login(loginInput.value);
    loginOverlay.hidden = true;
    setEditMode(true);
  } catch (e) {
    loginError.textContent = (e as Error).message || "Clave incorrecta";
    loginError.hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Pánico: primeira pulsación FUNDE todo (suave en antena);
// segunda pulsación (mentres funde) corta en seco.
// ---------------------------------------------------------------------------
let panicTimer = 0;

function onPanicClick() {
  const btn = el<HTMLButtonElement>("#btn-panic");
  if (panicTimer) {
    stopAll();
    clearTimeout(panicTimer);
    panicTimer = 0;
    btn.classList.remove("fading");
    return;
  }
  stopAllFade(PANIC_FADE_SECONDS);
  btn.classList.add("fading");
  panicTimer = window.setTimeout(() => {
    panicTimer = 0;
    btn.classList.remove("fading");
  }, PANIC_FADE_SECONDS * 1000);
}

// ---------------------------------------------------------------------------
// Disparo (sempre dispoñible) e selección (só en edición)
// ---------------------------------------------------------------------------
function handlePress(key: string) {
  void resume();
  const pad = getPad(key);
  if (!pad) return;
  if (editMode) selectPad(key);
  if (pad.soundFile) {
    trigger(pad);
    return;
  }
  if (editMode) openFileDialog(key); // pad baleiro: só en edición se pode subir
}

function handleRelease(key: string) {
  const pad = getPad(key);
  if (pad?.hold) stop(padId(pad), false);
}

// Selección por toque/rato (pad.ts): só ten efecto en edición.
function handleSelect(key: string) {
  if (editMode) selectPad(key);
}

function selectPad(key: string) {
  if (state.selectedKey === key) {
    showBottomBarFor(key);
    return;
  }
  if (state.selectedKey) {
    const prev = padEls.get(state.selectedKey);
    if (prev) setPadState(prev, { selected: false });
  }
  state.selectedKey = key;
  const e = padEls.get(key);
  if (e) setPadState(e, { selected: true });
  showBottomBarFor(key);
}

function showBottomBarFor(key: string) {
  const pad = getPad(key);
  if (editMode && pad?.soundFile) bottomBar.show(pad);
  else bottomBar.hide();
}

function updateGridPad(key: string) {
  const pad = getPad(key);
  const e = padEls.get(key);
  if (pad && e) {
    renderPadContent(e, pad);
    setPadState(e, {
      playing: isPlaying(padId(pad)),
      selected: state.selectedKey === key,
    });
  }
}

// ---------------------------------------------------------------------------
// Conta atrás nos pads que están a soar (canto queda para entrar a falar)
// ---------------------------------------------------------------------------
const countdownShown = new Set<string>();

function tickCountdowns() {
  for (const [key, e] of padEls) {
    const pad = getPad(key);
    const info = pad?.soundFile ? countdown(padId(pad)) : null;
    if (!info) {
      if (countdownShown.has(key)) {
        countdownShown.delete(key);
        clearCountdown(e);
      }
      continue;
    }
    countdownShown.add(key);
    const remEl = e.querySelector<HTMLElement>(".pad-remaining");
    const barEl = e.querySelector<HTMLElement>(".pad-bar");
    if (remEl) {
      remEl.hidden = false;
      remEl.textContent = info.remaining == null ? "∞" : formatTime(info.remaining);
    }
    if (barEl) barEl.style.width = `${(info.fraction * 100).toFixed(1)}%`;
    e.classList.toggle("ending", info.remaining != null && info.remaining <= 5);
  }
  requestAnimationFrame(tickCountdowns);
}

function clearCountdown(e: HTMLElement) {
  const remEl = e.querySelector<HTMLElement>(".pad-remaining");
  const barEl = e.querySelector<HTMLElement>(".pad-bar");
  if (remEl) remEl.hidden = true;
  if (barEl) barEl.style.width = "0%";
  e.classList.remove("ending");
}

// ---------------------------------------------------------------------------
// Precarga (clave para a latencia) — en PARALELO cun límite de conexións,
// priorizando o banco visible e os pads comúns.
// ---------------------------------------------------------------------------
async function preloadAll() {
  const pads = [...state.pads.values()].filter((p) => p.audioUrl);
  const prio = (p: { bank: number }) =>
    p.bank === 0 || p.bank === state.bank ? 0 : 1;
  pads.sort((a, b) => prio(a) - prio(b));

  let i = 0;
  const worker = async () => {
    while (i < pads.length) {
      const pad = pads[i++];
      const visible = pad.bank === 0 || pad.bank === state.bank;
      const e = visible ? padEls.get(pad.key) : undefined;
      if (e) setPadState(e, { loading: true });
      try {
        await loadBuffer(padId(pad), pad.audioUrl!);
      } catch (err) {
        console.error(`Non se puido precargar ${padId(pad)}:`, err);
      } finally {
        if (e) setPadState(e, { loading: false });
      }
    }
  };
  await Promise.all(Array.from({ length: PRELOAD_CONCURRENCY }, worker));
}

// ---------------------------------------------------------------------------
// Subir / substituír sons (só en edición)
// ---------------------------------------------------------------------------
function openFileDialog(key: string) {
  if (!editMode) return;
  pendingUploadKey = key;
  fileInput.value = "";
  fileInput.click();
}

async function onFileChosen() {
  const file = fileInput.files?.[0];
  const key = pendingUploadKey;
  pendingUploadKey = null;
  if (!file || !key) return;
  await assignFile(key, file);
}

async function assignFile(key: string, file: File) {
  if (!editMode) return;
  const target = getPad(key);
  if (!target) return;
  if (file.type && !file.type.startsWith("audio/")) {
    alert("O ficheiro non é de audio.");
    return;
  }

  const e = padEls.get(key);
  if (e) setPadState(e, { loading: true });

  let duration: number | undefined;
  let peaks: number[] | undefined;
  let decoded: AudioBuffer | undefined;
  try {
    const buf = await file.arrayBuffer();
    decoded = await audioContext().decodeAudioData(buf.slice(0));
    duration = decoded.duration;
    peaks = computePeaks(decoded);
  } catch (err) {
    console.warn("Non se puido procesar a forma de onda:", err);
  }

  try {
    const pad = await uploadSound(target.bank, key, file, {
      duration,
      peaks,
      displayName: file.name.replace(/\.[^.]+$/, ""),
    });
    setPad(pad);
    if (decoded) setBuffer(padId(pad), decoded);
    else if (pad.audioUrl) await loadBuffer(padId(pad), pad.audioUrl);
    updateGridPad(key);
    selectPad(key);
  } catch (err) {
    alert(`Non se puido subir o son: ${(err as Error).message}`);
  } finally {
    if (e) setPadState(e, { loading: false });
  }
}

// ---------------------------------------------------------------------------
// Cambio de clave (só en edición)
// ---------------------------------------------------------------------------
async function doChangePassword() {
  const current = prompt("Clave actual:");
  if (current == null) return;
  const next = prompt("Nova clave (mínimo 4 caracteres):");
  if (next == null) return;
  try {
    await changePassword(current, next);
    alert("Clave cambiada correctamente.");
  } catch (e) {
    alert(`Non se puido cambiar: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// PWA: rexistro do service worker (caché offline da app e dos audios).
// Só en produción: en desenvolvemento interferiría co recargado de Vite.
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  const env = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
  if (!("serviceWorker" in navigator) || env?.PROD !== true) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("Non se puido rexistrar o service worker:", err));
  });
}

// Evitamos o desprazamento da páxina coa barra espazadora.
window.addEventListener("keydown", (ev) => {
  if (ev.code === "Space" && (ev.target as HTMLElement)?.tagName !== "INPUT") {
    ev.preventDefault();
  }
});

// Evitamos que soltar un ficheiro fóra dun pad o abra no navegador.
window.addEventListener("dragover", (ev) => ev.preventDefault());
window.addEventListener("drop", (ev) => ev.preventDefault());
