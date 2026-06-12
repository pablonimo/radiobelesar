export type PlayMode = "golpe" | "fundido";

export interface Pad {
  bank: number;
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

// Bancos: a fila de números (banco 0) é común; o resto cambia por banco.
export const SHARED_KEYS = new Set(KEY_ROWS[0]);
export const BANKS = [1, 2, 3, 4];

/** Identificador único dun pad ("banco:tecla") — úsase como chave no motor de audio. */
export function padId(pad: { bank: number; key: string }): string {
  return `${pad.bank}:${pad.key}`;
}

export interface AppState {
  pads: Map<string, Pad>; // chave: padId (banco:tecla)
  selectedKey: string | null;
  bank: number; // banco visible (1..4)
}

export const state: AppState = {
  pads: new Map(),
  selectedKey: null,
  bank: 1,
};

/** Banco efectivo dunha tecla: as compartidas viven sempre no banco 0. */
export function bankFor(key: string): number {
  return SHARED_KEYS.has(key) ? 0 : state.bank;
}

/** Pad VISIBLE asociado a unha tecla (tendo en conta o banco actual). */
export function getPad(key: string): Pad | undefined {
  return state.pads.get(`${bankFor(key)}:${key}`);
}

export function setPad(pad: Pad): void {
  state.pads.set(padId(pad), pad);
}
