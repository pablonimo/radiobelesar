import type { Pad } from "../state.js";
import { escapeHtml } from "./html.js";

export interface PadHandlers {
  onPress: (key: string) => void; // disparo (pointerdown)
  onRelease: (key: string) => void; // soltar (pointerup) — para modo hold
  onSelect: (key: string) => void; // seleccionar para editar
  onDropFile: (key: string, file: File) => void; // arrastrar e soltar audio
}

const KEY_LABELS: Record<string, string> = {
  SPACE: "espazo",
  ",": ",",
  ".": ".",
};

export function createPadEl(pad: Pad, handlers: PadHandlers): HTMLElement {
  const el = document.createElement("button");
  el.className = "pad";
  el.dataset.key = pad.key;
  if (pad.key === "SPACE") el.classList.add("pad-space");

  // Disparo inmediato no pointerdown (non agardamos ao click => menos latencia).
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    handlers.onSelect(pad.key);
    handlers.onPress(pad.key);
  });
  el.addEventListener("pointerup", (ev) => {
    ev.preventDefault();
    handlers.onRelease(pad.key);
  });
  el.addEventListener("pointercancel", () => handlers.onRelease(pad.key));
  el.addEventListener("pointerleave", () => handlers.onRelease(pad.key));
  // Evitamos o menú contextual nun toque longo en táctil.
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());

  // Arrastrar e soltar un ficheiro de audio sobre o pad para asignalo.
  const inEdit = () => document.body.classList.contains("edit-mode");
  el.addEventListener("dragover", (ev) => {
    if (!inEdit()) return; // só se pode asignar en modo de edición
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    el.classList.add("dragover");
  });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop", (ev) => {
    if (!inEdit()) return;
    ev.preventDefault();
    el.classList.remove("dragover");
    const file = ev.dataTransfer?.files?.[0];
    if (file) handlers.onDropFile(pad.key, file);
  });

  renderPadContent(el, pad);
  return el;
}

export function renderPadContent(el: HTMLElement, pad: Pad): void {
  el.classList.toggle("empty", !pad.soundFile);
  el.dataset.color = pad.color ?? "verde";

  const keyLabel = KEY_LABELS[pad.key] ?? pad.key;
  const icons: string[] = [];
  if (pad.mode === "fundido") icons.push('<span class="ic" title="Fundido">∿</span>');
  if (pad.hold) icons.push('<span class="ic" title="Só mentres se preme">⊙</span>');
  if (pad.loop) icons.push('<span class="ic" title="Bucle">↻</span>');

  if (pad.soundFile) {
    el.innerHTML = `
      <span class="pad-key">${keyLabel}</span>
      <span class="pad-name">${escapeHtml(pad.displayName ?? "son")}</span>
      <span class="pad-icons">${icons.join("")}</span>
      <span class="pad-remaining" hidden></span>
      <div class="pad-progress"><div class="pad-bar"></div></div>`;
  } else {
    el.innerHTML = `
      <span class="pad-key">${keyLabel}</span>
      <span class="pad-add">+ subir son</span>`;
  }
}

export function setPadState(
  el: HTMLElement,
  opts: { selected?: boolean; playing?: boolean; loading?: boolean },
): void {
  if (opts.selected != null) el.classList.toggle("selected", opts.selected);
  if (opts.playing != null) el.classList.toggle("playing", opts.playing);
  if (opts.loading != null) el.classList.toggle("loading", opts.loading);
}
