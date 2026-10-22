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
    iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
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
    const code = r.status === 403 || r.status === 404 ? "sin_acceso" : "google_error";
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
