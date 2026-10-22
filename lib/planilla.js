// Lee la hoja "2026" de la planilla de pedidos con una cuenta de servicio de Google (Sheets API, solo lectura).
import crypto from "node:crypto";

export const SHEET_ID = process.env.SHEET_ID || "16bKPQqZj5fSmMkUjinLphfF655xErcPp9PkSm_P_aFI";
export const SHEET_NAME = process.env.SHEET_NAME || "2026";
// Filas anteriores a esta son pedidos de 2025 que quedaron sin cerrar: no entran al tablero.
export const MIN_FILA = Number(process.env.MIN_FILA || 959);
export const STATUSES = ["Pendiente", "En proceso", "Para encarar hoy", "Trancado", "Finalizado"];
// Columnas de la planilla que el tablero muestra (las demás son solo del tablero).
export const PF = ["division", "canal", "marca", "campana", "pedido", "prioridad", "ingreso", "inicio", "deadline", "disenador", "status", "comentarios"];

function credenciales() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) throw Object.assign(new Error("Falta la variable GOOGLE_SERVICE_ACCOUNT"), { code: "sin_credenciales" });
  const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const j = JSON.parse(txt);
  return { email: j.client_email, key: j.private_key.replace(/\\n/g, "\n") };
}

let token = { value: null, exp: 0 };
async function accessToken() {
  if (token.value && Date.now() < token.exp - 60_000) return token.value;
  const { email, key } = credenciales();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const jwt = unsigned + "." + crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error("Google rechazó la cuenta de servicio: " + (j.error_description || j.error)), { code: "google_auth" });
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

function cellDate(c) {
  const v = c?.effectiveValue?.numberValue;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((c?.formattedValue || "").trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
const str = (c) => (c?.formattedValue ?? "").trim();

let cache = { at: 0, rows: null };
const CACHE_MS = 60_000;

// Devuelve { [fila]: { hidden, rec } } con las filas no vacías de la hoja.
export async function leerPlanilla({ fresca = false } = {}) {
  if (!fresca && cache.rows && Date.now() - cache.at < CACHE_MS) return { rows: cache.rows, at: cache.at };
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`);
  url.searchParams.set("ranges", `'${SHEET_NAME}'!A1:M`);
  url.searchParams.set("includeGridData", "true");
  url.searchParams.set("fields", "sheets(data(startRow,rowMetadata(hiddenByUser),rowData(values(formattedValue,effectiveValue))))");
  const r = await fetch(url, { headers: { authorization: "Bearer " + (await accessToken()) } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = j.error?.message || "";
    const code = /has not been used|is disabled|SERVICE_DISABLED/i.test(msg + JSON.stringify(j.error?.details || "")) ? "api_desactivada"
      : r.status === 403 || r.status === 404 ? "sin_acceso" : "google_error";
    throw Object.assign(new Error(j.error?.message || "Error " + r.status), { code });
  }
  const data = (await r.json()).sheets?.[0]?.data?.[0] || {};
  const start = data.startRow || 0, meta = data.rowMetadata || [], rowData = data.rowData || [];
  const rows = {};
  for (let i = 1; i < rowData.length; i++) {
    const c = rowData[i]?.values || [];
    if (!c.slice(0, 13).some((x) => str(x))) continue;
    const fila = start + i + 1;
    const st = str(c[10]);
    rows[fila] = {
      hidden: !!meta[i]?.hiddenByUser,
      rec: {
        division: str(c[0]), canal: str(c[1]) || "DIGITAL", marca: str(c[2]), campana: str(c[3]), pedido: str(c[4]),
        prioridad: str(c[5]), ingreso: cellDate(c[6]), inicio: cellDate(c[7]), deadline: cellDate(c[8]),
        disenador: str(c[9]), status: STATUSES.includes(st) ? st : "Pendiente", comentarios: str(c[12]),
      },
    };
  }
  cache = { at: Date.now(), rows };
  return { rows, at: cache.at };
}

// ---------- escritura ----------
// La cuenta de servicio solo puede escribir si la planilla está compartida con ella como Editor.
// Sin ese permiso Google responde 403 y el tablero guarda el cambio solo para sí (ver datos.js).
const COL = { division: "A", canal: "B", marca: "C", campana: "D", pedido: "E", prioridad: "F", ingreso: "G", inicio: "H", deadline: "I", disenador: "J", status: "K", comentarios: "M" };
const FECHAS = new Set(["ingreso", "inicio", "deadline"]);
const aCelda = (k, v) => {
  const m = FECHAS.has(k) && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return m ? `${+m[3]}/${m[2]}/${m[1]}` : v ?? "";
};

async function sheets(path, { method = "GET", body } = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method, headers: { authorization: "Bearer " + (await accessToken()), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || "Error " + r.status), { code: r.status === 403 ? "sin_permiso_escritura" : "google_error" });
  return j;
}

async function confirmarFila(fila, esperado) {
  const rango = encodeURIComponent(`'${SHEET_NAME}'!A${fila}:M${fila}`);
  const actual = (await sheets(`/values/${rango}`)).values?.[0] || [];
  const ahora = { marca: (actual[2] || "").trim(), campana: (actual[3] || "").trim(), pedido: (actual[4] || "").trim() };
  if (esperado && ["marca", "campana", "pedido"].some((k) => (esperado[k] ?? "") !== ahora[k]))
    throw Object.assign(new Error("Esa fila de la planilla cambió mientras editabas. Tocá Actualizar y probá de nuevo."), { code: "fila_movida" });
}

// Vacía las columnas A a M de la fila, después de confirmar que sigue siendo el mismo pedido.
export async function vaciarFila(fila, esperado) {
  if (!esperado) throw Object.assign(new Error("Falta indicar qué pedido se borra"), { code: "id" });
  await confirmarFila(fila, esperado);
  await sheets(`/values/${encodeURIComponent(`'${SHEET_NAME}'!A${fila}:M${fila}`)}:clear`, { method: "POST", body: {} });
  cache.at = 0;
}

// Escribe en la fila solo las columnas cambiadas. Antes confirma que la fila sigue siendo el mismo pedido
// (marca, campaña y pedido), por si alguien insertó o borró filas arriba mientras tanto.
export async function escribirFila(fila, cambios, esperado) {
  await confirmarFila(fila, esperado);
  const data = Object.entries(cambios).filter(([k]) => COL[k])
    .map(([k, v]) => ({ range: `'${SHEET_NAME}'!${COL[k]}${fila}`, values: [[aCelda(k, v)]] }));
  if (data.length) await sheets("/values:batchUpdate", { method: "POST", body: { valueInputOption: "USER_ENTERED", data } });
  cache.at = 0;
}

// Agrega un pedido nuevo en la primera fila vacía desde MIN_FILA (o sea, justo debajo del último pedido) y devuelve su número de fila.
// No usa "append" de Google: la hoja tiene cientos de filas vacías ya preparadas al final y append escribe después de todas.
export async function agregarFila(rec) {
  const fila = Array(13).fill("");
  for (const [k, c] of Object.entries(COL)) fila["ABCDEFGHIJKLM".indexOf(c)] = aCelda(k, rec[k]);
  const { rows } = await leerPlanilla({ fresca: true });
  let n = MIN_FILA;
  while (rows[n]) n++;
  const rango = encodeURIComponent(`'${SHEET_NAME}'!A${n}:M${n}`);
  try {
    await sheets(`/values/${rango}?valueInputOption=USER_ENTERED`, { method: "PUT", body: { values: [fila] } });
  } catch (e) {
    if (e.code !== "google_error") throw e; // la hoja no tiene más filas: se agrega una al final
    await sheets(`/values/${rango}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", body: { values: [fila] } });
  }
  cache.at = 0;
  return n;
}
