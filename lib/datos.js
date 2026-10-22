// Lo que el equipo carga en el tablero y la planilla no tiene: qué falta, cambios hechos desde el tablero,
// pedidos nuevos y cuándo se finalizó cada uno. Vive en Redis (Upstash, desde el Marketplace de Vercel).
import { Redis } from "@upstash/redis";
import { leerPlanilla, escribirFila, agregarFila, MIN_FILA, PF } from "./planilla.js";

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = url && tok ? new Redis({ url, token: tok }) : null;

const K = { cambios: "tablero:cambios", extra: "tablero:extra", visto: "tablero:visto" };
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const hoy = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // hora de Uruguay/Argentina

// Un cambio hecho en el tablero sobre una columna de la planilla vale mientras la planilla siga con el valor
// que tenía cuando se hizo (`origen`). Si alguien la cambia en la planilla, gana la planilla.
export async function listarPedidos({ fresca = false } = {}) {
  const { rows, at } = await leerPlanilla({ fresca });
  const [cambios, extra, visto] = redis
    ? await Promise.all([redis.hgetall(K.cambios), redis.hgetall(K.extra), redis.hgetall(K.visto)])
    : [null, null, null];
  const ch = cambios || {}, vis = visto || {};
  const primeraVez = redis && !visto;
  const nuevosVistos = {};
  const pedidos = [];
  for (const [filaStr, { hidden, rec }] of Object.entries(rows)) {
    const fila = Number(filaStr);
    if (hidden || fila < MIN_FILA) continue;
    const id = "fila-" + fila;
    const c = ch[id] ? parse(ch[id]) : {};
    const p = { id, fila: String(fila), ...rec, falta: c.falta || "", finalizadoEn: "", creado: "", _orig: { marca: rec.marca, campana: rec.campana, pedido: rec.pedido } };
    for (const k of PF) if (c.ov?.[k] && c.ov[k].origen === rec[k]) p[k] = c.ov[k].v;
    const v = vis[id] ? parse(vis[id]) : null;
    if (p.status === "Finalizado") {
      // Solo se muestran los que el tablero vio abiertos: así sabemos cuándo se cerraron.
      if (!v) continue;
      if (!v.fin) { v.fin = c.finalizadoEn || hoy(); nuevosVistos[id] = v; }
      p.finalizadoEn = v.fin;
    } else if (!v) {
      nuevosVistos[id] = { desde: primeraVez ? "" : new Date().toISOString() };
    } else if (v.fin) {
      nuevosVistos[id] = { desde: v.desde };
    }
    p.creado = (nuevosVistos[id] || v)?.desde || "";
    pedidos.push(p);
  }
  if (redis && Object.keys(nuevosVistos).length) {
    await redis.hset(K.visto, Object.fromEntries(Object.entries(nuevosVistos).map(([k, x]) => [k, JSON.stringify(x)])));
  }
  for (const [id, x] of Object.entries(extra || {})) pedidos.push({ id, ...parse(x) });
  return { pedidos, leidaEn: new Date(at).toISOString(), ahora: new Date().toISOString(), editable: !!redis };
}

const CAMPOS = [...PF, "falta"];
const limpiar = (o) => Object.fromEntries(CAMPOS.filter((k) => k in o).map((k) => [k, String(o[k] ?? "").slice(0, 2000)]));

// Primero intenta escribir el cambio en la planilla. Si la cuenta de servicio no tiene permiso de Editor,
// lo guarda solo en el tablero como antes. "Qué falta" siempre queda en el tablero (la planilla no tiene esa columna).
export async function guardarPedido(id, datos, esperado) {
  const d = limpiar(datos);
  if (!id) {
    try {
      const hoyPrio = d.status === "Para encarar hoy" ? { status: "Pendiente", prioridad: "Para hoy" } : {};
      const fila = await agregarFila({ canal: "DIGITAL", status: "Pendiente", ...d, ...hoyPrio });
      if (fila) {
        const nid = "fila-" + fila;
        if (d.falta) await redis.hset(K.cambios, { [nid]: JSON.stringify({ ov: {}, falta: d.falta }) });
        await redis.hset(K.visto, { [nid]: JSON.stringify({ desde: new Date().toISOString() }) });
        return { id: nid, enPlanilla: true };
      }
    } catch (e) { if (e.code !== "sin_permiso_escritura") throw e; }
  }
  if (!id || id.startsWith("x-")) {
    const nid = id || "x-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const prev = id ? parse((await redis.hget(K.extra, id)) || "null") : null;
    const fin = d.status === "Finalizado" ? prev?.finalizadoEn || hoy() : "";
    const p = { ...prev, ...d, finalizadoEn: fin, creado: prev?.creado || new Date().toISOString(), actualizado: new Date().toISOString() };
    await redis.hset(K.extra, { [nid]: JSON.stringify(p) });
    return { id: nid, enPlanilla: false };
  }
  const m = /^fila-(\d+)$/.exec(id);
  if (!m) throw Object.assign(new Error("id inválido"), { code: "id" });
  const { rows } = await leerPlanilla();
  const rec = rows[m[1]]?.rec;
  if (!rec) throw Object.assign(new Error("La fila ya no está en la planilla"), { code: "no_fila" });
  const c = parse((await redis.hget(K.cambios, id)) || "null") || { ov: {} };
  c.ov ||= {};
  const deLaPlanilla = Object.fromEntries(PF.filter((k) => k in d).map((k) => [k, d[k]]));
  // En la planilla "para hoy" se marca en Prioridad, no en Status.
  if (deLaPlanilla.status === "Para encarar hoy") { delete deLaPlanilla.status; deLaPlanilla.prioridad = "Para hoy"; }
  let enPlanilla = false;
  if (Object.keys(deLaPlanilla).length) {
    try { await escribirFila(m[1], deLaPlanilla, esperado); enPlanilla = true; }
    catch (e) { if (e.code !== "sin_permiso_escritura") throw e; }
  }
  for (const k of PF) {
    if (!(k in d)) continue;
    if ((enPlanilla && k in deLaPlanilla) || d[k] === rec[k]) delete c.ov[k];
    else c.ov[k] = { v: d[k], origen: rec[k] };
  }
  if ("falta" in d) c.falta = d.falta;
  if (d.status === "Finalizado" && !c.finalizadoEn) c.finalizadoEn = hoy();
  if (d.status && d.status !== "Finalizado") c.finalizadoEn = "";
  c.actualizado = new Date().toISOString();
  await redis.hset(K.cambios, { [id]: JSON.stringify(c) });
  return { id, enPlanilla };
}

// Solo se pueden borrar pedidos creados en el tablero; los de la planilla se ocultan en la planilla.
export async function borrarPedido(id) {
  if (!id?.startsWith("x-")) throw Object.assign(new Error("Los pedidos de la planilla se sacan ocultando la fila"), { code: "no_borrable" });
  await redis.hdel(K.extra, id);
}
