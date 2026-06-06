// Cores das teclas: 10 tons (hue) x 3 intensidades (intenso / normal / claro).
// O valor gardado é "hue" (normal), "hue-int" (intenso) ou "hue-cla" (claro).

export const HUES = [
  "vermello",
  "laranxa",
  "mostaza",
  "amarelo",
  "verdeclaro",
  "verde",
  "turquesa",
  "azul",
  "violeta",
  "rosa",
] as const;

export const HUE_LABEL: Record<string, string> = {
  vermello: "Vermello",
  laranxa: "Laranxa",
  mostaza: "Mostaza",
  amarelo: "Amarelo",
  verdeclaro: "Verde claro",
  verde: "Verde",
  turquesa: "Turquesa",
  azul: "Azul",
  violeta: "Violeta",
  rosa: "Rosa",
};

const H: Record<string, number> = {
  vermello: 5,
  laranxa: 25,
  mostaza: 42,
  amarelo: 52,
  verdeclaro: 95,
  verde: 170,
  turquesa: 190,
  azul: 215,
  violeta: 270,
  rosa: 330,
};

export type Intensity = "int" | "nor" | "cla";
export const INTENSITIES: Intensity[] = ["int", "nor", "cla"];
export const INTENSITY_LABEL: Record<Intensity, string> = {
  int: "Intenso",
  nor: "Normal",
  cla: "Claro",
};

/** Cor "viva" do ton (para os puntos do selector e a columna de activos). */
export function swatch(hue: string, intensity: Intensity): string {
  const h = H[hue] ?? H.verde;
  const l = intensity === "int" ? 38 : intensity === "cla" ? 60 : 47;
  return `hsl(${h} 65% ${l}%)`;
}

export function parseColor(color: string | null): { hue: string; intensity: Intensity } {
  if (!color) return { hue: "verde", intensity: "nor" };
  const [hue, suf] = color.split("-");
  const intensity: Intensity = suf === "int" ? "int" : suf === "cla" ? "cla" : "nor";
  return { hue: H[hue] !== undefined ? hue : "verde", intensity };
}

export function combine(hue: string, intensity: Intensity): string {
  return intensity === "nor" ? hue : `${hue}-${intensity}`;
}
