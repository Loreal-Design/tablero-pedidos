import { login, logout } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method === "DELETE") { logout(res); return res.status(204).end(); }
  if (req.method !== "POST") return res.status(405).end();
  await new Promise((r) => setTimeout(r, 400)); // frena intentos de adivinar la contraseña
  if (!login(req, res)) return res.status(401).json({ error: "Contraseña incorrecta" });
  res.status(204).end();
}
