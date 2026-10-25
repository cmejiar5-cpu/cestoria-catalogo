// Renueva cada semana la llave de acceso de Instagram (dura 60 días si no se renueva).
// Lunes 08:00 UTC = 03:00 en Colombia (UTC-5).
import { igStore, refreshToken, addLog } from "../lib/instagram.mjs";

export default async function handler(request, context) {
  const store = igStore(context);
  try {
    const r = await refreshToken(store);
    if (r.ok) await addLog(store, { result: "llave renovada hasta " + r.expiresAt });
  } catch (e) {
    await addLog(store, { result: "error al renovar la llave: " + String(e.message).slice(0, 200) });
  }
}

export const config = { schedule: "0 8 * * 1" };
