import { listActiveVoices, stopVoiceById, type ActiveVoice } from "../audio/engine.js";

// Columna de "Audios activos" (estilo Soundplant).
//  - As novas reproducións engádense ao fondo da columna.
//  - Ao rematar un audio, a súa fila colápsase (altura -> 0) e as de abaixo
//    soben suavemente ocupando o oco que vai deixando.
//  - Cada fila ten unha barra de progreso e unha "✕" para detela.

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
    el.addEventListener("animationend", () => el.classList.remove("enter"), {
      once: true,
    });
    return { el, bar: el.querySelector(".active-bar") as HTMLElement };
  }

  // Colapsa a fila e elimínaa ao rematar a transición; as de abaixo soben.
  function removeItem(item: Item) {
    const el = item.el;
    el.style.height = `${el.offsetHeight}px`;
    el.getBoundingClientRect(); // forzamos reflow para fixar a altura inicial
    el.classList.add("leaving");
    el.style.height = "0px";
    el.style.marginBottom = "0px";
    el.style.paddingTop = "0px";
    el.style.paddingBottom = "0px";
    el.style.opacity = "0";

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
    };
    el.addEventListener("transitionend", (ev) => {
      if (ev.propertyName === "height") finish();
    });
    setTimeout(finish, 400); // rede de seguridade
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
        listEl.appendChild(item.el); // engádese ao fondo da columna
      }
      item.bar.style.width = `${Math.round(v.progress * 100)}%`;
    }

    // As voces que xa remataron: colápsanse e as de abaixo soben.
    for (const [id, item] of items) {
      if (!seen.has(id)) {
        items.delete(id);
        removeItem(item);
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
