import type { Pad } from "../state.js";
import { deleteSound, updatePad } from "../api/client.js";
import {
  activeProgress,
  clearBuffer,
  getBuffer,
  isPlaying,
  setVolume,
  start,
  stop,
  trigger,
} from "../audio/engine.js";
import { drawWaveform, formatTime } from "../audio/waveform.js";

export interface BottomDeps {
  onPadChanged: (pad: Pad) => void; // refrescar pad na grella + estado
  requestReplace: (key: string) => void; // abrir diálogo de ficheiro
}

export interface BottomBar {
  show: (pad: Pad) => void;
  hide: () => void;
  update: (pad: Pad) => void;
}

export function createBottomBar(root: HTMLElement, deps: BottomDeps): BottomBar {
  let pad: Pad | null = null;
  let rafId = 0;
  let saveTimer = 0;

  root.innerHTML = `
    <div class="bb-info">
      <input class="bb-name-input" type="text" placeholder="Nome do son"
        autocapitalize="none" autocorrect="off" spellcheck="false"
        aria-label="Nome do son" maxlength="40" />
      <div class="bb-colors" role="group" aria-label="Cor do pad">
        <button class="bb-color" data-color="verde" title="Verde"></button>
        <button class="bb-color" data-color="verdeclaro" title="Verde claro"></button>
        <button class="bb-color" data-color="turquesa" title="Turquesa"></button>
        <button class="bb-color" data-color="azul" title="Azul"></button>
        <button class="bb-color" data-color="violeta" title="Violeta"></button>
        <button class="bb-color" data-color="rosa" title="Rosa"></button>
        <button class="bb-color" data-color="vermello" title="Vermello"></button>
        <button class="bb-color" data-color="laranxa" title="Laranxa"></button>
        <button class="bb-color" data-color="mostaza" title="Mostaza"></button>
        <button class="bb-color" data-color="terracota" title="Terracota"></button>
      </div>
      <span class="bb-time"></span>
    </div>
    <div class="bb-wave">
      <canvas class="bb-canvas"></canvas>
      <div class="bb-handle bb-handle-start" hidden></div>
      <div class="bb-handle bb-handle-end" hidden></div>
    </div>
    <div class="bb-controls">
      <button class="bb-play" title="Reproducir / deter">▶</button>
      <label class="bb-vol">Vol
        <input class="bb-volume" type="range" min="0" max="1" step="0.01" />
      </label>
      <label class="bb-mode">Modo
        <select class="bb-mode-sel">
          <option value="golpe">De golpe</option>
          <option value="fundido">Fundido</option>
        </select>
      </label>
      <label class="bb-check"><input type="checkbox" class="bb-hold" /> Só ao premer</label>
      <label class="bb-check"><input type="checkbox" class="bb-loop" /> Bucle</label>
      <button class="bb-mark-start" title="Marcar inicio na posición actual">⟦ Inicio</button>
      <button class="bb-mark-end" title="Marcar fin na posición actual">Fin ⟧</button>
      <button class="bb-clear-trim" title="Quitar o recorte">Sen recorte</button>
      <span class="bb-spacer"></span>
      <button class="bb-replace" title="Substituír o ficheiro">Substituír</button>
      <button class="bb-delete danger" title="Eliminar o son">Eliminar</button>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const canvas = $<HTMLCanvasElement>(".bb-canvas");
  const waveBox = $<HTMLElement>(".bb-wave");
  const hStart = $<HTMLElement>(".bb-handle-start");
  const hEnd = $<HTMLElement>(".bb-handle-end");
  const nameInput = $<HTMLInputElement>(".bb-name-input");
  const colorBtns = Array.from(
    root.querySelectorAll(".bb-color"),
  ) as HTMLButtonElement[];
  const timeEl = $<HTMLElement>(".bb-time");
  const playBtn = $<HTMLButtonElement>(".bb-play");
  const volEl = $<HTMLInputElement>(".bb-volume");
  const modeEl = $<HTMLSelectElement>(".bb-mode-sel");
  const holdEl = $<HTMLInputElement>(".bb-hold");
  const loopEl = $<HTMLInputElement>(".bb-loop");

  function duration(): number {
    if (!pad) return 0;
    return getBuffer(pad.key)?.duration ?? pad.duration ?? 0;
  }

  function trimFraction(): { start: number; end: number } | null {
    if (!pad || (pad.trimStart == null && pad.trimEnd == null)) return null;
    const d = duration() || 1;
    return {
      start: (pad.trimStart ?? 0) / d,
      end: (pad.trimEnd ?? d) / d,
    };
  }

  function redraw() {
    if (!pad) return;
    const d = duration();
    const prog = activeProgress(pad.key);

    // Posición do cursor. En bucle, envolve dentro do tramo recortado para que
    // volva ao inicio ao chegar ao fin (en vez de seguir avanzando).
    let pos = prog?.position ?? 0;
    if (prog) {
      const v = prog.voice;
      if (v.loop && v.segment > 0) {
        const elapsed = prog.position - v.offset;
        pos = v.offset + (elapsed % v.segment);
      }
    }

    const progress = prog && d ? Math.min(pos / d, 1) : undefined;
    drawWaveform(canvas, pad.peaks, { progress, trim: trimFraction() });
    timeEl.textContent = `${formatTime(pos)} / ${formatTime(d)}`;
    playBtn.textContent = isPlaying(pad.key) ? "■" : "▶";
    positionHandles();
  }

  function positionHandles() {
    const tf = trimFraction();
    if (!tf) {
      hStart.hidden = true;
      hEnd.hidden = true;
      return;
    }
    const w = waveBox.clientWidth;
    hStart.hidden = false;
    hEnd.hidden = false;
    hStart.style.left = `${tf.start * w}px`;
    hEnd.style.left = `${tf.end * w}px`;
  }

  function loop() {
    redraw();
    rafId = requestAnimationFrame(loop);
  }

  function persist(patch: Partial<Pad>) {
    if (!pad) return;
    Object.assign(pad, patch);
    deps.onPadChanged(pad);
    redraw();
    if (saveTimer) clearTimeout(saveTimer);
    const key = pad.key;
    saveTimer = window.setTimeout(() => {
      updatePad(key, patch).catch((e) => console.error("Non se gardou:", e));
    }, 200);
  }

  // ---- Eventos dos controis ----
  playBtn.addEventListener("click", () => pad && trigger(pad));
  volEl.addEventListener("input", () => {
    const v = Number(volEl.value);
    if (pad) setVolume(pad.key, v); // aplica o volume en directo ás voces que soan
    persist({ volume: v });
  });
  modeEl.addEventListener("change", () =>
    persist({ mode: modeEl.value as Pad["mode"] }),
  );
  holdEl.addEventListener("change", () => persist({ hold: holdEl.checked }));
  loopEl.addEventListener("change", () => persist({ loop: loopEl.checked }));

  // Renomear o pad.
  nameInput.addEventListener("input", () =>
    persist({ displayName: nameInput.value }),
  );
  // Cambiar a cor do pad.
  for (const btn of colorBtns) {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color!;
      persist({ color });
      markColor(color);
    });
  }

  function markColor(color: string | null) {
    for (const btn of colorBtns) {
      btn.classList.toggle("active", btn.dataset.color === color);
    }
  }

  $<HTMLButtonElement>(".bb-mark-start").addEventListener("click", () => {
    const prog = pad && activeProgress(pad.key);
    if (pad && prog) persist({ trimStart: round(prog.position) });
  });
  $<HTMLButtonElement>(".bb-mark-end").addEventListener("click", () => {
    const prog = pad && activeProgress(pad.key);
    if (pad && prog) persist({ trimEnd: round(prog.position) });
  });
  $<HTMLButtonElement>(".bb-clear-trim").addEventListener("click", () =>
    persist({ trimStart: null, trimEnd: null }),
  );
  $<HTMLButtonElement>(".bb-replace").addEventListener("click", () => {
    if (pad) deps.requestReplace(pad.key);
  });
  $<HTMLButtonElement>(".bb-delete").addEventListener("click", async () => {
    if (!pad) return;
    if (!confirm(`Eliminar o son de "${pad.displayName ?? pad.key}"?`)) return;
    const key = pad.key;
    stop(key, false);
    const updated = await deleteSound(key);
    clearBuffer(key);
    deps.onPadChanged(updated);
    hide();
  });

  // Saltar a unha posición tocando na onda (preview desde ese punto).
  canvas.addEventListener("pointerdown", (ev) => {
    if (!pad) return;
    const rect = canvas.getBoundingClientRect();
    const f = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const d = duration();
    stop(pad.key, false);
    start({ ...pad, trimStart: f * d, trimEnd: d, loop: false });
  });

  // Arrastrar as asas de recorte.
  attachHandleDrag(hStart, waveBox, (f) => {
    if (!pad) return;
    const d = duration();
    const end = pad.trimEnd ?? d;
    persist({ trimStart: round(clamp(f * d, 0, end - 0.05)) });
  });
  attachHandleDrag(hEnd, waveBox, (f) => {
    if (!pad) return;
    const d = duration();
    const start0 = pad.trimStart ?? 0;
    persist({ trimEnd: round(clamp(f * d, start0 + 0.05, d)) });
  });

  function fill(p: Pad) {
    // Non sobreescribimos mentres o usuario está escribindo no campo.
    if (document.activeElement !== nameInput) {
      nameInput.value = p.displayName ?? p.key;
    }
    markColor(p.color);
    volEl.value = String(p.volume);
    modeEl.value = p.mode;
    holdEl.checked = p.hold;
    loopEl.checked = p.loop;
  }

  function show(p: Pad) {
    pad = p;
    root.hidden = false;
    fill(p);
    if (!rafId) loop();
  }

  function hide() {
    pad = null;
    root.hidden = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function update(p: Pad) {
    if (pad && pad.key === p.key) {
      pad = p;
      fill(p);
      redraw();
    }
  }

  return { show, hide, update };
}

function attachHandleDrag(
  handle: HTMLElement,
  box: HTMLElement,
  onMove: (fraction: number) => void,
) {
  handle.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const rect = box.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const f = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      onMove(f);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
