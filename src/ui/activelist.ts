import { listActiveVoices, stopVoiceById, type ActiveVoice } from "../audio/engine.js";

// Columna de "Audios activos" (estilo Soundplant).
//  - Cada reprodución activa aparece como unha fila cunha barra de progreso.
//  - As novas reproducións entran pola parte inferior e empuxan as anteriores cara arriba
//    (a lista usa flex-direction: column-reverse; engadimos cada nova como primeiro fillo).
//  - Ao rematar o audio, a súa fila desaparece.
//  - Cada fila ten unha "✕" para detela desde aquí.

interface Item {
  el: HTMLElement;
  bar: HTMLElement;
}

export function createActiveList(listEl: HTMLElement): void {
  const items = new Map<number, Item>();

  function createItem(v: ActiveVoice): Item {
    const el = document.createElement("div");
    el.className = "active-item enter";
    el.dataset.color = v.color;
    if (v.loop) el.classList.add("loop");
    el.innerHTML = `
      <button class="active-x" title="Parar" aria-label="Parar ${escapeHtml(v.name)}">✕</button>
      <span class="active-name">${escapeHtml(v.name)}</span>
      <div class="active-progress"><div class="active-bar"></div></div>`;
    const x = el.querySelector(".active-x") as HTMLButtonElement;
    x.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      stopVoiceById(v.id);
    });
    // Quitamos a clase de entrada cando remata a animación.
    el.addEventListener("animationend", () => el.classList.remove("enter"), { once: true });
    return { el, bar: el.querySelector(".active-bar") as HTMLElement };
  }

  function frame() {
    const active = listActiveVoices();
    const seen = new Set<number>();

    for (const v of active) {
      seen.add(v.id);
      let item = items.get(v.id);
      if (!item) {
        item = createItem(v);
        items.set(v.id, item);
        // Primeiro fillo => co column-reverse aparece na parte inferior.
        listEl.insertBefore(item.el, listEl.firstChild);
      }
      item.bar.style.width = `${Math.round(v.progress * 100)}%`;
    }

    // Eliminamos as filas das voces que xa remataron.
    for (const [id, item] of items) {
      if (!seen.has(id)) {
        item.el.remove();
        items.delete(id);
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
