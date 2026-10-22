import { autorizado } from "../lib/auth.js";
import { listarPedidos, guardarPedido, borrarPedido, redis } from "../lib/datos.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!autorizado(req)) return res.status(401).json({ error: "login" });
  try {
    if (req.method === "GET") return res.json(await listarPedidos({ fresca: req.query.fresca === "1" }));
    if (!redis) return res.status(503).json({ error: "Falta conectar la base de datos (Upstash Redis) en Vercel." });
    if (req.method === "POST") {
      const id = await guardarPedido(req.body?.id || null, req.body?.datos || {});
      return res.json({ id });
    }
    if (req.method === "DELETE") { await borrarPedido(req.query.id); return res.status(204).end(); }
    res.status(405).end();
  } catch (e) {
    console.error(e);
    res.status(e.code === "sin_acceso" || e.code === "sin_credenciales" || e.code === "google_auth" || e.code === "api_desactivada" || e.code === "google_error" ? 502 : 400).json({ error: e.message, code: e.code || "error" });
  }
}
