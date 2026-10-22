# Tablero de pedidos a Diseño

Lee la hoja "2026" de la planilla "Pedidos a Diseño :)" desde el servidor y muestra estados, flags (⛔ trancado → reclamar, ⚠️ pendiente a ≤7 días del deadline → alguien lo toma), timeline y resumen para Teams. Lo que se carga en el tablero (qué falta, cambios de status o diseñador, pedidos nuevos) se guarda en Upstash Redis y lo ve todo el equipo. Si alguien cambia esa misma columna en la planilla, gana la planilla.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Qué es |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | El contenido completo del JSON de la cuenta de servicio de Google. La planilla tiene que estar compartida con su mail como Lector. |
| `TEAM_PASSWORD` | Opcional. Contraseña que usa el equipo para entrar; sin ella el tablero queda abierto para quien tenga el link. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Las crea solo Vercel al agregar Upstash Redis desde Storage / Marketplace. |
| `SHEET_ID`, `SHEET_NAME`, `MIN_FILA` | Opcionales. Por defecto la planilla actual, hoja `2026`, desde la fila 959. |

Las filas ocultas en la planilla no entran al tablero.
