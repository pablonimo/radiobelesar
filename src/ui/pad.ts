import type { Pad } from "../state.js";

export interface PadHandlers {
  onPress: (key: string) => void; // disparo (pointerdown)
  onRelease: (key: string) => void; // soltar (pointerup) — para modo hold
  onSelect: (key: string) => void; // seleccionar para editar
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
      <span class="pad-icons">${icons.join("")}</span>`;
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

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
