#!/usr/bin/env python3
"""Genera contratos y matrices desde la allowlist real; ejemplos exclusivamente ficticios."""
import csv
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
def field(kind, rule, classification="Público", required=True, **extra):
    return {"type": kind, "description": rule, "x-classification": classification, "x-required": required, **extra}
def obj(properties, description=""):
    result = {"type": "object", "description": description, "additionalProperties": False,
              "properties": properties}
    required = [k for k, v in properties.items() if v.get("x-required", True)]
    if required:
        result["required"] = required
    return result
def ref(name):
    return {"$ref": "#/components/schemas/" + name}
def array(item, **kw):
    return {"type": "array", "items": item, **kw}
def text(rule="", cls="Público", **kw):
    return field("string", rule, cls, **kw)
def integer(rule="", **kw):
    return field("integer", rule, **kw)

TIME = "2026-11-20T15:00:00Z"
TOKEN = "A" * 43
PHOTO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="
FINGERPRINT = "bXVlc3RyYS1maWN0aWNpYS1uby1lc3VuYS1odWVsbGEtcmVhbA=="
DOCUMENT = {"id": "d-ejemplo", "title": "Relatos del barrio (ficticio)", "author": "Autora Ficticia",
            "type": "BOOK", "medium": "PAPER", "publisher": "Editorial Ejemplo", "edition": "1", "year": 2026,
            "shelf": "A-01", "category": "Literatura", "homeDays": 7, "roomHours": 2, "description": "Descripción ficticia de la colección.", "state": "ACTIVE"}
COPY = {"id": "BEC-0001-1", "documentId": "d-ejemplo", "shelf": "A-01", "state": "AVAILABLE"}
CATALOG = DOCUMENT | {"available": 1, "inRoom": 0, "total": 1,
                      "copies": [{"id": COPY["id"], "state": "AVAILABLE", "shelf": "A-01", "dueAt": None, "readyAt": None}]}
READER = {"id": "r-ejemplo", "state": "ACTIVE", "names": "Lectora", "surnames": "Ficticia Ejemplo", "photo": PHOTO,
          "rut": "12345678-5", "address": "Calle Ficticia 123", "email": "lectora@bec.example.invalid",
          "telephone": "+56900000000", "documentsChecked": True}
ITEM = {"copyId": COPY["id"], "documentId": DOCUMENT["id"], "title": DOCUMENT["title"],
        "homeDays": 7, "roomHours": 2, "shelf": "A-01", "dueAt": "2026-11-27T15:00:00Z", "state": "ACTIVE"}
REQUEST = {"id": "q-ejemplo", "ownerId": READER["id"], "state": "PENDING", "mode": "HOME",
           "copyIds": [COPY["id"]], "createdAt": TIME, "expiresAt": "2026-11-20T15:20:00Z",
           "items": [{k: v for k, v in ITEM.items() if k not in ("dueAt", "state")}]}
LOAN = {"id": "l-ejemplo", "requestId": REQUEST["id"], "ownerId": READER["id"], "mode": "HOME",
        "state": "ACTIVE", "preparedAt": TIME, "issuedAt": TIME, "items": [ITEM], "dueAt": ITEM["dueAt"]}
RESERVATION = {"id": "v-ejemplo", "ownerId": READER["id"], "state": "ACTIVE", "copyId": COPY["id"],
               "date": "2026-12-10", "mode": "ROOM", "createdAt": TIME}
ASSESSMENT = {"id": LOAN["id"], "loanId": LOAN["id"], "ownerId": READER["id"], "amount": 0, "currency": "CLP",
              "state": "EXEMPT", "policyId": "MUNICIPAL_FREE", "createdAt": TIME}
QUERY = "query Cuenta($first:Int!){account(first:$first){reader{id names state}loans{id mode items{copyId title dueAt document{author available}}assessment{amount currency state}}totalLoans reservations{id date state}}}"
SCHEMAS = {
    "LoginInput": obj({"email": text("Correo normalizado a minúsculas; 5–160; formato de correo.", "Personal", minLength=5, maxLength=160, format="email"),
                       "password": text("1–128 al ingresar; se transmite solo por TLS.", "Credencial", minLength=1, maxLength=128)}),
    "ActivationInput": obj({"token": text("Token de un uso: longitud 43; vence a las 24 horas; el reenvío revoca el anterior.", "Credencial", minLength=43, maxLength=43)}),
    "EmptyInput": obj({}),
    "DocumentInput": obj({
        "title": text("2–200 caracteres.", minLength=2, maxLength=200),
        "author": text("2–140.", minLength=2, maxLength=140),
        "type": text("Tipo documental.", enum=["BOOK", "TECHNICAL", "AUDIO", "VIDEO"]),
        "medium": text("BOOK/TECHNICAL solo PAPER; AUDIO/VIDEO nunca PAPER. DIGITAL es soporte, no streaming.", enum=["PAPER", "CASSETTE", "CD", "DVD", "BLURAY", "DIGITAL"]),
        "publisher": text("2–120.", minLength=2, maxLength=120),
        "edition": text("1–40.", minLength=1, maxLength=40), "year": integer("1450 hasta el año del servidor.", minimum=1450),
        "shelf": text("1–40; ubicación general.", minLength=1, maxLength=40),
        "category": text("2–80.", minLength=2, maxLength=80),
        "homeDays": integer("Plazo de domicilio, 1–30 días.", minimum=1, maximum=30),
        "roomHours": integer("Plazo sala, 1–8 h; siempre termina el mismo día.", minimum=1, maximum=8),
        "description": text("Opcional, máximo 2000; permite saltos de línea. PUT sin este campo conserva el valor anterior.", required=False, maxLength=2000),
        "stock": integer("Opcional: 0–200 ejemplares activos; ajuste atómico con el documento. Reducir no retira prestados/retenidos/reservados/en reposición. Omitirlo conserva stock existente.", required=False, minimum=0, maximum=200)}),
    "CopyInput": obj({"code": text("Único; 3–40; A–Z, 0–9 y guión.", pattern="^[A-Z0-9-]{3,40}$"),
                      "shelf": text("1–40.", minLength=1, maxLength=40)}),
    "ShelfInput": obj({"shelf": text("1–40 caracteres.", minLength=1, maxLength=40)}),
    "ReaderInput": obj({
        "rut": text("RUN con módulo 11 válido; único, con o sin puntos; 7–8 dígitos y DV.", "Personal restringido", minLength=9, maxLength=12),
        "names": text("2–80.", "Personal", minLength=2, maxLength=80),
        "surnames": text("2–100.", "Personal", minLength=2, maxLength=100),
        "address": text("5–200.", "Personal restringido", minLength=5, maxLength=200),
        "email": text("Único, formato correo 5–160.", "Personal restringido", format="email", maxLength=160),
        "telephone": text("8–20 caracteres; no se presupone verificación telefónica.", "Personal restringido", minLength=8, maxLength=20),
        "photo": text("PNG/JPEG base64; máximo 128000 bytes decodificados, imagen ≤1024×1024; texto 40–180000.", "Personal restringido", minLength=40, maxLength=180000),
        "fingerprint": text("Muestra BASE64 determinista TEST; 32–2048 caracteres, ≥24 bytes; no SDK de reconocimiento físico.", "Personal biométrico restringido", minLength=32, maxLength=2048),
        "password": text("12–128 al inscribir; nunca se devuelve ni se registra en logs.", "Credencial", minLength=12, maxLength=128),
        "documentsChecked": field("boolean", "Debe ser true; comprobación a cargo del administrativo.", "Personal restringido", enum=[True])}),
    "ContactInput": obj({"address": text("5–200.", "Personal restringido", minLength=5, maxLength=200),
                         "telephone": text("8–20.", "Personal restringido", minLength=8, maxLength=20),
                         "photo": text("Mismas reglas PNG/JPEG de inscripción.", "Personal restringido", minLength=40, maxLength=180000)}),
    "RequestInput": obj({"copyIds": array(text("Identificador existente, 1–80; sin repetidos.", pattern="^[A-Za-z0-9_-]{1,80}$"), minItems=1, maxItems=5, uniqueItems=True),
                         "mode": text("Modalidad seleccionada.", enum=["HOME", "ROOM"])}),
    "IssueInput": obj({"rut": text("RUN válido del lector de la solicitud, módulo 11.", "Personal restringido"),
                       "fingerprint": text("Muestra TEST 32–2048 que debe coincidir; nunca se acepta verified:true del frontend.", "Personal biométrico restringido", minLength=32, maxLength=2048)}),
    "ReturnInput": obj({"copyId": text("Código de ejemplar con ítem ACTIVE; 3–40.", "Contextual", minLength=3, maxLength=40)}),
    "ReservationInput": obj({"copyId": text("Código 3–40.", "Contextual", minLength=3, maxLength=40),
                             "date": text("ISO AAAA-MM-DD; hoy (Santiago) a hoy+90 días.", "Contextual", format="date"),
                             "mode": text("Modalidad.", enum=["HOME", "ROOM"])}),
    "GraphQLInput": obj({"query": text("SDL de consulta, 5–8192; profundidad≤6, costo≤100; sin introspección.", "Contextual", minLength=5, maxLength=8192),
                         "variables": field("object", "Opcional; JSON serializado ≤4096 caracteres; first 1–20, page 0–1000.", "Contextual", required=False),
                         "operationName": text("Opcional 1–80.", "Contextual", required=False, minLength=1, maxLength=80)}),
    "TamperedIntent": {"type": "object", "description": "Cualquier intención monetaria se rechaza 422. No hay campos capaces de crear un pago ni levantar sanciones.", "additionalProperties": True},
}

def response_schema(value, key=""):
    """Esquema exacto de la proyección del ejemplo; propiedades de estado variables se documentan aparte."""
    if value is None:
        return {"type": "string", "nullable": True, "description": "Opcional; fecha/hora ISO-8601 cuando corresponde."}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, str):
        return {"type": "string", "x-classification": "Credencial" if key=="token" else "Personal restringido" if key in ("rut","address","email","telephone","photo","to","text") else "Contextual" if key in ("ownerId","readerId","loanId","returnedAt","sanctionUntil") else "Según contexto del DTO"}
    if isinstance(value, list):
        fallback = COPY if key=="copies" else RESERVATION if key=="reservations" else {}
        return array(response_schema(value[0] if value else fallback))
    return {"type": "object", "properties": {k: response_schema(v,k) for k, v in value.items()}}

def page(item, **extra):
    return {"items": [item], "total": 1} | extra
ENROLL = {k: v for k, v in READER.items() if k not in ("id", "state")} | {"fingerprint": FINGERPRINT, "password": "Ficticia_NoEsUnaClaveReal_2026"}
RECEIPT = {"id": "receipt-l-ejemplo", "loanId": LOAN["id"], "readerId": READER["id"], "issuedAt": TIME,
           "items": [ITEM], "amount": 0, "currency": "CLP"}
ERROR = {"error": {"code": "VALIDATION", "message": "Datos inválidos.", "correlationId": "00000000-0000-4000-8000-000000000001"}}
def entry(body=None, request=None, response=None, success=200, rule="", errors="400 validación", query=None):
    return {"bodySchema": body, "requestExample": request, "responseExample": response, "success": success,
            "businessRule": rule, "specificErrors": errors, "query": query or []}
META = {
 "S01": entry("LoginInput", {"email": "lectora@bec.example.invalid", "password": "Ficticia_NoEsUnaClaveReal_2026"},
              {"token": TOKEN, "expiresAt": "2026-11-20T15:20:00Z", "id": READER["id"], "role": "READER"},
              rule="Solo cuentas ACTIVE. Respuesta genérica no distingue correo inexistente/inactivo.", errors="400 VALIDATION; 401 INVALID_CREDENTIALS; 429 RATE_LIMIT"),
 "S02": entry("EmptyInput", {}, {"revoked": True}, rule="El gateway usa el Bearer actual: ignora cualquier token del cuerpo. Revocación inmediata en Auth."),
 "S03": entry("ActivationInput", {"token": TOKEN}, {"activated": True},
              rule="Un solo uso, 24 horas; actualiza perfil y cuenta mediante contrato privado.", errors="400 INVALID_ACTIVATION; 409 TOKEN_USED; 410 ACTIVATION_EXPIRED"),
 "S04": entry(response={"id": READER["id"], "role": "READER"}),
 "S05": entry(response=page(CATALOG, page=0, size=10), query=["q", "page", "size", "title", "author", "type", "publisher", "availability", "subcategory"], rule="Anónimo: filtros combinables por título/autor/tipo/editorial/disponibilidad/subcategoría; se aplican antes de paginar. MULTIMEDIA agrupa AUDIO y VIDEO. AVAILABLE significa available>0; UNAVAILABLE available=0; IN_ROOM inRoom>0. Texto de filtros sin distinguir mayúsculas/tildes. q conserva búsqueda general previa. Cuenta AVAILABLE y ROOM sin revelar prestatarios."),
 "S06": entry(response=CATALOG, errors="404 NOT_FOUND (incluido archivado)"),
 "S07": entry("DocumentInput", {k:v for k,v in DOCUMENT.items() if k not in ("id","state")}, DOCUMENT | {"available":0,"inRoom":0,"total":0,"copies":[]}, 201,
               rule="Alta de documento. stock opcional crea de 0 a 200 ejemplares reales en la misma transacción; si se omite, se añaden después por S10."),
 "S08": entry("DocumentInput", {k:v for k,v in DOCUMENT.items() if k not in ("id","state")}, CATALOG,
               rule="PUT conserva id; solo documento ACTIVE. description/stock opcionales conservan su valor si se omiten; si stock cambia, documento+ejemplares se guardan en una sola transacción.", errors="400 VALIDATION; 404 NOT_FOUND; 409 ARCHIVED / STOCK_IN_USE"),
 "S09": entry(response={"id": DOCUMENT["id"],"state":"ARCHIVED"}, rule="Baja lógica; retira ejemplares. No se elimina historia.",
              errors="404 NOT_FOUND; 409 DOCUMENT_IN_USE / DOCUMENT_RESERVED"),
 "S10": entry("CopyInput", {"code": COPY["id"], "shelf":"A-01"}, COPY, 201, errors="400 VALIDATION; 404 NOT_FOUND; 409 COPY_EXISTS / ARCHIVED"),
 "S11": entry("ShelfInput", {"shelf":"A-02"}, COPY | {"shelf":"A-02"}, errors="404 NOT_FOUND; 409 RETIRED"),
 "S12": entry(response={"id":COPY["id"],"state":"RETIRED"},rule="Baja lógica; solo AVAILABLE o ya RETIRED, sin reserva activa.",
              errors="404 NOT_FOUND; 409 COPY_IN_USE / COPY_RESERVED"),
 "S13": entry("ReaderInput", ENROLL, {"id":READER["id"],"state":"INACTIVE","message":"Ficha registrada; debe validar el correo antes de ingresar."},201,
              rule="ADMIN comprueba documentos; RUN/correo únicos; cuenta pendiente durable y activación vía outbox.",
              errors="400 INVALID_RUT / DOCUMENTS_REQUIRED / PHOTO_FORMAT / BIOMETRIC_FORMAT; 409 RUT_EXISTS / EMAIL_EXISTS"),
 "S14": entry(response=page(READER,page=0,size=10),query=["q","page","size"],rule="Solo ADMIN; busca nombre/apellidos/RUN (catálogo no expone estos datos)."),
 "S15": entry(response=READER,rule="READER solo su id; LIBRARIAN recibe únicamente id/estado/nombres/apellidos/foto; ADMIN ficha completa.",
              errors="403 FORBIDDEN (titular distinto); 404 NOT_FOUND"),
 "S16": entry("ContactInput", {k:READER[k] for k in ("address","telephone","photo")},READER,
              rule="Solo ADMIN. No cambia RUN, email, clave ni huella; esos campos adicionales se rechazan.", errors="400 UNKNOWN_FIELD / VALIDATION / PHOTO_FORMAT; 404 NOT_FOUND"),
 "S17": entry("RequestInput",{"copyIds":[COPY["id"]],"mode":"HOME"},REQUEST,201,
              rule="Idempotency-Key obligatorio; lector activo, sin sanción ni préstamos vencidos. Retiene TODOS los ejemplares 20 minutos o ninguno.",
              errors="400 IDEMPOTENCY_REQUIRED; 403 READER_INACTIVE; 409 COPY_UNAVAILABLE / RESERVATION_CONFLICT / READER_SANCTIONED / READER_OVERDUE / IDEMPOTENCY_CONFLICT"),
 "S18": entry(response=page(REQUEST),query=["page","size"],rule="READER: solo propias. LIBRARIAN: cola ALLOCATING/PENDING/ISSUING."),
 "S19": entry(response={"id":REQUEST["id"],"state":"CANCELLED"},rule="Titular o bibliotecario. Solo PENDING/CANCELLING/CANCELLED; libera retención con reintentos.",
              errors="403 FORBIDDEN; 404 NOT_FOUND; 409 INVALID_STATE"),
 "S20": entry("IssueInput",{"rut":READER["rut"],"fingerprint":FINGERPRINT},LOAN,
              rule="PENDING vigente: RUN+huella TEST, activo y elegible. Plazo por ejemplar calculado al confirmar, nunca desde el navegador. ISSUING recuperable e ISSUED idempotente.",
              errors="403 IDENTITY_MISMATCH / READER_INACTIVE; 404 NOT_FOUND; 409 INVALID_STATE / HOLD_EXPIRED / READER_SANCTIONED / RESERVATION_CONFLICT"),
 "S21": entry(response=page(LOAN,sanctionUntil=None),query=["readerId","page","size"],
              rule="READER propio siempre; LIBRARIAN/ADMIN pueden filtrar lector o consultar lista. No se elimina historial."),
 "S22": entry(response=LOAN,rule="Titular READER o personal autorizado; backend comprueba ownerId.",errors="403 FORBIDDEN; 404 NOT_FOUND"),
 "S23": entry(response=RECEIPT,rule="Solo HOME entregado (no PREPARING); titular o bibliotecario. Ítems con fecha/hora propia; impresión en P09.",
              errors="403 FORBIDDEN; 404 NOT_FOUND; 409 NO_HOME_RECEIPT"),
 "S24": entry("ReturnInput",{"copyId":COPY["id"]},
              {"id":"ret-ejemplo","loanId":LOAN["id"],"copyId":COPY["id"],"returnedAt":TIME,"state":"RETURNED","late":False,"sanctionUntil":None,"readyAt":"2026-11-20T15:30:00Z"},
              rule="Idempotency-Key obligatorio. Hora servidor; préstamo devuelto inmediatamente, copia RESHELVING hasta returnedAt+30 minutos. Sanción temporal si hay atraso.",
              errors="400 IDEMPOTENCY_REQUIRED; 409 NO_ACTIVE_LOAN / IDEMPOTENCY_CONFLICT"),
 "S25": entry("ReservationInput",{"copyId":COPY["id"],"date":"2026-12-10","mode":"ROOM"},RESERVATION,201,
              rule="Idempotency-Key; lector elegible; slot copia/fecha único. No atraviesa préstamo vigente ni acepta fecha >90 días.",
              errors="400 INVALID_DATE / IDEMPOTENCY_REQUIRED; 409 RESERVATION_CONFLICT / COPY_UNAVAILABLE / READER_SANCTIONED / IDEMPOTENCY_CONFLICT"),
 "S26": entry(response=page(RESERVATION),query=["readerId","page","size"],rule="Titular READER; bibliotecario puede filtrar lector."),
 "S27": entry(response={"id":RESERVATION["id"],"state":"CANCELLED"},rule="Titular o bibliotecario; ACTIVE/CANCELLING/CANCELLED. No borra historia.",errors="403 FORBIDDEN; 404 NOT_FOUND; 409 INVALID_STATE"),
 "S28": entry(response=page({"loanId":LOAN["id"],"readerId":READER["id"],"copyId":COPY["id"],"title":DOCUMENT["title"],"dueAt":"2026-11-19T15:00:00Z","mode":"HOME"}),
              query=["mode","page","size"],rule="ADMIN; lista operacional de ítems ACTIVE vencidos (HOME por defecto o ROOM). Recordatorio automático solo HOME.",errors="400 VALIDATION"),
 "S29": entry(response={"id":"MUNICIPAL_FREE","currency":"CLP","amount":0,"chargesEnabled":False,"sanction":"TIME_ONLY"},rule="No hay precio ni multa; no necesita sesión."),
 "S30": entry(response=ASSESSMENT,rule="id de ruta = loanId; lector titular, bibliotecario o administrativo.",errors="403 FORBIDDEN; 404 NOT_FOUND"),
 "S31": entry("TamperedIntent",{"loanId":LOAN["id"],"amount":0,"status":"PAID"},
              {"error":{"code":"NO_MONETARY_PAYMENTS","message":"El caso no contempla cobros. Un pago nunca levanta una sanción temporal.","correlationId":"00000000-0000-4000-8000-000000000001"}},422,
              rule="Ruta explícita para rechazar una intención ajena al caso. NO crea transacción ni toca sanciones.",errors="422 NO_MONETARY_PAYMENTS"),
 "S32": entry("GraphQLInput",{"query":QUERY,"variables":{"first":10}},
              {"data":{"account":{"reader":{k:READER[k] for k in ("id","names","state")},"loans":[{"id":LOAN["id"],"mode":"HOME","items":[{"copyId":COPY["id"],"title":DOCUMENT["title"],"dueAt":ITEM["dueAt"],"document":{"author":DOCUMENT["author"],"available":0}}],"assessment":{"amount":0,"currency":"CLP","state":"EXEMPT"}}],"totalLoans":1,"reservations":[]}}},
              rule="Cuenta: Clients+Orders+Inventory+Payments. first≤20, page≤1000, profundidad≤6, costo≤100; batch por petición. HTTP200 puede incluir errors parciales; no significa éxito total.",
              errors="400 VALIDATION / VARIABLES_LIMIT; 200 errors[].extensions.code: FIELD_FORBIDDEN / FORBIDDEN / DEPENDENCY_UNAVAILABLE / ValidationError"),
 "S33": entry(response={"copyId":COPY["id"],"allowExit":True,"adapter":"SOFTWARE_TEST_NO_PHYSICAL_RFID"},
              rule="LIBRARIAN; solo copia HOME con loanId confirmado permite salida. Es prueba software, NO barrera física.",errors="404 NOT_FOUND"),
 "S34": entry(response=page({"id":"activation-r-ejemplo-v1","to":READER["email"],"subject":"Active su cuenta BEC",
                            "text":"ENLACE FICTICIO: https://localhost:8443/?activation=TOKEN_FICTICIO_NO_VALIDO","createdAt":TIME},adapter="TEST_NO_INTERNET_DELIVERY"),
              query=["page","size"],rule="ADMIN y labMode=true; texto de proveedor TEST. No demuestra entrega a Internet.",errors="404 NOT_FOUND (laboratorio deshabilitado)"),
 "S35": entry("EmptyInput",{},{"queued":True,"expiresInHours":24,"previousLinkRevoked":True},
              rule="ADMIN; solo lector INACTIVE y cuenta provisionada; invalida enlace previo, nueva vigencia 24 h.",errors="404 NOT_FOUND; 409 ALREADY_ACTIVE / ACCOUNT_PENDING"),
}
QUERIES = {
 "q": {"name":"q","in":"query","required":False,"description":"Texto ≤100, sin distinción de mayúsculas. Catálogo: título/autor/categoría; fichas: nombre/apellidos/RUN.",
       "schema":{"type":"string","maxLength":100,"default":""}},
 "page": {"name":"page","in":"query","required":False,"description":"Página base cero.","schema":{"type":"integer","minimum":0,"maximum":1000,"default":0}},
 "size": {"name":"size","in":"query","required":False,"description":"Tamaño máximo 20.","schema":{"type":"integer","minimum":1,"maximum":20,"default":10}},
 "readerId": {"name":"readerId","in":"query","required":False,"description":"Lector a consultar. Si READER, debe coincidir con el principal autenticado.","schema":{"type":"string"}},
 "mode": {"name":"mode","in":"query","required":False,"description":"Tipo de morosidad.","schema":{"type":"string","enum":["HOME","ROOM"],"default":"HOME"}},
 "title": {"name":"title","in":"query","required":False,"description":"Contiene este título; ≤100, sin distinguir mayúsculas/tildes.","schema":{"type":"string","maxLength":100}},
 "author": {"name":"author","in":"query","required":False,"description":"Contiene este autor; ≤100, sin distinguir mayúsculas/tildes.","schema":{"type":"string","maxLength":100}},
 "type": {"name":"type","in":"query","required":False,"description":"Tipo documental; MULTIMEDIA incluye AUDIO y VIDEO.","schema":{"type":"string","enum":["BOOK","TECHNICAL","AUDIO","VIDEO","MULTIMEDIA"]}},
 "publisher": {"name":"publisher","in":"query","required":False,"description":"Contiene esta editorial; ≤100, sin distinguir mayúsculas/tildes.","schema":{"type":"string","maxLength":100}},
 "availability": {"name":"availability","in":"query","required":False,"description":"AVAILABLE: disponibles>0; UNAVAILABLE: disponibles=0; IN_ROOM: en sala>0.","schema":{"type":"string","enum":["AVAILABLE","UNAVAILABLE","IN_ROOM"]}},
 "subcategory": {"name":"subcategory","in":"query","required":False,"description":"Contiene esta subcategoría (category); ≤100, sin distinguir mayúsculas/tildes.","schema":{"type":"string","maxLength":100}},
}
ROLE_NAMES = {"PUBLIC":"Anónimo","READER":"Lector","LIBRARIAN":"Bibliotecario","ADMIN":"Administrativo"}
def load_routes():
    source=(ROOT/"src/main/java/cl/bec/Routes.java").read_text()
    return [dict(zip(["id","method","external","target","internal","roles","screen","purpose"],r))
            for r in re.findall(r'r\("([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"\)',source)]
def ownership(sid):
    return {
        "S15":"Lector solo ficha propia; bibliotecario sin contacto; administrativo completo",
        "S17":"Principal = titular; lector activo, sin vencidos/sanción",
        "S18":"Lector propias; bibliotecario solo cola pendiente",
        "S19":"Titular o bibliotecario, pendiente",
        "S20":"Bibliotecario, RUN/huella válidos, pendiente vigente",
        "S21":"Lector propias; personal por alcance",
        "S22":"Lector propio; personal autorizado",
        "S23":"Lector propio o bibliotecario, HOME entregado",
        "S24":"Bibliotecario, copia en préstamo ACTIVE",
        "S25":"Titular elegible, copia/fecha sin conflicto",
        "S26":"Lector propias; bibliotecario por lector",
        "S27":"Titular o bibliotecario, activa",
        "S30":"Lector propio; personal autorizado",
        "S31":"Autenticado READER pero negocio rechaza SIEMPRE 422",
        "S32":"Lector cuenta propia; contacto solo titular/ADMIN; bibliotecario identidad",
        "S34":"ADMIN y laboratorio habilitado",
        "S35":"ADMIN y lector INACTIVE, cuenta provisionada"
    }.get(sid, "Rol permitido y reglas del contrato; denegación por defecto")

def main():
    DOCS.mkdir(exist_ok=True)
    routes=load_routes()
    assert len(routes)==len(META)==35
    contracts=[r|META[r["id"]] for r in routes]
    (DOCS/"contratos.json").write_text(json.dumps({"note":"Ejemplos ficticios, no credenciales ni datos de producción.","schemas":SCHEMAS,"operations":contracts},ensure_ascii=False,indent=2))
    spec={"openapi":"3.0.3","info":{"title":"BEC — Caso 16","version":"1.1.0","description":"35 operaciones públicas. Actualización React: DIGITAL, descripción, stock atómico y seis filtros. HTTPS obligatorio. Oracle preparado/no validado; pruebas H2 en archivo. Los ejemplos son ficticios."},
          "servers":[{"url":"https://localhost:8443"}],"paths":{},
          "components":{"securitySchemes":{"BearerSession":{"type":"http","scheme":"bearer","bearerFormat":"Opaque256bit"}},
                        "schemas":dict(SCHEMAS)|{"Error":response_schema(ERROR)}}}
    md=["# Anexo A — Catálogo y contratos completos",
        "",
        "Fuente de rutas: `src/main/java/cl/bec/Routes.java`. Generación: `python3 scripts/contracts.py`.",
        "Todos los JSON siguientes son ficticios; los tokens A… y las contraseñas de ejemplo no funcionan. No hay credenciales iniciales fijas.",
        "",
        "## Convenciones comunes",
        "",
        "- Base `https://localhost:8443`; JSON UTF-8, `Content-Type: application/json` cuando hay cuerpo; campos extra rechazados excepto intención de pago deliberadamente rechazada.",
        "- IDs de ruta: 1–100 caracteres `[A-Za-z0-9_-]`. Fechas/hora UTC ISO-8601 con `Z`; fecha de reserva y plazos de negocio en `America/Santiago`.",
        "- `Authorization: Bearer <sesión>` para operaciones protegidas. Catálogo, política de gratuidad, login y activación permiten anónimo; un Bearer inválido, aun en ruta pública, se rechaza.",
        "- `Idempotency-Key` obligatorio en S17/S24/S25: 8–80 caracteres `[A-Za-z0-9_-]`; misma clave y cuerpo distinto →409. S20 usa ID de solicitud como clave natural.",
        "- `X-Correlation-ID` opcional, 8–64 caracteres alfanuméricos/guión; se recomienda UUID. Si no es válido, el servidor genera uno. Se devuelve en cabecera y en errores. No hay llaves técnicas en el cliente.",
        "- Comunes: 400 JSON/validación; 401 sesión ausente/inválida/vencida; 403 rol/propiedad; 404 recurso/ruta; 405 verbo no publicado; 413 cuerpo>256KiB; 414 URI>2048; 415 tipo de contenido; 429 64 peticiones activas o rate limit; 502 dependencia; 503 secretos/persistencia propia; 500 error controlado sin stack trace.",
        "- Límite por IP/minuto: login 10, API 6000; fijo por minuto, no distribuido. Las pruebas aisladas elevan únicamente login para no bloquear fixtures.",
        "- DELETE es cancelación o baja lógica donde corresponde; no se inventan DELETE de préstamos, lectores, pagos ni auditoría.",
        "",
        "Error REST común:",
        "```json",json.dumps(ERROR,ensure_ascii=False,indent=2),"```",
        "",
        "## Tipos de entrada: obligatoriedad, validación y clasificación",
        ""]
    for name,schema in SCHEMAS.items():
        md += [f"### {name}", "", schema.get("description","") or "Objeto JSON; sin propiedades adicionales.", "",
               "| Campo | Tipo | Obligatorio | Validación | Clasificación |","|---|---|---|---|---|"]
        for name2,p in schema.get("properties",{}).items():
            classification=p.get("x-classification","Contextual")
            desc=p.get("description","Lista de identificadores.") if p.get("type")!="array" else "1–5 IDs, únicos, existentes; cada ID [A-Za-z0-9_-], 1–80."
            md.append(f"| {name2} | {p.get('type','objeto')} | {'Sí' if name2 in schema.get('required',[]) else 'No'} | {desc.replace('|','/')} | {classification} |")
        md.append("")
    md += ["## Índice de acciones", "", "| ID | Pantalla | Verbo y ruta | Responsable |", "|---|---|---|---|"]
    for r in contracts:
        md.append(f"| {r['id']} | {r['screen']} | {r['method']} `{r['external']}` | {r['target']} |")
    md += ["", "## Contratos individuales", ""]
    for r in contracts:
        sid=r["id"]
        params=[]
        if "{id}" in r["external"]:
            params.append({"name":"id","in":"path","required":True,"description":"Recurso existente; S30 usa loanId, S33 código de ejemplar.","schema":{"type":"string","pattern":"^[A-Za-z0-9_-]{1,100}$"}})
        params += [QUERIES[x] for x in r["query"]]
        if sid in ("S17","S24","S25"):
            params.append({"name":"Idempotency-Key","in":"header","required":True,"schema":{"type":"string","pattern":"^[A-Za-z0-9_-]{8,80}$"}})
        schema_name=sid+"Response"
        spec["components"]["schemas"][schema_name]=response_schema(r["responseExample"])
        responses={str(r["success"]):{"description":r["specificErrors"] if r["success"]==422 else "Resultado de la operación. Proyección de salida documentada por este esquema y ejemplo.",
                      "content":{"application/json":{"schema":ref(schema_name),"example":r["responseExample"]}}}}
        for code,desc in {400:"Entrada inválida",401:"Sesión requerida o inválida",403:"Permiso, propiedad o campo denegado",404:"No encontrado",
                           405:"Verbo no publicado",409:"Conflicto de estado o idempotencia",410:"Activación vencida",413:"Cuerpo demasiado grande",414:"URI demasiado larga",
                          415:"JSON requerido",429:"Límite de solicitudes",500:"Error controlado",502:"Dependencia no disponible",503:"Secretos o persistencia propia no disponibles"}.items():
            if str(code) not in responses:
                responses[str(code)]={"description":desc+"; aplicabilidad específica en descripción de la operación.","content":{"application/json":{"schema":ref("Error")}}}
        operation={"operationId":sid,"summary":r["purpose"],"tags":[r["target"]],"description":r["businessRule"]+"\n"+r["specificErrors"],
                   "parameters":params,"security":[{}] if r["roles"]=="PUBLIC" else [{"BearerSession":[]}],
                   "responses":responses,"x-roles":r["roles"].split(","),"x-screen":r["screen"],
                   "x-internal-target":r["target"]+":"+r["internal"],"x-ownership":ownership(sid)}
        if r["bodySchema"]:
            operation["requestBody"]={"required":sid!="S02","content":{"application/json":{"schema":ref(r["bodySchema"]),"example":r["requestExample"]}}}
        spec["paths"].setdefault(r["external"],{})[r["method"].lower()]=operation
        auth="Anónimo permitido" if r["roles"]=="PUBLIC" else "Bearer; "+", ".join(ROLE_NAMES[x] for x in r["roles"].split(","))
        md += [f"### {sid} — {r['purpose']}", "", f"**{r['method']} `{r['external']}`** · pantalla {r['screen']} · {auth}.",
               f"Destino privado: `{r['target']} {r['method']} {r['internal']}`; el gateway conserva query y JSON salvo S02 (token derivado del Bearer).",
               "", "**Entrada.** "+(f"`{r['bodySchema']}` (tabla de campos anterior)." if r["bodySchema"] else "Sin cuerpo."),
               "Parámetros: "+("; ".join(p["name"]+" ("+p["in"]+", "+("obligatorio" if p["required"] else "opcional")+")" for p in params) if params else "ninguno")+".",
               "", "**Regla y autorización.** "+(r["businessRule"] or ownership(sid)),"",
               "**Errores específicos.** "+r["specificErrors"]+"; además los errores comunes aplicables.","",
               "Entrada JSON ficticia:", "```json", json.dumps(r["requestExample"],ensure_ascii=False,indent=2) if r["requestExample"] is not None else "{}",
               "```", f"Salida JSON ficticia — HTTP {r['success']}:", "```json", json.dumps(r["responseExample"],ensure_ascii=False,indent=2), "```", ""]
    md += ["## Semántica de salidas y campos condicionales", "",
           "Los esquemas `SxxResponse` en `openapi.json` indican los tipos de cada proyección, no solo un nombre genérico. `docs/contratos.json` conserva los ejemplos y la clasificación de entradas. En páginas, `items` es una lista, `total` entero; `page`/`size` se devuelven donde aparecen en el contrato.",
           "Los IDs, estados y fechas de préstamos/reservas son contextuales y privados. `ownerId` nunca se acepta desde el navegador en las creaciones propias. En catálogo, `dueAt`/`readyAt` son públicos contextuales sin vincular personas. Cualquier `*Hash`, `*Cipher`, secreto técnico o plantilla está excluido de los DTO.",
           "En resultados de saga se puede observar ALLOCATING/ISSUING/PREPARING/RESERVING/RETURNING; un 502 no autoriza a duplicar la operación con otra clave. Reconsultar/reintentar la misma clave hasta resolver. Un error GraphQL tiene `errors[].message`, `path` y `extensions.code`; los campos nullable pueden quedar null con datos parciales de otros subsistemas.",
           "Las respuestas de registro no devuelven clave ni enlace de activación. La excepción deliberada de exposición de enlace es S34, bandeja de laboratorio: solo ADMIN y deshabilitable con --no-lab. Nunca habilitarla en un piloto real."]
    (DOCS/"contratos.md").write_text("\n".join(md),encoding="utf-8")
    (DOCS/"openapi.json").write_text(json.dumps(spec,ensure_ascii=False,indent=2),encoding="utf-8")
    rows=[]
    for path in sorted({r["external"] for r in routes}):
        for verb in ("GET","POST","PUT","DELETE"):
            r=next((r for r in routes if r["external"]==path and r["method"]==verb),None)
            row={"servicio":r["id"] if r else "N/A","ruta":path,"verbo":verb}
            for role in ROLE_NAMES:
                row[ROLE_NAMES[role]]="N/A (405)" if not r else ("PERMITIDO" if r["roles"]=="PUBLIC" or role in r["roles"].split(",") else "DENEGADO (401/403)")
            row["condicion"]=ownership(r["id"]) if r else "Operación no publicada; no hay CRUD ficticio"
            row["control"]="Gateway allowlist + rol; "+r["target"]+" rol/propiedad/estado" if r else "Gateway: 405"
            rows.append(row)
    with (DOCS/"matriz_acceso.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    with (DOCS/"rutas_y_credenciales.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.writer(f);writer.writerow(["id","metodo","ruta_externa","destino_privado","ruta_interna","sesion_usuario","identidad_tecnica","transformacion"])
        for r in routes:
            writer.writerow([r["id"],r["method"],r["external"],r["target"],r["internal"],r["roles"],
                             "K_GATEWAY_"+r["target"].upper()+" + TLS CA + principal firmado",
                             "Allowlist; descarta cabeceras técnicas; nuevo HMAC; conserva JSON/query; S02 sustituye token por Bearer"])
    print(f"Generados {len(routes)} contratos, {len(rows)} combinaciones ruta/verbo, OpenAPI y tablas.")
if __name__=="__main__":
    main()
