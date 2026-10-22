// Acceso con una contraseña compartida del equipo (variable TEAM_PASSWORD en Vercel).
// Sin esa variable el tablero queda abierto para cualquiera que tenga el link.
import crypto from "node:crypto";

const COOKIE = "tablero_sesion";
const firma = () => crypto.createHmac("sha256", process.env.TEAM_PASSWORD || "").update("tablero-v1").digest("hex");
const igual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function autorizado(req) {
  if (!process.env.TEAM_PASSWORD) return true;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`).exec(req.headers.cookie || "");
  return !!m && igual(m[1], firma());
}

export function login(req, res) {
  const pass = String(req.body?.password || "");
  if (!process.env.TEAM_PASSWORD || !igual(crypto.createHash("sha256").update(pass).digest("hex"), crypto.createHash("sha256").update(process.env.TEAM_PASSWORD).digest("hex"))) return false;
  res.setHeader("Set-Cookie", `${COOKIE}=${firma()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${90 * 86400}`);
  return true;
}

export function logout(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
