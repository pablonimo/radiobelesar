// Cálculo da forma de onda (picos de amplitude) e debuxo en canvas.
// O cálculo faise unha vez ao cargar/subir o son e gárdase no servidor,
// de modo que nunca bloquea o disparo nin se recalcula en cada apertura.

export function computePeaks(buffer: AudioBuffer, buckets = 400): number[] {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = new Array(buckets).fill(0);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(channel[start + j] || 0);
      if (v > max) max = v;
    }
    peaks[i] = Math.round(max * 1000) / 1000;
  }
  return peaks;
}

export interface WaveOptions {
  progress?: number; // 0..1, posición de reprodución
  trim?: { start: number; end: number } | null; // 0..1
  colorWave?: string;
  colorPlayed?: string;
  colorDim?: string;
  colorCursor?: string;
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[] | null,
  opts: WaveOptions = {},
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = canvas.clientHeight || 96;
  if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
  }
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssWidth, cssHeight);

  if (!peaks || peaks.length === 0) {
    g.fillStyle = opts.colorDim ?? "#b9ac90";
    g.font = "13px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Sen forma de onda", cssWidth / 2, cssHeight / 2);
    return;
  }

  const wave = opts.colorWave ?? "#2a7f7a";
  const played = opts.colorPlayed ?? "#c4622d";
  const dim = opts.colorDim ?? "rgba(42,127,122,0.25)";
  const cursor = opts.colorCursor ?? "#1d1a14";

  const mid = cssHeight / 2;
  const n = peaks.length;
  const barW = cssWidth / n;
  const progressX = opts.progress != null ? opts.progress * cssWidth : -1;

  const trimStartX = opts.trim ? opts.trim.start * cssWidth : 0;
  const trimEndX = opts.trim ? opts.trim.end * cssWidth : cssWidth;

  for (let i = 0; i < n; i++) {
    const x = i * barW;
    const h = Math.max(1, peaks[i] * (cssHeight * 0.92));
    const insideTrim = x >= trimStartX - 0.5 && x <= trimEndX + 0.5;
    if (!insideTrim) {
      g.fillStyle = dim;
    } else if (progressX >= 0 && x <= progressX) {
      g.fillStyle = played;
    } else {
      g.fillStyle = wave;
    }
    g.fillRect(x, mid - h / 2, Math.max(1, barW - 0.5), h);
  }

  // Liña vertical na posición actual.
  if (progressX >= 0) {
    g.fillStyle = cursor;
    g.fillRect(progressX - 0.5, 0, 1, cssHeight);
  }
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs}`;
}
