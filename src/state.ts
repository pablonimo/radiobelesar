export type PlayMode = "golpe" | "fundido";

export interface Pad {
  key: string;
  soundFile: string | null;
  audioUrl: string | null;
  displayName: string | null;
  mime: string | null;
  duration: number | null;
  volume: number;
  mode: PlayMode;
  hold: boolean;
  loop: boolean;
  trimStart: number | null;
  trimEnd: number | null;
  color: string | null;
  peaks: number[] | null;
}

// Disposición do teclado (debe coincidir coa do servidor).
export const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
  ["Z", "X", "C", "V", "B", "N", "M", ",", "."],
  ["SPACE"],
];

export interface AppState {
  pads: Map<string, Pad>;
  selectedKey: string | null;
}

export const state: AppState = {
  pads: new Map(),
  selectedKey: null,
};

export function getPad(key: string): Pad | undefined {
  return state.pads.get(key);
}

export function setPad(pad: Pad): void {
  state.pads.set(pad.key, pad);
}
