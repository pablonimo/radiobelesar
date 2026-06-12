import type { Pad } from "../state.js";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* corpo non-JSON */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function login(password: string): Promise<void> {
  await asJson(
    await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    }),
  );
}

export async function checkSession(): Promise<boolean> {
  try {
    const { authenticated } = await asJson<{ authenticated: boolean }>(
      await fetch("/api/session", { credentials: "include" }),
    );
    return authenticated;
  } catch {
    return false;
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  await asJson(
    await fetch("/api/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ current, next }),
    }),
  );
}

export async function fetchPads(): Promise<Pad[]> {
  const { pads } = await asJson<{ pads: Pad[] }>(
    await fetch("/api/pads", { credentials: "include" }),
  );
  return pads;
}

export interface UploadMeta {
  displayName?: string;
  duration?: number;
  peaks?: number[];
  color?: string;
}

export async function uploadSound(
  bank: number,
  key: string,
  file: File,
  meta: UploadMeta,
): Promise<Pad> {
  const form = new FormData();
  if (meta.displayName) form.set("displayName", meta.displayName);
  if (meta.duration != null) form.set("duration", String(meta.duration));
  if (meta.peaks) form.set("peaks", JSON.stringify(meta.peaks));
  if (meta.color) form.set("color", meta.color);
  form.set("file", file);

  const { pad } = await asJson<{ pad: Pad }>(
    await fetch(`/api/pads/${bank}/${encodeURIComponent(key)}/sound`, {
      method: "POST",
      credentials: "include",
      body: form,
    }),
  );
  return pad;
}

export async function updatePad(
  bank: number,
  key: string,
  patch: Partial<Pad>,
): Promise<Pad> {
  const { pad } = await asJson<{ pad: Pad }>(
    await fetch(`/api/pads/${bank}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    }),
  );
  return pad;
}

export async function deleteSound(bank: number, key: string): Promise<Pad> {
  const { pad } = await asJson<{ pad: Pad }>(
    await fetch(`/api/pads/${bank}/${encodeURIComponent(key)}/sound`, {
      method: "DELETE",
      credentials: "include",
    }),
  );
  return pad;
}
