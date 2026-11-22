# Anexo B — Contratos privados y propagación de confianza

## Reglas comunes

Todas las llamadas son HTTPS con CA verificada. No hay API privada de propósito general accesible desde el navegador. Salvo `GET /health` (solo vida, sin datos), se exige identidad técnica dirigida y luego autorización por consumidor/rol/propiedad. El secreto `K_A_B` solo es conocido por A como emisor y B como receptor; no habilita a otros destinos. El principal de usuario no se acepta sin la firma de esa llamada.

Cabeceras generadas por `TechnicalIdentity`: `X-Service`, `X-Audience`, `X-User-Context`, `X-Timestamp`, `X-Nonce`, `X-Signature`. La forma exacta está en `TechnicalIdentity.java`; la cadena canónica incluye emisor, audiencia, verbo, URI completa, SHA-256 del cuerpo, principal serializado, tiempo y nonce. Tolerancia de reloj ±30 s; nonce de un solo uso durante esa ventana. Sin identidad: 403. Firma/alcance/replay inválidos: 403. Sincronizar relojes del despliegue.

No se usan JWT autocontenidos ni gRPC; la sesión opaca del usuario se introspecta en Auth, y después solo se propaga el principal verificado. Las credenciales de base nunca viajan por el navegador ni por GraphQL.

## Operaciones entre subsistemas

Los cuerpos son objetos JSON sin campos extra. `id`, `readerId`, `requestId`, `loanId` son strings de recurso; `items` contiene snapshots de ejemplares y plazos. Las rutas del gateway al servicio se enumeran, sin abreviar, en `rutas_y_credenciales.csv` y `contratos.md`.

| Emisor → receptor | Método / ruta privada | Entrada y validación | Salida / error / idempotencia |
|---|---|---|---|
| gateway → auth | POST /introspect | token de sesión, string URL-safe 43; solo gateway | id, role, expiresAt; 401 inexistente/revocado/vencido |
| clients → auth | POST /accounts/check-email | ADMIN; email con formato válido | available:boolean; no expone cuentas ni claves |
| clients → auth | POST /accounts | id, email, passwordHash PBKDF2 600000; solo clients | 201 id/state INACTIVE; mismo id devuelve existente; correo duplicado409 |
| clients → auth | POST /accounts/{id}/activation | ADMIN; cuerpo {}; cuenta INACTIVE | queued, expiresInHours=24, previousLinkRevoked; 409 si activa; nuevo evento versionado |
| auth → clients | POST /activate/{id} | id existente; solo Auth; no cuerpo personal | active:true; repetible sin doble alta; 404 si falta ficha |
| orders → clients | GET /eligibility/{id} | lector propio o personal que prepara entrega | id, active:boolean; no contacto ni huella |
| orders → clients | POST /verify | LIBRARIAN; readerId, rut válido, fingerprint32–2048 | verified, readerId, adapter;403 identidad no coincide; prueba determinista, no SDK físico |
| notifications → clients | GET /contact/{id} | solo notifications y lector existente | email, names mínimos para correo; no ficha completa |
| orders → inventory | POST /allocate | READER dueño; requestId, readerId, copyIds1–5 únicos, mode | 201 Allocation{id,state,ownerId,mode,items,digest,expiresAt}; todo o nada; requestId+digest deduplican;409 stock/reserva/cuerpo distinto |
| orders → inventory | GET /allocations/{id} | solo orders | Allocation actualizado por mantenimiento; 404 si no existe |
| orders → inventory | DELETE /allocations/{id} | solo orders; no COMMITTED | released:true; ausente/repetido inocuo;409 si ya se entregó |
| orders → inventory | POST /commit | requestId,loanId; solo orders; retención vigente | Allocation COMMITTED con issuedAt/items/dueAt del servidor; mismo loanId repite resultado;409 vencida/otra entrega/reserva conflictiva |
| orders → inventory | POST /return | copyId,loanId,returnedAt ISO, no futuro>60s; solo orders | copyId,state RESHELVING,readyAt; lastReturnLoanId deduplica;409 asociación no coincide |
| orders → inventory | POST /reserve | READER dueño; reservationId,readerId,copyId,date hoy..+90d,mode | slot{id=copia_fecha,reservationId,ownerId,state,copyId,documentId,date,mode}; una reserva activa por copia/día;409 conflicto |
| orders → inventory | DELETE /reservations/{id} | solo orders; dueño si es READER | cancelled:true; conserva historial; repetible |
| graphql → inventory | POST /documents/batch | ids:string[]≤100, formato ID | items:CatalogDocumentDTO[]; una llamada para todos los documentos de una página; sin lectores |
| orders → payments | POST /assessments | loanId,readerId; solo orders | 201 Assessment EXEMPT/0CLP; misma PK loanId devuelve lo mismo;409 dueño distinto |
| graphql → payments | POST /assessments/batch | roles R/L/A; loanIds:list≤20 | items:Assessment[]; cada recurso exige dueño si READER;403 ajeno |
| graphql → clients | GET /readers/{id} | rol+propiedad; misma política que S15 | ReaderDTO filtrado por rol, sin hashes ni plantilla |
| graphql → orders | GET /loans?readerId&size&page | roles R/L/A, READER propio | LoanPage + sanctionUntil; paginación≤20 |
| graphql → orders | GET /reservations?readerId&size&page | READER propio, bibliotecario o ADMIN (solo caller graphql para ADMIN) | ReservationPage; mantiene S26 público sin ADMIN |
| auth → notifications | POST /events | id,kind=ACTIVATION,readerId,token; solo Auth para este tipo | 201 id,accepted:true; mismo id/cuerpo deduplica; cambios409 |
| orders → notifications | POST /events | id,kind=RECEIPT/OVERDUE,readerId,loanId; items en comprobante | 201 id,accepted:true; outbox solo se marca SENT tras aceptación; duplicados iguales inocuos |
| notifications → mail | POST /send | id,to5–160,subject3–120,text5–20000; solo notifications | 201 id,status=ACCEPTED_BY_TEST_PROVIDER,internetDelivery:false; mismo id/cuerpo deduplica; cambios409 |
| cada consumidor → secrets | GET /v1/secrets/{propioNombre} | Bearer bootstrap propio, ACL del manager; TLS | solo paquete de esa identidad;403 otro consumidor; no endpoint de escritura remota |

**Alcance administrativo:** P03 usa GraphQL como lector. S32 también permite ADMIN con `readerId` explícito. La consulta de reservas interna permite ADMIN únicamente al caller `graphql`; la ruta pública S26 sigue denegada para ese rol. T08 comprueba tanto la cuenta administrativa válida como la separación de la ruta pública y el recurso ajeno de un READER.

## Ejemplos ficticios de llamadas privadas

No se publican firmas ni valores técnicos reales. En los ejemplos, HTTPS y las seis cabeceras técnicas anteriores son obligatorios.

```json
{"requestId":"q-ejemplo","readerId":"r-ejemplo","copyIds":["BEC-0001-1"],"mode":"HOME"}
```

```json
{"id":"q-ejemplo","state":"HELD","ownerId":"r-ejemplo","mode":"HOME","expiresAt":"2026-11-20T15:20:00Z","items":[{"copyId":"BEC-0001-1","documentId":"d-ejemplo","title":"Relato ficticio","homeDays":7,"roomHours":2,"shelf":"A-01"}],"digest":"SHA256_FICTICIO"}
```

```json
{"requestId":"q-ejemplo","loanId":"l-ejemplo"}
```

```json
{"loanId":"l-ejemplo","readerId":"r-ejemplo"}
```

```json
{"id":"l-ejemplo","loanId":"l-ejemplo","ownerId":"r-ejemplo","amount":0,"currency":"CLP","state":"EXEMPT","policyId":"MUNICIPAL_FREE","createdAt":"2026-11-20T15:00:00Z"}
```

```json
{"id":"overdue-l-ejemplo-2026-11-28","kind":"OVERDUE","readerId":"r-ejemplo","loanId":"l-ejemplo"}
```

## Propiedad, fallas y transacciones

No hay consultas a otra base ni transacción distribuida. La retención de stock y el slot de reserva son autoridad de Inventory; la historia del préstamo y la sanción son de Orders. La copia de estado de reserva en Orders es una proyección para la cuenta. La consistencia es eventual entre subsistemas y fuerte dentro de cada comando local.

Timeout de conexión 2 s, de llamada HTTP interna 4 s. Fallas 5xx/timeout se sanitizan a 502; no se ocultan con un préstamo ficticio. La operación durable queda en un estado transitorio para que el worker reintente con los mismos IDs. Un 4xx de negocio no se reintenta sin corregir la causa. Los eventos se aceptan al menos una vez y se deduplican por ID + hash, no se promete transporte “exactamente una vez”.

Los workers usan los mismos contratos autenticados y corren cada segundo. El backoff del correo es exponencial hasta 256 s en el algoritmo actual (límite superior configurado en expresión: 300 s). No hay broker, retry automático ilimitado de comandos desde el navegador ni acceso directo SQL entre servicios.
