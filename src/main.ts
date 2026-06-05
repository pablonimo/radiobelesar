import { checkSession, changePassword, fetchPads, login, uploadSound } from "./api/client.js";
import {
  audioContext,
  loadBuffer,
  isPlaying,
  onVoicesChange,
  resume,
  setBuffer,
  stop,
  stopAll,
  trigger,
} from "./audio/engine.js";
import { computePeaks } from "./audio/waveform.js";
import { buildGrid } from "./ui/grid.js";
import { renderPadContent, setPadState } from "./ui/pad.js";
import { attachKeyboard } from "./ui/keyboard.js";
import { createBottomBar, type BottomBar } from "./ui/bottombar.js";
import { createActiveList } from "./ui/activelist.js";
import { getPad, setPad, state } from "./state.js";

const el = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const loginOverlay = el<HTMLElement>("#login");
const loginForm = el<HTMLFormElement>("#login-form");
const loginInput = el<HTMLInputElement>("#login-password");
const loginError = el<HTMLElement>("#login-error");
const appEl = el<HTMLElement>("#app");
const gridEl = el<HTMLElement>("#grid");
const bottomEl = el<HTMLElement>("#bottombar");

let padEls = new Map<string, HTMLElement>();
let bottomBar: BottomBar;
let pendingUploadKey: string | null = null;
let appStarted = false; // evita arrancar a app (e os seus bucles) dúas veces

// Input de ficheiro oculto, reutilizado para subir/substituír.
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "audio/*";
fileInput.hidden = true;
document.body.appendChild(fileInput);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
init();

async function init() {
  if (await checkSession()) {
    loginOverlay.hidden = true;
    await startApp();
  } else {
    loginOverlay.hidden = false;
    loginInput.focus();
  }
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.hidden = true;
  try {
    await resume(); // o submit é un xesto válido para activar o audio
    await login(loginInput.value);
    loginOverlay.hidden = true;
    await startApp();
  } catch (e) {
    loginError.textContent = (e as Error).message || "Non se puido entrar";
    loginError.hidden = false;
  }
});

async function startApp() {
  if (appStarted) return;
  appStarted = true;
  appEl.hidden = false;

  const pads = await fetchPads();
  state.pads.clear();
  for (const p of pads) setPad(p);

  padEls = buildGrid(gridEl, {
    onPress: handlePress,
    onRelease: handleRelease,
    onSelect: selectPad,
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

  onVoicesChange((key) => {
    const e = padEls.get(key);
    if (e) setPadState(e, { playing: isPlaying(key) });
  });

  el<HTMLButtonElement>("#btn-panic").addEventListener("click", () => stopAll());
  el<HTMLButtonElement>("#btn-password").addEventListener("click", doChangePassword);
  fileInput.addEventListener("change", onFileChosen);

  preloadAll();
}

// ---------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------
function handlePress(key: string) {
  void resume();
  const pad = getPad(key);
  if (!pad) return;
  selectPad(key);
  if (!pad.soundFile) {
    openFileDialog(key);
    return;
  }
  trigger(pad);
}

function handleRelease(key: string) {
  const pad = getPad(key);
  if (pad?.hold) stop(key, false);
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
  if (pad?.soundFile) bottomBar.show(pad);
  else bottomBar.hide();
}

function updateGridPad(key: string) {
  const pad = getPad(key);
  const e = padEls.get(key);
  if (pad && e) {
    renderPadContent(e, pad);
    setPadState(e, { playing: isPlaying(key), selected: state.selectedKey === key });
  }
}

// ---------------------------------------------------------------------------
// Precarga (clave para a latencia)
// ---------------------------------------------------------------------------
async function preloadAll() {
  for (const pad of state.pads.values()) {
    if (!pad.audioUrl) continue;
    const e = padEls.get(pad.key);
    if (e) setPadState(e, { loading: true });
    try {
      await loadBuffer(pad.key, pad.audioUrl);
    } catch (err) {
      console.error(`Non se puido precargar ${pad.key}:`, err);
    } finally {
      if (e) setPadState(e, { loading: false });
    }
  }
}

// ---------------------------------------------------------------------------
// Subir / substituír sons
// ---------------------------------------------------------------------------
function openFileDialog(key: string) {
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

// Asigna un ficheiro de audio a un pad: decodifica (onda + duración), súbeo e cachea o buffer.
// Úsano tanto o diálogo de ficheiro como o arrastrar-e-soltar.
async function assignFile(key: string, file: File) {
  if (!getPad(key)) return;
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
    const pad = await uploadSound(key, file, {
      duration,
      peaks,
      displayName: file.name.replace(/\.[^.]+$/, ""),
    });
    setPad(pad);
    // Se xa decodificamos, cacheamos o buffer => primeiro disparo inmediato.
    if (decoded) setBuffer(key, decoded);
    else if (pad.audioUrl) await loadBuffer(key, pad.audioUrl);
    updateGridPad(key);
    selectPad(key);
  } catch (err) {
    alert(`Non se puido subir o son: ${(err as Error).message}`);
  } finally {
    if (e) setPadState(e, { loading: false });
  }
}

// ---------------------------------------------------------------------------
// Cambio de clave
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

// Evitamos o desprazamento da páxina coa barra espazadora.
window.addEventListener("keydown", (ev) => {
  if (ev.code === "Space" && (ev.target as HTMLElement)?.tagName !== "INPUT") {
    ev.preventDefault();
  }
});

// Evitamos que soltar un ficheiro fóra dun pad o abra no navegador.
window.addEventListener("dragover", (ev) => ev.preventDefault());
window.addEventListener("drop", (ev) => ev.preventDefault());
