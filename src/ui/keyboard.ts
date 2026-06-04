// Mapea o teclado físico ás teclas dos pads. Funciona en paralelo coa pantalla táctil.

const pressed = new Set<string>();

export interface KeyboardHandlers {
  onPress: (key: string) => void;
  onRelease: (key: string) => void;
}

function normalize(ev: KeyboardEvent): string | null {
  if (ev.code === "Space") return "SPACE";
  const k = ev.key;
  if (k === ",") return ",";
  if (k === ".") return ".";
  if (k.length === 1) {
    const upper = k.toUpperCase();
    if (/[0-9A-ZÑ]/.test(upper)) return upper;
  }
  return null;
}

function typingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function attachKeyboard(handlers: KeyboardHandlers): void {
  window.addEventListener("keydown", (ev) => {
    if (ev.repeat || typingInField()) return;
    const key = normalize(ev);
    if (!key) return;
    ev.preventDefault();
    if (pressed.has(key)) return;
    pressed.add(key);
    handlers.onPress(key);
  });

  window.addEventListener("keyup", (ev) => {
    const key = normalize(ev);
    if (!key) return;
    pressed.delete(key);
    handlers.onRelease(key);
  });

  // Se a xanela perde o foco, soltamos todo (evita teclas "pegadas" en modo hold).
  window.addEventListener("blur", () => {
    for (const key of [...pressed]) {
      pressed.delete(key);
      handlers.onRelease(key);
    }
  });
}
