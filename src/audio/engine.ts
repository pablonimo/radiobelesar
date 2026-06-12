import { padId, type Pad } from "../state.js";

// ===========================================================================
// Motor de audio (Web Audio API).
//
// Requisito crítico: latencia mínima. Para iso:
//  - Cada son precárgase e decodifícase a un AudioBuffer que queda en memoria.
//  - O disparo só crea un AudioBufferSourceNode e chama a start(): inmediato.
//  - Nada pesado (cálculo de onda, gardar config) bloquea o disparo.
//  - Cada disparo é un nodo de só uso => solapamento sen coste nin cortes.
// ===========================================================================

const ctx = new AudioContext({ latencyHint: "interactive" });
const buffers = new Map<string, AudioBuffer>();

interface Voice {
  id: number; // identificador único da reprodución (para a lista de activos)
  key: string;
  name: string; // nome a mostrar
  color: string; // cor da categoría
  src: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number; // ctx.currentTime no momento de start
  offset: number; // segundo de inicio dentro do buffer
  segment: number; // duración do tramo que soa (segundos)
  loop: boolean;
  fade: boolean; // se se detén con fundido de saída
}
const voices = new Map<string, Set<Voice>>();
const voiceById = new Map<number, Voice>();
let voiceCounter = 0;

/** Info dunha reprodución activa para a columna de "Activos". */
export interface ActiveVoice {
  id: number;
  key: string;
  name: string;
  color: string;
  progress: number; // 0..1
  loop: boolean;
}

const FADE_SECONDS = 0.6;
const MIN_GAIN = 0.0001;

type ChangeListener = (key: string) => void;
let changeListener: ChangeListener = () => {};

export function onVoicesChange(fn: ChangeListener): void {
  changeListener = fn;
}

export function audioContext(): AudioContext {
  return ctx;
}

/** Debe chamarse tras un xesto do usuario (política de autoplay do navegador). */
export async function resume(): Promise<void> {
  if (ctx.state !== "running") {
    await ctx.resume();
  }
}

export async function loadBuffer(key: string, url: string): Promise<AudioBuffer> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Non se puido descargar o audio (${res.status})`);
  const data = await res.arrayBuffer();
  const buffer = await ctx.decodeAudioData(data);
  buffers.set(key, buffer);
  return buffer;
}

export function setBuffer(key: string, buffer: AudioBuffer): void {
  buffers.set(key, buffer);
}

export function hasBuffer(key: string): boolean {
  return buffers.has(key);
}

export function getBuffer(key: string): AudioBuffer | undefined {
  return buffers.get(key);
}

export function clearBuffer(key: string): void {
  buffers.delete(key);
}

export function isPlaying(key: string): boolean {
  return (voices.get(key)?.size ?? 0) > 0;
}

/** Progreso da voz máis recente dun pad (para a barra inferior). */
export function activeProgress(key: string): { position: number; voice: Voice } | null {
  const set = voices.get(key);
  if (!set || set.size === 0) return null;
  let latest: Voice | null = null;
  for (const v of set) {
    if (!latest || v.startedAt > latest.startedAt) latest = v;
  }
  if (!latest) return null;
  return { position: latest.offset + (ctx.currentTime - latest.startedAt), voice: latest };
}

/** Disparo principal: respeta o modo alternancia (agás hold). */
export function trigger(pad: Pad): void {
  const id = padId(pad);
  if (!buffers.has(id)) return;
  if (!pad.hold && isPlaying(id)) {
    stop(id, pad.mode === "fundido");
    return;
  }
  start(pad);
}

/** Inicia unha voz nova. Devolve a voz (útil no modo hold). */
export function start(pad: Pad): Voice | null {
  const id = padId(pad);
  const buffer = buffers.get(id);
  if (!buffer) return null;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  src.connect(gain).connect(ctx.destination);

  const offset = clamp(pad.trimStart ?? 0, 0, buffer.duration);
  const end = clamp(pad.trimEnd ?? buffer.duration, offset, buffer.duration);
  const segment = Math.max(0, end - offset);

  if (pad.loop) {
    src.loop = true;
    src.loopStart = offset;
    src.loopEnd = end;
  }

  const target = Math.max(pad.volume, 0);
  if (pad.mode === "fundido") {
    gain.gain.setValueAtTime(MIN_GAIN, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(target, MIN_GAIN),
      ctx.currentTime + FADE_SECONDS,
    );
  } else {
    gain.gain.setValueAtTime(target, ctx.currentTime);
  }

  const voice: Voice = {
    id: ++voiceCounter,
    key: id,
    name: pad.displayName ?? pad.key,
    color: pad.color ?? "verde",
    src,
    gain,
    startedAt: ctx.currentTime,
    offset,
    segment,
    loop: pad.loop,
    fade: pad.mode === "fundido",
  };
  let set = voices.get(id);
  if (!set) {
    set = new Set();
    voices.set(id, set);
  }
  set.add(voice);
  voiceById.set(voice.id, voice);

  src.onended = () => {
    set!.delete(voice);
    voiceById.delete(voice.id);
    changeListener(id);
  };

  // Con bucle reproducimos indefinidamente; sen bucle, só o tramo recortado.
  src.start(0, offset, pad.loop ? undefined : segment);
  changeListener(id);
  return voice;
}

/** Detén todas as voces dun pad (con ou sen fundido de saída). */
export function stop(key: string, fade = false): void {
  const set = voices.get(key);
  if (!set) return;
  for (const voice of [...set]) {
    release(voice, fade);
  }
}

/** Botón de pánico: corta todo de inmediato. */
export function stopAll(): void {
  for (const key of voices.keys()) {
    stop(key, false);
  }
}

/** Pánico suave: funde TODAS as voces á vez (mellor en antena que un corte seco). */
export function stopAllFade(seconds = 1.2): void {
  for (const voice of [...voiceById.values()]) {
    release(voice, true, seconds);
  }
}

/** Info de conta atrás dun pad (voz máis recente): tempo restante e fracción 0..1. */
export interface Countdown {
  remaining: number | null; // null = bucle (non remata só)
  fraction: number; // 0..1 dentro do tramo que soa
}

export function countdown(key: string): Countdown | null {
  const set = voices.get(key);
  if (!set || set.size === 0) return null;
  let latest: Voice | null = null;
  for (const v of set) {
    if (!latest || v.startedAt > latest.startedAt) latest = v;
  }
  if (!latest || latest.segment <= 0) return null;
  const elapsed = Math.max(0, ctx.currentTime - latest.startedAt);
  if (latest.loop) {
    return { remaining: null, fraction: (elapsed % latest.segment) / latest.segment };
  }
  return {
    remaining: Math.max(0, latest.segment - elapsed),
    fraction: Math.min(elapsed / latest.segment, 1),
  };
}

/** Detén unha reprodución concreta polo seu id (X na columna de activos). */
export function stopVoiceById(id: number): void {
  const voice = voiceById.get(id);
  if (voice) release(voice, voice.fade);
}

/** Aplica un volume novo EN DIRECTO a todas as voces activas dun pad. */
export function setVolume(key: string, volume: number): void {
  const set = voices.get(key);
  if (!set) return;
  const t = ctx.currentTime;
  const v = Math.max(volume, 0);
  for (const voice of set) {
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(v, t);
  }
}

/** Lista das reproducións activas, ordenadas da máis antiga á máis recente. */
export function listActiveVoices(): ActiveVoice[] {
  const now = ctx.currentTime;
  const out: ActiveVoice[] = [];
  for (const voice of voiceById.values()) {
    const elapsed = Math.max(0, now - voice.startedAt);
    let progress = 0;
    if (voice.segment > 0) {
      progress = voice.loop
        ? (elapsed % voice.segment) / voice.segment
        : Math.min(elapsed / voice.segment, 1);
    }
    out.push({
      id: voice.id,
      key: voice.key,
      name: voice.name,
      color: voice.color,
      progress,
      loop: voice.loop,
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

function release(voice: Voice, fade: boolean, seconds = FADE_SECONDS): void {
  const t = ctx.currentTime;
  try {
    if (fade) {
      const current = Math.max(voice.gain.gain.value, MIN_GAIN);
      voice.gain.gain.cancelScheduledValues(t);
      voice.gain.gain.setValueAtTime(current, t);
      voice.gain.gain.exponentialRampToValueAtTime(MIN_GAIN, t + seconds);
      voice.src.stop(t + seconds);
    } else {
      voice.src.stop();
    }
  } catch {
    /* a voz pode estar xa detida */
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
