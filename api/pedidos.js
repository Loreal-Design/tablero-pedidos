import { autorizado } from "../lib/auth.js";
import { listarPedidos, guardarPedido, borrarPedido, redis } from "../lib/datos.js";
import { leerPlanilla, MIN_FILA, SHEET_NAME } from "../lib/planilla.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!autorizado(req)) return res.status(401).json({ error: "login" });
  try {
    // Diagnóstico: /api/pedidos?fila=1604 muestra qué lee el servidor de esa fila y por qué entra o no.
    if (req.method === "GET" && req.query.fila) {
      const { rows, at } = await leerPlanilla({ fresca: true });
      const filas = Object.keys(rows).map(Number);
      const r = rows[req.query.fila];
      const motivo = !r ? "La fila está vacía o no existe en la hoja " + SHEET_NAME
        : r.hidden ? "La fila está oculta" : Number(req.query.fila) < MIN_FILA ? "Es anterior a la fila " + MIN_FILA
        : r.rec.status === "Finalizado" ? "Está finalizada" : "Debería aparecer en el tablero";
      return res.json({ hoja: SHEET_NAME, leidaEn: new Date(at).toISOString(), ahora: new Date().toISOString(), filasConDatos: filas.length, ultimaFila: Math.max(0, ...filas), fila: r || null, motivo });
    }
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
