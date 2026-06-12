import { getPad, KEY_ROWS } from "../state.js";
import { createPadEl, type PadHandlers } from "./pad.js";

// Constrúe a grella de pads (catro filas QWERTY + barra espazadora).
// Devolve un mapa key -> elemento para actualizar os pads sen reconstruír.
export function buildGrid(
  container: HTMLElement,
  handlers: PadHandlers,
): Map<string, HTMLElement> {
  container.innerHTML = "";
  const els = new Map<string, HTMLElement>();

  for (const row of KEY_ROWS) {
    const rowEl = document.createElement("div");
    rowEl.className = "grid-row";
    for (const key of row) {
      const pad = getPad(key);
      if (!pad) continue;
      const el = createPadEl(pad, handlers);
      els.set(key, el);
      rowEl.appendChild(el);
    }
    container.appendChild(rowEl);
  }
  return els;
}
