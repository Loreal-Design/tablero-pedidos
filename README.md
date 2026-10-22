# Tablero de pedidos a Diseño

Lee la hoja "2026" de la planilla "Pedidos a Diseño :)" desde el servidor y muestra estados, flags (⛔ trancado → reclamar, ⚠️ pendiente a ≤7 días del deadline → alguien lo toma), timeline y resumen para Teams. Lo que se carga en el tablero (qué falta, cambios de status o diseñador, pedidos nuevos) se guarda en Upstash Redis y lo ve todo el equipo. Si la cuenta de servicio es Editor de la planilla, los cambios de columnas de la planilla y los pedidos nuevos se escriben directo en ella (antes de escribir se confirma que la fila sigue siendo el mismo pedido). "Qué falta" queda solo en el tablero.

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Qué es |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT` | El contenido completo del JSON de la cuenta de servicio de Google. Con la planilla compartida como Lector el tablero solo lee; como Editor, los cambios del tablero se escriben en la planilla. |
| `TEAM_PASSWORD` | Opcional. Contraseña que usa el equipo para entrar; sin ella el tablero queda abierto para quien tenga el link. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Las crea solo Vercel al agregar Upstash Redis desde Storage / Marketplace. |
| `SHEET_ID`, `SHEET_NAME`, `MIN_FILA` | Opcionales. Por defecto la planilla actual, hoja `2026`, desde la fila 959. |

Las filas ocultas en la planilla no entran al tablero.
