# Anexo A — Catálogo y contratos completos

Fuente de rutas: `src/main/java/cl/bec/Routes.java`. Generación: `python3 scripts/contracts.py`.
Todos los JSON siguientes son ficticios; los tokens A… y las contraseñas de ejemplo no funcionan. No hay credenciales iniciales fijas.

## Convenciones comunes

- Base `https://localhost:8443`; JSON UTF-8, `Content-Type: application/json` cuando hay cuerpo; campos extra rechazados excepto intención de pago deliberadamente rechazada.
- IDs de ruta: 1–100 caracteres `[A-Za-z0-9_-]`. Fechas/hora UTC ISO-8601 con `Z`; fecha de reserva y plazos de negocio en `America/Santiago`.
- `Authorization: Bearer <sesión>` para operaciones protegidas. Catálogo, política de gratuidad, login y activación permiten anónimo; un Bearer inválido, aun en ruta pública, se rechaza.
- `Idempotency-Key` obligatorio en S17/S24/S25: 8–80 caracteres `[A-Za-z0-9_-]`; misma clave y cuerpo distinto →409. S20 usa ID de solicitud como clave natural.
- `X-Correlation-ID` opcional, 8–64 caracteres alfanuméricos/guión; se recomienda UUID. Si no es válido, el servidor genera uno. Se devuelve en cabecera y en errores. No hay llaves técnicas en el cliente.
- Comunes: 400 JSON/validación; 401 sesión ausente/inválida/vencida; 403 rol/propiedad; 404 recurso/ruta; 405 verbo no publicado; 413 cuerpo>256KiB; 414 URI>2048; 415 tipo de contenido; 429 64 peticiones activas o rate limit; 502 dependencia; 503 secretos/persistencia propia; 500 error controlado sin stack trace.
- Límite por IP/minuto: login 10, API 6000; fijo por minuto, no distribuido. Las pruebas aisladas elevan únicamente login para no bloquear fixtures.
- DELETE es cancelación o baja lógica donde corresponde; no se inventan DELETE de préstamos, lectores, pagos ni auditoría.

Error REST común:
```json
{
  "error": {
    "code": "VALIDATION",
    "message": "Datos inválidos.",
    "correlationId": "00000000-0000-4000-8000-000000000001"
  }
}
```

## Tipos de entrada: obligatoriedad, validación y clasificación

### LoginInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| email | string | Sí | Correo normalizado a minúsculas; 5–160; formato de correo. | Personal |
| password | string | Sí | 1–128 al ingresar; se transmite solo por TLS. | Credencial |

### ActivationInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| token | string | Sí | Token de un uso: longitud 43; vence a las 24 horas; el reenvío revoca el anterior. | Credencial |

### EmptyInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|

### DocumentInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| title | string | Sí | 2–200 caracteres. | Público |
| author | string | Sí | 2–140. | Público |
| type | string | Sí | Tipo documental. | Público |
| medium | string | Sí | BOOK/TECHNICAL solo PAPER; AUDIO/VIDEO nunca PAPER. DIGITAL es soporte, no streaming. | Público |
| publisher | string | Sí | 2–120. | Público |
| edition | string | Sí | 1–40. | Público |
| year | integer | Sí | 1450 hasta el año del servidor. | Público |
| shelf | string | Sí | 1–40; ubicación general. | Público |
| category | string | Sí | 2–80. | Público |
| homeDays | integer | Sí | Plazo de domicilio, 1–30 días. | Público |
| roomHours | integer | Sí | Plazo sala, 1–8 h; siempre termina el mismo día. | Público |
| description | string | No | Opcional, máximo 2000; permite saltos de línea. PUT sin este campo conserva el valor anterior. | Público |
| stock | integer | No | Opcional: 0–200 ejemplares activos; ajuste atómico con el documento. Reducir no retira prestados/retenidos/reservados/en reposición. Omitirlo conserva stock existente. | Público |

### CopyInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| code | string | Sí | Único; 3–40; A–Z, 0–9 y guión. | Público |
| shelf | string | Sí | 1–40. | Público |

### ShelfInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| shelf | string | Sí | 1–40 caracteres. | Público |

### ReaderInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| rut | string | Sí | RUN con módulo 11 válido; único, con o sin puntos; 7–8 dígitos y DV. | Personal restringido |
| names | string | Sí | 2–80. | Personal |
| surnames | string | Sí | 2–100. | Personal |
| address | string | Sí | 5–200. | Personal restringido |
| email | string | Sí | Único, formato correo 5–160. | Personal restringido |
| telephone | string | Sí | 8–20 caracteres; no se presupone verificación telefónica. | Personal restringido |
| photo | string | Sí | PNG/JPEG base64; máximo 128000 bytes decodificados, imagen ≤1024×1024; texto 40–180000. | Personal restringido |
| fingerprint | string | Sí | Muestra BASE64 determinista TEST; 32–2048 caracteres, ≥24 bytes; no SDK de reconocimiento físico. | Personal biométrico restringido |
| password | string | Sí | 12–128 al inscribir; nunca se devuelve ni se registra en logs. | Credencial |
| documentsChecked | boolean | Sí | Debe ser true; comprobación a cargo del administrativo. | Personal restringido |

### ContactInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| address | string | Sí | 5–200. | Personal restringido |
| telephone | string | Sí | 8–20. | Personal restringido |
| photo | string | Sí | Mismas reglas PNG/JPEG de inscripción. | Personal restringido |

### RequestInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| copyIds | array | Sí | 1–5 IDs, únicos, existentes; cada ID [A-Za-z0-9_-], 1–80. | Contextual |
| mode | string | Sí | Modalidad seleccionada. | Público |

### IssueInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| rut | string | Sí | RUN válido del lector de la solicitud, módulo 11. | Personal restringido |
| fingerprint | string | Sí | Muestra TEST 32–2048 que debe coincidir; nunca se acepta verified:true del frontend. | Personal biométrico restringido |

### ReturnInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| copyId | string | Sí | Código de ejemplar con ítem ACTIVE; 3–40. | Contextual |

### ReservationInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| copyId | string | Sí | Código 3–40. | Contextual |
| date | string | Sí | ISO AAAA-MM-DD; hoy (Santiago) a hoy+90 días. | Contextual |
| mode | string | Sí | Modalidad. | Público |

### GraphQLInput

Objeto JSON; sin propiedades adicionales.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|
| query | string | Sí | SDL de consulta, 5–8192; profundidad≤6, costo≤100; sin introspección. | Contextual |
| variables | object | No | Opcional; JSON serializado ≤4096 caracteres; first 1–20, page 0–1000. | Contextual |
| operationName | string | No | Opcional 1–80. | Contextual |

### TamperedIntent

Cualquier intención monetaria se rechaza 422. No hay campos capaces de crear un pago ni levantar sanciones.

| Campo | Tipo | Obligatorio | Validación | Clasificación |
|---|---|---|---|---|

## Índice de acciones

| ID | Pantalla | Verbo y ruta | Responsable |
|---|---|---|---|
| S01 | P02 | POST `/api/auth/login` | auth |
| S02 | P02 | POST `/api/auth/logout` | auth |
| S03 | P02 | POST `/api/auth/activate` | auth |
| S04 | P02 | GET `/api/auth/me` | auth |
| S05 | P01 | GET `/api/catalog` | inventory |
| S06 | P01 | GET `/api/catalog/{id}` | inventory |
| S07 | P04 | POST `/api/documents` | inventory |
| S08 | P04 | PUT `/api/documents/{id}` | inventory |
| S09 | P04 | DELETE `/api/documents/{id}` | inventory |
| S10 | P04 | POST `/api/documents/{id}/copies` | inventory |
| S11 | P04 | PUT `/api/copies/{id}` | inventory |
| S12 | P04 | DELETE `/api/copies/{id}` | inventory |
| S13 | P05 | POST `/api/readers` | clients |
| S14 | P05 | GET `/api/readers` | clients |
| S15 | P05 | GET `/api/readers/{id}` | clients |
| S16 | P05 | PUT `/api/readers/{id}` | clients |
| S17 | P01 | POST `/api/requests` | orders |
| S18 | P03,P06 | GET `/api/requests` | orders |
| S19 | P03,P06 | DELETE `/api/requests/{id}` | orders |
| S20 | P06 | POST `/api/requests/{id}/issue` | orders |
| S21 | P03,P06 | GET `/api/loans` | orders |
| S22 | P03,P06 | GET `/api/loans/{id}` | orders |
| S23 | P09 | GET `/api/loans/{id}/receipt` | orders |
| S24 | P07 | POST `/api/returns` | orders |
| S25 | P01 | POST `/api/reservations` | orders |
| S26 | P03,P06 | GET `/api/reservations` | orders |
| S27 | P03,P06 | DELETE `/api/reservations/{id}` | orders |
| S28 | P08 | GET `/api/overdue` | orders |
| S29 | P03 | GET `/api/payments/policy` | payments |
| S30 | P03 | GET `/api/payments/assessments/{id}` | payments |
| S31 | P03 | POST `/api/payments/intents` | payments |
| S32 | P03 | POST `/api/graphql` | graphql |
| S33 | P07 | GET `/api/exit-check/{id}` | inventory |
| S34 | P10 | GET `/api/lab/mailbox` | mail |
| S35 | P05 | POST `/api/readers/{id}/activation` | clients |

## Contratos individuales

### S01 — Iniciar sesión

**POST `/api/auth/login`** · pantalla P02 · Anónimo permitido.
Destino privado: `auth POST /login`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `LoginInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** Solo cuentas ACTIVE. Respuesta genérica no distingue correo inexistente/inactivo.

**Errores específicos.** 400 VALIDATION; 401 INVALID_CREDENTIALS; 429 RATE_LIMIT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "email": "lectora@bec.example.invalid",
  "password": "Ficticia_NoEsUnaClaveReal_2026"
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "expiresAt": "2026-11-20T15:20:00Z",
  "id": "r-ejemplo",
  "role": "READER"
}
```

### S02 — Revocar sesión

**POST `/api/auth/logout`** · pantalla P02 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `auth POST /logout`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `EmptyInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** El gateway usa el Bearer actual: ignora cualquier token del cuerpo. Revocación inmediata en Auth.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "revoked": true
}
```

### S03 — Validar correo de lector

**POST `/api/auth/activate`** · pantalla P02 · Anónimo permitido.
Destino privado: `auth POST /activate`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ActivationInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** Un solo uso, 24 horas; actualiza perfil y cuenta mediante contrato privado.

**Errores específicos.** 400 INVALID_ACTIVATION; 409 TOKEN_USED; 410 ACTIVATION_EXPIRED; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "activated": true
}
```

### S04 — Identidad de sesión

**GET `/api/auth/me`** · pantalla P02 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `auth GET /me`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: ninguno.

**Regla y autorización.** Rol permitido y reglas del contrato; denegación por defecto

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "r-ejemplo",
  "role": "READER"
}
```

### S05 — Buscar catálogo anónimo

**GET `/api/catalog`** · pantalla P01 · Anónimo permitido.
Destino privado: `inventory GET /documents`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: q (query, opcional); page (query, opcional); size (query, opcional); title (query, opcional); author (query, opcional); type (query, opcional); publisher (query, opcional); availability (query, opcional); subcategory (query, opcional).

**Regla y autorización.** Anónimo: filtros combinables por título/autor/tipo/editorial/disponibilidad/subcategoría; se aplican antes de paginar. MULTIMEDIA agrupa AUDIO y VIDEO. AVAILABLE significa available>0; UNAVAILABLE available=0; IN_ROOM inRoom>0. Texto de filtros sin distinguir mayúsculas/tildes. q conserva búsqueda general previa. Cuenta AVAILABLE y ROOM sin revelar prestatarios.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "d-ejemplo",
      "title": "Relatos del barrio (ficticio)",
      "author": "Autora Ficticia",
      "type": "BOOK",
      "medium": "PAPER",
      "publisher": "Editorial Ejemplo",
      "edition": "1",
      "year": 2026,
      "shelf": "A-01",
      "category": "Literatura",
      "homeDays": 7,
      "roomHours": 2,
      "description": "Descripción ficticia de la colección.",
      "state": "ACTIVE",
      "available": 1,
      "inRoom": 0,
      "total": 1,
      "copies": [
        {
          "id": "BEC-0001-1",
          "state": "AVAILABLE",
          "shelf": "A-01",
          "dueAt": null,
          "readyAt": null
        }
      ]
    }
  ],
  "total": 1,
  "page": 0,
  "size": 10
}
```

### S06 — Detalle y disponibilidad

**GET `/api/catalog/{id}`** · pantalla P01 · Anónimo permitido.
Destino privado: `inventory GET /documents/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Rol permitido y reglas del contrato; denegación por defecto

**Errores específicos.** 404 NOT_FOUND (incluido archivado); además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "d-ejemplo",
  "title": "Relatos del barrio (ficticio)",
  "author": "Autora Ficticia",
  "type": "BOOK",
  "medium": "PAPER",
  "publisher": "Editorial Ejemplo",
  "edition": "1",
  "year": 2026,
  "shelf": "A-01",
  "category": "Literatura",
  "homeDays": 7,
  "roomHours": 2,
  "description": "Descripción ficticia de la colección.",
  "state": "ACTIVE",
  "available": 1,
  "inRoom": 0,
  "total": 1,
  "copies": [
    {
      "id": "BEC-0001-1",
      "state": "AVAILABLE",
      "shelf": "A-01",
      "dueAt": null,
      "readyAt": null
    }
  ]
}
```

### S07 — Registrar documento

**POST `/api/documents`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory POST /documents`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `DocumentInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** Alta de documento. stock opcional crea de 0 a 200 ejemplares reales en la misma transacción; si se omite, se añaden después por S10.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "title": "Relatos del barrio (ficticio)",
  "author": "Autora Ficticia",
  "type": "BOOK",
  "medium": "PAPER",
  "publisher": "Editorial Ejemplo",
  "edition": "1",
  "year": 2026,
  "shelf": "A-01",
  "category": "Literatura",
  "homeDays": 7,
  "roomHours": 2,
  "description": "Descripción ficticia de la colección."
}
```
Salida JSON ficticia — HTTP 201:
```json
{
  "id": "d-ejemplo",
  "title": "Relatos del barrio (ficticio)",
  "author": "Autora Ficticia",
  "type": "BOOK",
  "medium": "PAPER",
  "publisher": "Editorial Ejemplo",
  "edition": "1",
  "year": 2026,
  "shelf": "A-01",
  "category": "Literatura",
  "homeDays": 7,
  "roomHours": 2,
  "description": "Descripción ficticia de la colección.",
  "state": "ACTIVE",
  "available": 0,
  "inRoom": 0,
  "total": 0,
  "copies": []
}
```

### S08 — Actualizar documento

**PUT `/api/documents/{id}`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory PUT /documents/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `DocumentInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** PUT conserva id; solo documento ACTIVE. description/stock opcionales conservan su valor si se omiten; si stock cambia, documento+ejemplares se guardan en una sola transacción.

**Errores específicos.** 400 VALIDATION; 404 NOT_FOUND; 409 ARCHIVED / STOCK_IN_USE; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "title": "Relatos del barrio (ficticio)",
  "author": "Autora Ficticia",
  "type": "BOOK",
  "medium": "PAPER",
  "publisher": "Editorial Ejemplo",
  "edition": "1",
  "year": 2026,
  "shelf": "A-01",
  "category": "Literatura",
  "homeDays": 7,
  "roomHours": 2,
  "description": "Descripción ficticia de la colección."
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "d-ejemplo",
  "title": "Relatos del barrio (ficticio)",
  "author": "Autora Ficticia",
  "type": "BOOK",
  "medium": "PAPER",
  "publisher": "Editorial Ejemplo",
  "edition": "1",
  "year": 2026,
  "shelf": "A-01",
  "category": "Literatura",
  "homeDays": 7,
  "roomHours": 2,
  "description": "Descripción ficticia de la colección.",
  "state": "ACTIVE",
  "available": 1,
  "inRoom": 0,
  "total": 1,
  "copies": [
    {
      "id": "BEC-0001-1",
      "state": "AVAILABLE",
      "shelf": "A-01",
      "dueAt": null,
      "readyAt": null
    }
  ]
}
```

### S09 — Archivar documento

**DELETE `/api/documents/{id}`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory DELETE /documents/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Baja lógica; retira ejemplares. No se elimina historia.

**Errores específicos.** 404 NOT_FOUND; 409 DOCUMENT_IN_USE / DOCUMENT_RESERVED; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "d-ejemplo",
  "state": "ARCHIVED"
}
```

### S10 — Incorporar ejemplar

**POST `/api/documents/{id}/copies`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory POST /documents/{id}/copies`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `CopyInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** Rol permitido y reglas del contrato; denegación por defecto

**Errores específicos.** 400 VALIDATION; 404 NOT_FOUND; 409 COPY_EXISTS / ARCHIVED; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "code": "BEC-0001-1",
  "shelf": "A-01"
}
```
Salida JSON ficticia — HTTP 201:
```json
{
  "id": "BEC-0001-1",
  "documentId": "d-ejemplo",
  "shelf": "A-01",
  "state": "AVAILABLE"
}
```

### S11 — Actualizar ubicación

**PUT `/api/copies/{id}`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory PUT /copies/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ShelfInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** Rol permitido y reglas del contrato; denegación por defecto

**Errores específicos.** 404 NOT_FOUND; 409 RETIRED; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "shelf": "A-02"
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "BEC-0001-1",
  "documentId": "d-ejemplo",
  "shelf": "A-02",
  "state": "AVAILABLE"
}
```

### S12 — Retirar ejemplar disponible

**DELETE `/api/copies/{id}`** · pantalla P04 · Bearer; Bibliotecario.
Destino privado: `inventory DELETE /copies/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Baja lógica; solo AVAILABLE o ya RETIRED, sin reserva activa.

**Errores específicos.** 404 NOT_FOUND; 409 COPY_IN_USE / COPY_RESERVED; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "BEC-0001-1",
  "state": "RETIRED"
}
```

### S13 — Inscribir lector y enviar activación

**POST `/api/readers`** · pantalla P05 · Bearer; Administrativo.
Destino privado: `clients POST /readers`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ReaderInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** ADMIN comprueba documentos; RUN/correo únicos; cuenta pendiente durable y activación vía outbox.

**Errores específicos.** 400 INVALID_RUT / DOCUMENTS_REQUIRED / PHOTO_FORMAT / BIOMETRIC_FORMAT; 409 RUT_EXISTS / EMAIL_EXISTS; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "names": "Lectora",
  "surnames": "Ficticia Ejemplo",
  "photo": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "rut": "12345678-5",
  "address": "Calle Ficticia 123",
  "email": "lectora@bec.example.invalid",
  "telephone": "+56900000000",
  "documentsChecked": true,
  "fingerprint": "bXVlc3RyYS1maWN0aWNpYS1uby1lc3VuYS1odWVsbGEtcmVhbA==",
  "password": "Ficticia_NoEsUnaClaveReal_2026"
}
```
Salida JSON ficticia — HTTP 201:
```json
{
  "id": "r-ejemplo",
  "state": "INACTIVE",
  "message": "Ficha registrada; debe validar el correo antes de ingresar."
}
```

### S14 — Buscar fichas

**GET `/api/readers`** · pantalla P05 · Bearer; Administrativo.
Destino privado: `clients GET /readers`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: q (query, opcional); page (query, opcional); size (query, opcional).

**Regla y autorización.** Solo ADMIN; busca nombre/apellidos/RUN (catálogo no expone estos datos).

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "r-ejemplo",
      "state": "ACTIVE",
      "names": "Lectora",
      "surnames": "Ficticia Ejemplo",
      "photo": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "rut": "12345678-5",
      "address": "Calle Ficticia 123",
      "email": "lectora@bec.example.invalid",
      "telephone": "+56900000000",
      "documentsChecked": true
    }
  ],
  "total": 1,
  "page": 0,
  "size": 10
}
```

### S15 — Consultar ficha según rol

**GET `/api/readers/{id}`** · pantalla P05 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `clients GET /readers/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** READER solo su id; LIBRARIAN recibe únicamente id/estado/nombres/apellidos/foto; ADMIN ficha completa.

**Errores específicos.** 403 FORBIDDEN (titular distinto); 404 NOT_FOUND; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "r-ejemplo",
  "state": "ACTIVE",
  "names": "Lectora",
  "surnames": "Ficticia Ejemplo",
  "photo": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "rut": "12345678-5",
  "address": "Calle Ficticia 123",
  "email": "lectora@bec.example.invalid",
  "telephone": "+56900000000",
  "documentsChecked": true
}
```

### S16 — Actualizar contacto y fotografía

**PUT `/api/readers/{id}`** · pantalla P05 · Bearer; Administrativo.
Destino privado: `clients PUT /readers/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ContactInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** Solo ADMIN. No cambia RUN, email, clave ni huella; esos campos adicionales se rechazan.

**Errores específicos.** 400 UNKNOWN_FIELD / VALIDATION / PHOTO_FORMAT; 404 NOT_FOUND; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "address": "Calle Ficticia 123",
  "telephone": "+56900000000",
  "photo": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "r-ejemplo",
  "state": "ACTIVE",
  "names": "Lectora",
  "surnames": "Ficticia Ejemplo",
  "photo": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "rut": "12345678-5",
  "address": "Calle Ficticia 123",
  "email": "lectora@bec.example.invalid",
  "telephone": "+56900000000",
  "documentsChecked": true
}
```

### S17 — Solicitar préstamo

**POST `/api/requests`** · pantalla P01 · Bearer; Lector.
Destino privado: `orders POST /requests`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `RequestInput` (tabla de campos anterior).
Parámetros: Idempotency-Key (header, obligatorio).

**Regla y autorización.** Idempotency-Key obligatorio; lector activo, sin sanción ni préstamos vencidos. Retiene TODOS los ejemplares 20 minutos o ninguno.

**Errores específicos.** 400 IDEMPOTENCY_REQUIRED; 403 READER_INACTIVE; 409 COPY_UNAVAILABLE / RESERVATION_CONFLICT / READER_SANCTIONED / READER_OVERDUE / IDEMPOTENCY_CONFLICT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "copyIds": [
    "BEC-0001-1"
  ],
  "mode": "HOME"
}
```
Salida JSON ficticia — HTTP 201:
```json
{
  "id": "q-ejemplo",
  "ownerId": "r-ejemplo",
  "state": "PENDING",
  "mode": "HOME",
  "copyIds": [
    "BEC-0001-1"
  ],
  "createdAt": "2026-11-20T15:00:00Z",
  "expiresAt": "2026-11-20T15:20:00Z",
  "items": [
    {
      "copyId": "BEC-0001-1",
      "documentId": "d-ejemplo",
      "title": "Relatos del barrio (ficticio)",
      "homeDays": 7,
      "roomHours": 2,
      "shelf": "A-01"
    }
  ]
}
```

### S18 — Solicitudes propias o cola

**GET `/api/requests`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario.
Destino privado: `orders GET /requests`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: page (query, opcional); size (query, opcional).

**Regla y autorización.** READER: solo propias. LIBRARIAN: cola ALLOCATING/PENDING/ISSUING.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "q-ejemplo",
      "ownerId": "r-ejemplo",
      "state": "PENDING",
      "mode": "HOME",
      "copyIds": [
        "BEC-0001-1"
      ],
      "createdAt": "2026-11-20T15:00:00Z",
      "expiresAt": "2026-11-20T15:20:00Z",
      "items": [
        {
          "copyId": "BEC-0001-1",
          "documentId": "d-ejemplo",
          "title": "Relatos del barrio (ficticio)",
          "homeDays": 7,
          "roomHours": 2,
          "shelf": "A-01"
        }
      ]
    }
  ],
  "total": 1
}
```

### S19 — Cancelar solicitud pendiente

**DELETE `/api/requests/{id}`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario.
Destino privado: `orders DELETE /requests/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Titular o bibliotecario. Solo PENDING/CANCELLING/CANCELLED; libera retención con reintentos.

**Errores específicos.** 403 FORBIDDEN; 404 NOT_FOUND; 409 INVALID_STATE; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "q-ejemplo",
  "state": "CANCELLED"
}
```

### S20 — Verificar RUN/huella y entregar

**POST `/api/requests/{id}/issue`** · pantalla P06 · Bearer; Bibliotecario.
Destino privado: `orders POST /requests/{id}/issue`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `IssueInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** PENDING vigente: RUN+huella TEST, activo y elegible. Plazo por ejemplar calculado al confirmar, nunca desde el navegador. ISSUING recuperable e ISSUED idempotente.

**Errores específicos.** 403 IDENTITY_MISMATCH / READER_INACTIVE; 404 NOT_FOUND; 409 INVALID_STATE / HOLD_EXPIRED / READER_SANCTIONED / RESERVATION_CONFLICT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "rut": "12345678-5",
  "fingerprint": "bXVlc3RyYS1maWN0aWNpYS1uby1lc3VuYS1odWVsbGEtcmVhbA=="
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "l-ejemplo",
  "requestId": "q-ejemplo",
  "ownerId": "r-ejemplo",
  "mode": "HOME",
  "state": "ACTIVE",
  "preparedAt": "2026-11-20T15:00:00Z",
  "issuedAt": "2026-11-20T15:00:00Z",
  "items": [
    {
      "copyId": "BEC-0001-1",
      "documentId": "d-ejemplo",
      "title": "Relatos del barrio (ficticio)",
      "homeDays": 7,
      "roomHours": 2,
      "shelf": "A-01",
      "dueAt": "2026-11-27T15:00:00Z",
      "state": "ACTIVE"
    }
  ],
  "dueAt": "2026-11-27T15:00:00Z"
}
```

### S21 — Listar préstamos por alcance

**GET `/api/loans`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `orders GET /loans`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: readerId (query, opcional); page (query, opcional); size (query, opcional).

**Regla y autorización.** READER propio siempre; LIBRARIAN/ADMIN pueden filtrar lector o consultar lista. No se elimina historial.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "l-ejemplo",
      "requestId": "q-ejemplo",
      "ownerId": "r-ejemplo",
      "mode": "HOME",
      "state": "ACTIVE",
      "preparedAt": "2026-11-20T15:00:00Z",
      "issuedAt": "2026-11-20T15:00:00Z",
      "items": [
        {
          "copyId": "BEC-0001-1",
          "documentId": "d-ejemplo",
          "title": "Relatos del barrio (ficticio)",
          "homeDays": 7,
          "roomHours": 2,
          "shelf": "A-01",
          "dueAt": "2026-11-27T15:00:00Z",
          "state": "ACTIVE"
        }
      ],
      "dueAt": "2026-11-27T15:00:00Z"
    }
  ],
  "total": 1,
  "sanctionUntil": null
}
```

### S22 — Detalle de préstamo

**GET `/api/loans/{id}`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `orders GET /loans/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Titular READER o personal autorizado; backend comprueba ownerId.

**Errores específicos.** 403 FORBIDDEN; 404 NOT_FOUND; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "l-ejemplo",
  "requestId": "q-ejemplo",
  "ownerId": "r-ejemplo",
  "mode": "HOME",
  "state": "ACTIVE",
  "preparedAt": "2026-11-20T15:00:00Z",
  "issuedAt": "2026-11-20T15:00:00Z",
  "items": [
    {
      "copyId": "BEC-0001-1",
      "documentId": "d-ejemplo",
      "title": "Relatos del barrio (ficticio)",
      "homeDays": 7,
      "roomHours": 2,
      "shelf": "A-01",
      "dueAt": "2026-11-27T15:00:00Z",
      "state": "ACTIVE"
    }
  ],
  "dueAt": "2026-11-27T15:00:00Z"
}
```

### S23 — Comprobante de domicilio

**GET `/api/loans/{id}/receipt`** · pantalla P09 · Bearer; Lector, Bibliotecario.
Destino privado: `orders GET /loans/{id}/receipt`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Solo HOME entregado (no PREPARING); titular o bibliotecario. Ítems con fecha/hora propia; impresión en P09.

**Errores específicos.** 403 FORBIDDEN; 404 NOT_FOUND; 409 NO_HOME_RECEIPT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "receipt-l-ejemplo",
  "loanId": "l-ejemplo",
  "readerId": "r-ejemplo",
  "issuedAt": "2026-11-20T15:00:00Z",
  "items": [
    {
      "copyId": "BEC-0001-1",
      "documentId": "d-ejemplo",
      "title": "Relatos del barrio (ficticio)",
      "homeDays": 7,
      "roomHours": 2,
      "shelf": "A-01",
      "dueAt": "2026-11-27T15:00:00Z",
      "state": "ACTIVE"
    }
  ],
  "amount": 0,
  "currency": "CLP"
}
```

### S24 — Devolver por código

**POST `/api/returns`** · pantalla P07 · Bearer; Bibliotecario.
Destino privado: `orders POST /returns`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ReturnInput` (tabla de campos anterior).
Parámetros: Idempotency-Key (header, obligatorio).

**Regla y autorización.** Idempotency-Key obligatorio. Hora servidor; préstamo devuelto inmediatamente, copia RESHELVING hasta returnedAt+30 minutos. Sanción temporal si hay atraso.

**Errores específicos.** 400 IDEMPOTENCY_REQUIRED; 409 NO_ACTIVE_LOAN / IDEMPOTENCY_CONFLICT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "copyId": "BEC-0001-1"
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "ret-ejemplo",
  "loanId": "l-ejemplo",
  "copyId": "BEC-0001-1",
  "returnedAt": "2026-11-20T15:00:00Z",
  "state": "RETURNED",
  "late": false,
  "sanctionUntil": null,
  "readyAt": "2026-11-20T15:30:00Z"
}
```

### S25 — Reservar ejemplar/fecha

**POST `/api/reservations`** · pantalla P01 · Bearer; Lector.
Destino privado: `orders POST /reservations`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `ReservationInput` (tabla de campos anterior).
Parámetros: Idempotency-Key (header, obligatorio).

**Regla y autorización.** Idempotency-Key; lector elegible; slot copia/fecha único. No atraviesa préstamo vigente ni acepta fecha >90 días.

**Errores específicos.** 400 INVALID_DATE / IDEMPOTENCY_REQUIRED; 409 RESERVATION_CONFLICT / COPY_UNAVAILABLE / READER_SANCTIONED / IDEMPOTENCY_CONFLICT; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "copyId": "BEC-0001-1",
  "date": "2026-12-10",
  "mode": "ROOM"
}
```
Salida JSON ficticia — HTTP 201:
```json
{
  "id": "v-ejemplo",
  "ownerId": "r-ejemplo",
  "state": "ACTIVE",
  "copyId": "BEC-0001-1",
  "date": "2026-12-10",
  "mode": "ROOM",
  "createdAt": "2026-11-20T15:00:00Z"
}
```

### S26 — Consultar reservas

**GET `/api/reservations`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario.
Destino privado: `orders GET /reservations`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: readerId (query, opcional); page (query, opcional); size (query, opcional).

**Regla y autorización.** Titular READER; bibliotecario puede filtrar lector.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "v-ejemplo",
      "ownerId": "r-ejemplo",
      "state": "ACTIVE",
      "copyId": "BEC-0001-1",
      "date": "2026-12-10",
      "mode": "ROOM",
      "createdAt": "2026-11-20T15:00:00Z"
    }
  ],
  "total": 1
}
```

### S27 — Cancelar reserva futura

**DELETE `/api/reservations/{id}`** · pantalla P03,P06 · Bearer; Lector, Bibliotecario.
Destino privado: `orders DELETE /reservations/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** Titular o bibliotecario; ACTIVE/CANCELLING/CANCELLED. No borra historia.

**Errores específicos.** 403 FORBIDDEN; 404 NOT_FOUND; 409 INVALID_STATE; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "v-ejemplo",
  "state": "CANCELLED"
}
```

### S28 — Morosidad sala/domicilio

**GET `/api/overdue`** · pantalla P08 · Bearer; Administrativo.
Destino privado: `orders GET /overdue`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: mode (query, opcional); page (query, opcional); size (query, opcional).

**Regla y autorización.** ADMIN; lista operacional de ítems ACTIVE vencidos (HOME por defecto o ROOM). Recordatorio automático solo HOME.

**Errores específicos.** 400 VALIDATION; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "loanId": "l-ejemplo",
      "readerId": "r-ejemplo",
      "copyId": "BEC-0001-1",
      "title": "Relatos del barrio (ficticio)",
      "dueAt": "2026-11-19T15:00:00Z",
      "mode": "HOME"
    }
  ],
  "total": 1
}
```

### S29 — Consultar gratuidad

**GET `/api/payments/policy`** · pantalla P03 · Anónimo permitido.
Destino privado: `payments GET /policy`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: ninguno.

**Regla y autorización.** No hay precio ni multa; no necesita sesión.

**Errores específicos.** 400 validación; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "MUNICIPAL_FREE",
  "currency": "CLP",
  "amount": 0,
  "chargesEnabled": false,
  "sanction": "TIME_ONLY"
}
```

### S30 — Consultar evaluación de gratuidad

**GET `/api/payments/assessments/{id}`** · pantalla P03 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `payments GET /assessments/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** id de ruta = loanId; lector titular, bibliotecario o administrativo.

**Errores específicos.** 403 FORBIDDEN; 404 NOT_FOUND; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "id": "l-ejemplo",
  "loanId": "l-ejemplo",
  "ownerId": "r-ejemplo",
  "amount": 0,
  "currency": "CLP",
  "state": "EXEMPT",
  "policyId": "MUNICIPAL_FREE",
  "createdAt": "2026-11-20T15:00:00Z"
}
```

### S31 — Rechazar cobro ajeno al caso

**POST `/api/payments/intents`** · pantalla P03 · Bearer; Lector.
Destino privado: `payments POST /intents`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `TamperedIntent` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** Ruta explícita para rechazar una intención ajena al caso. NO crea transacción ni toca sanciones.

**Errores específicos.** 422 NO_MONETARY_PAYMENTS; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "loanId": "l-ejemplo",
  "amount": 0,
  "status": "PAID"
}
```
Salida JSON ficticia — HTTP 422:
```json
{
  "error": {
    "code": "NO_MONETARY_PAYMENTS",
    "message": "El caso no contempla cobros. Un pago nunca levanta una sanción temporal.",
    "correlationId": "00000000-0000-4000-8000-000000000001"
  }
}
```

### S32 — Resumen agregado de cuenta

**POST `/api/graphql`** · pantalla P03 · Bearer; Lector, Bibliotecario, Administrativo.
Destino privado: `graphql POST /graphql`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `GraphQLInput` (tabla de campos anterior).
Parámetros: ninguno.

**Regla y autorización.** Cuenta: Clients+Orders+Inventory+Payments. first≤20, page≤1000, profundidad≤6, costo≤100; batch por petición. HTTP200 puede incluir errors parciales; no significa éxito total.

**Errores específicos.** 400 VALIDATION / VARIABLES_LIMIT; 200 errors[].extensions.code: FIELD_FORBIDDEN / FORBIDDEN / DEPENDENCY_UNAVAILABLE / ValidationError; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{
  "query": "query Cuenta($first:Int!){account(first:$first){reader{id names state}loans{id mode items{copyId title dueAt document{author available}}assessment{amount currency state}}totalLoans reservations{id date state}}}",
  "variables": {
    "first": 10
  }
}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "data": {
    "account": {
      "reader": {
        "id": "r-ejemplo",
        "names": "Lectora",
        "state": "ACTIVE"
      },
      "loans": [
        {
          "id": "l-ejemplo",
          "mode": "HOME",
          "items": [
            {
              "copyId": "BEC-0001-1",
              "title": "Relatos del barrio (ficticio)",
              "dueAt": "2026-11-27T15:00:00Z",
              "document": {
                "author": "Autora Ficticia",
                "available": 0
              }
            }
          ],
          "assessment": {
            "amount": 0,
            "currency": "CLP",
            "state": "EXEMPT"
          }
        }
      ],
      "totalLoans": 1,
      "reservations": []
    }
  }
}
```

### S33 — Simular control de salida

**GET `/api/exit-check/{id}`** · pantalla P07 · Bearer; Bibliotecario.
Destino privado: `inventory GET /exit-check/{id}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: id (path, obligatorio).

**Regla y autorización.** LIBRARIAN; solo copia HOME con loanId confirmado permite salida. Es prueba software, NO barrera física.

**Errores específicos.** 404 NOT_FOUND; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "copyId": "BEC-0001-1",
  "allowExit": true,
  "adapter": "SOFTWARE_TEST_NO_PHYSICAL_RFID"
}
```

### S34 — Bandeja del proveedor de prueba

**GET `/api/lab/mailbox`** · pantalla P10 · Bearer; Administrativo.
Destino privado: `mail GET /mailbox`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** Sin cuerpo.
Parámetros: page (query, opcional); size (query, opcional).

**Regla y autorización.** ADMIN y labMode=true; texto de proveedor TEST. No demuestra entrega a Internet.

**Errores específicos.** 404 NOT_FOUND (laboratorio deshabilitado); además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "items": [
    {
      "id": "activation-r-ejemplo-v1",
      "to": "lectora@bec.example.invalid",
      "subject": "Active su cuenta BEC",
      "text": "ENLACE FICTICIO: https://localhost:8443/?activation=TOKEN_FICTICIO_NO_VALIDO",
      "createdAt": "2026-11-20T15:00:00Z"
    }
  ],
  "total": 1,
  "adapter": "TEST_NO_INTERNET_DELIVERY"
}
```

### S35 — Reenviar activación e invalidar enlace anterior

**POST `/api/readers/{id}/activation`** · pantalla P05 · Bearer; Administrativo.
Destino privado: `clients POST /readers/{id}/activation`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).

**Entrada.** `EmptyInput` (tabla de campos anterior).
Parámetros: id (path, obligatorio).

**Regla y autorización.** ADMIN; solo lector INACTIVE y cuenta provisionada; invalida enlace previo, nueva vigencia 24 h.

**Errores específicos.** 404 NOT_FOUND; 409 ALREADY_ACTIVE / ACCOUNT_PENDING; además los errores comunes aplicables.

Entrada JSON ficticia:
```json
{}
```
Salida JSON ficticia — HTTP 200:
```json
{
  "queued": true,
  "expiresInHours": 24,
  "previousLinkRevoked": true
}
```

## Semántica de salidas y campos condicionales

Los esquemas `SxxResponse` en `openapi.json` indican los tipos de cada proyección, no solo un nombre genérico. `docs/contratos.json` conserva los ejemplos y la clasificación de entradas. En páginas, `items` es una lista, `total` entero; `page`/`size` se devuelven donde aparecen en el contrato.
Los IDs, estados y fechas de préstamos/reservas son contextuales y privados. `ownerId` nunca se acepta desde el navegador en las creaciones propias. En catálogo, `dueAt`/`readyAt` son públicos contextuales sin vincular personas. Cualquier `*Hash`, `*Cipher`, secreto técnico o plantilla está excluido de los DTO.
En resultados de saga se puede observar ALLOCATING/ISSUING/PREPARING/RESERVING/RETURNING; un 502 no autoriza a duplicar la operación con otra clave. Reconsultar/reintentar la misma clave hasta resolver. Un error GraphQL tiene `errors[].message`, `path` y `extensions.code`; los campos nullable pueden quedar null con datos parciales de otros subsistemas.
Las respuestas de registro no devuelven clave ni enlace de activación. La excepción deliberada de exposición de enlace es S34, bandeja de laboratorio: solo ADMIN y deshabilitable con --no-lab. Nunca habilitarla en un piloto real.