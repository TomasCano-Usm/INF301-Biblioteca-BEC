"use strict";
// Sesión únicamente en memoria: cerrar/recargar la pestaña elimina el bearer.
const state = { token: null, user: null, page: "catalog", viewVersion: 0, catalog: [], selected: new Set(), catalogPage: 0, accountPage: 0, q: "", idle: Date.now() };
const main = document.querySelector("#main");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = v => v ? new Date(v).toLocaleString("es-CL", { timeZone: "America/Santiago" }) : "—";
const role = () => state.user?.role || "ANONYMOUS";
const key = () => crypto.randomUUID();
const tag = s => `<span class="tag ${["EXPIRED", "FAILED", "ABORTED"].includes(s) ? "bad" : ["HELD", "RESHELVING", "PREPARING"].includes(s) ? "warn" : ""}">${esc(s)}</span>`;
const field = (name, title, type = "text", value = "", extra = "") => `<label>${title}<input name="${name}" type="${type}" value="${esc(value)}" ${extra} required></label>`;
function notice(text, error = false) { const e = document.querySelector("#notice"); e.textContent = text; e.classList.toggle("error", error); }
async function api(path, method = "GET", body, idempotency) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  const res = await fetch("/api" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && state.token) { state.token = null; state.user = null; navigation(); }
    throw new Error(`${data.error?.message || "No fue posible completar la operación."} [${data.error?.code || res.status}]`);
  }
  return data;
}
function navigation() {
  const pages = [["catalog", "Catálogo", ["ANONYMOUS", "READER", "ADMIN", "LIBRARIAN"]], ["account", "Mi cuenta", ["READER"]],
    ["inventory", "Colección", ["LIBRARIAN"]], ["readers", "Lectores", ["ADMIN"]], ["queue", "Preparar y entregar", ["LIBRARIAN"]],
    ["returns", "Devoluciones", ["LIBRARIAN"]], ["overdue", "Morosidad", ["ADMIN"]], ["mailbox", "Correo de prueba", ["ADMIN"]]];
  document.querySelector("#nav").innerHTML = pages.filter(p => p[2].includes(role())).map(p => `<button data-page="${p[0]}" ${state.page === p[0] ? 'aria-current="page"' : ""}>${p[1]}</button>`).join("") + '<a href="/help.html">Ayuda</a>';
  document.querySelector("#session-label").textContent = state.user ? `${state.user.role} · ${state.user.id}` : "Catálogo abierto";
  const button = document.querySelector("#session-button"); button.textContent = state.token ? "Cerrar sesión" : "Ingresar"; button.dataset.action = state.token ? "logout" : "login-page";
}
async function show(page) {
  const version = ++state.viewVersion;
  state.page = page; navigation(); main.innerHTML = '<p class="empty">Cargando…</p>';
  try {
    const views = { catalog, login, account, inventory, readers, queue, returns: returnView, overdue, mailbox };
    await (views[page] || catalog)();
  } catch (e) { if (version !== state.viewVersion) return; main.innerHTML = '<section class="panel"><h1>No se pudo cargar esta vista</h1><p>Revise su sesión o reintente desde el menú. No se alteraron datos por esta consulta.</p></section>'; notice(e.message, true); }
}
function pager(page, total, action, size = 10) {
  return `<div class="pagination"><button class="outline small" data-action="${action}" data-page-number="${page - 1}" ${page === 0 ? "disabled" : ""}>Anterior</button><span class="muted">Página ${page + 1} · ${total} resultados</span><button class="outline small" data-action="${action}" data-page-number="${page + 1}" ${(page + 1) * size >= total ? "disabled" : ""}>Siguiente</button></div>`;
}
async function catalog() {
  const version = state.viewVersion;
  const data = await api(`/catalog?q=${encodeURIComponent(state.q)}&size=10&page=${state.catalogPage}`);
  if (version !== state.viewVersion) return;
  state.catalog = data.items;
  main.innerHTML = `<section class="hero"><div><span class="eyebrow">Cultura cerca de ti</span><h1>Tu próximo descubrimiento<br>está en la biblioteca.</h1><p>Explora libros, documentos y material multimedia. Consulta sin registrarte; solicita préstamos de sala o domicilio con tu cuenta activada.</p></div><div class="hero-number">${data.total}<small>títulos en catálogo</small></div></section>
    <form id="search" class="toolbar"><label class="grow">Título, autor o categoría<input name="q" value="${esc(state.q)}" maxlength="100" placeholder="¿Qué te gustaría encontrar?"></label><button>Buscar</button></form>
    ${role() === "READER" ? `<section class="panel"><div class="toolbar"><label>Modalidad<select id="request-mode"><option value="HOME">Domicilio</option><option value="ROOM">Sala</option></select></label><button data-action="request">Solicitar seleccionados (${state.selected.size}/5)</button><span class="muted">La retención dura 20 minutos; la entrega requiere RUN y huella.</span></div></section>` : '<p class="info">El catálogo es público. Ingrese como lector para solicitar o reservar. Los préstamos son gratuitos.</p>'}
    <div class="section-heading"><h2>Colección disponible</h2><span class="muted">Hora oficial: America/Santiago</span></div>
    <div class="grid">${data.items.map(d => `<article class="card"><span class="tag">${esc(d.type)} · ${esc(d.medium)}</span><h2>${esc(d.title)}</h2><p>${esc(d.author)}</p><p class="meta">${esc(d.publisher)} · ${d.year} · Ed. ${esc(d.edition)}</p><p class="meta">${esc(d.category)} · ${d.homeDays} días domicilio / ${d.roomHours} h sala</p>
      <div class="availability"><div><strong>${d.available}</strong><span>disponibles</span></div><div><strong>${d.inRoom}</strong><span>en sala · puede esperar</span></div><div><strong>${d.total}</strong><span>ejemplares</span></div></div>
      ${d.copies.map(c => `<label class="copy"><input type="checkbox" data-copy="${esc(c.id)}" ${state.selected.has(c.id) ? "checked" : ""} ${role() !== "READER" || c.state !== "AVAILABLE" ? "disabled" : ""}><span>${esc(c.id)} · ${esc(c.shelf)}<small>${esc(c.state)}${c.readyAt ? " · disponible desde " + when(c.readyAt) : ""}${c.dueAt && c.state === "ROOM" ? " · vence " + when(c.dueAt) : ""}</small></span></label>`).join("")}
      ${role() === "READER" ? `<form class="reserve" data-doc="${esc(d.id)}"><label>Reservar ejemplar<select name="copyId">${d.copies.map(c => `<option>${esc(c.id)}</option>`).join("")}</select></label><div class="toolbar"><label class="grow">Fecha<input type="date" name="date" required></label><button class="outline small">Reservar</button></div></form>` : ""}</article>`).join("") || '<p class="empty">No encontramos títulos para esa búsqueda.</p>'}</div>${pager(state.catalogPage, data.total, "catalog-page")}`;
}
function login() {
  main.innerHTML = `<section class="panel narrow"><span class="eyebrow">P02 · Acceso seguro</span><h1>Bienvenido a BEC</h1><p class="muted">Lectores con correo validado y personal autorizado.</p><form id="login">${field("email", "Correo electrónico", "email", "", 'autocomplete="username" maxlength="160"')}${field("password", "Contraseña", "password", "", 'autocomplete="current-password" maxlength="128"')}<button>Ingresar</button></form><p class="info">Kiosco: cierre sesión al terminar. Por seguridad, la sesión no se conserva al recargar. El cierre por inactividad ocurre a los 5 minutos y el servidor la vence a los 20.</p></section>`;
}
async function account() {
  const version = state.viewVersion;
  const query = `query Cuenta($page:Int!){account(first:10,page:$page){reader{id names surnames state email} totalLoans page hasMore sanctionUntil loans{id mode state issuedAt items{copyId title dueAt state returnedAt readyAt document{id author category}} assessment{amount currency state}} reservations{id copyId date mode state}}}`;
  const [result, requests, policy] = await Promise.all([api("/graphql", "POST", { query, variables: { page: state.accountPage } }), api("/requests?size=20"), api("/payments/policy")]);
  if (version !== state.viewVersion) return;
  if (!result.data?.account) throw new Error(result.errors?.map(e => e.message).join(" · ") || "Resumen no disponible");
  const a = result.data.account;
  main.innerHTML = `<section class="panel"><span class="eyebrow">P03 · Mi cuenta · GraphQL privado</span><h1 class="account-name">${esc(a.reader.names)} ${esc(a.reader.surnames)}</h1><p class="muted">${esc(a.reader.email)} · ${tag(a.reader.state)}</p><div class="kpi-row"><div class="kpi"><strong>${a.totalLoans}</strong><span>préstamos registrados</span></div><div class="kpi"><strong>$${policy.amount}</strong><span>CLP · biblioteca gratuita</span></div></div>${a.sanctionUntil && new Date(a.sanctionUntil) > new Date() ? `<p class="info warning">No puede solicitar hasta ${when(a.sanctionUntil)}. La sanción no se paga.</p>` : ""}${result.errors ? '<p class="info warning">Resumen parcial: un subsistema no respondió. Sus préstamos permanecen registrados.</p>' : ""}</section>
    <div class="section-heading"><h2>Mis préstamos</h2></div>${a.loans.map(l => `<article class="panel"><div class="section-heading"><h2>${l.mode === "HOME" ? "Domicilio" : "Sala"}</h2>${tag(l.state)}</div><p class="muted"><code>${esc(l.id)}</code> · Entrega: ${when(l.issuedAt)}</p>${loanItems(l.items)}<p class="muted">Evaluación: ${l.assessment ? `${esc(l.assessment.state)} · ${l.assessment.amount} ${esc(l.assessment.currency)}` : "temporalmente no disponible"}</p>${l.mode === "HOME" && !["PREPARING", "ABORTED"].includes(l.state) ? `<button class="outline small" data-action="receipt" data-id="${esc(l.id)}">Ver / imprimir comprobante</button>` : ""}</article>`).join("") || '<p class="empty">Aún no tiene préstamos.</p>'}${pager(state.accountPage, a.totalLoans, "account-page")}
    <section class="panel"><h2>Mis solicitudes</h2>${table(["Código", "Modalidad", "Estado", "Acción"], requests.items.map(r => [`<code>${esc(r.id)}</code>`, esc(r.mode), tag(r.state), r.state === "PENDING" ? `<button class="small danger" data-action="cancel-request" data-id="${esc(r.id)}">Cancelar</button>` : "—"]))}<p class="muted">Últimos 20 registros de solicitudes. El catálogo muestra la disponibilidad vigente.</p></section>
    <section class="panel"><h2>Mis reservas</h2>${table(["Ejemplar", "Fecha", "Estado", "Acción"], a.reservations.map(r => [esc(r.copyId), esc(r.date), tag(r.state), r.state === "ACTIVE" ? `<button class="small danger" data-action="cancel-reservation" data-id="${esc(r.id)}">Cancelar</button>` : "—"]))}<p class="info">Su resumen combina Clientes, Pedidos, Inventario y Pagos sin acceder directamente a sus bases de datos.</p><button class="outline small" data-action="test-payment">Demostrar rechazo de cobro (prueba académica)</button></section>`;
}
function table(headers, rows) { return rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<p class="empty">Sin registros.</p>'; }
function loanItems(items) { return table(["Ejemplar / título", "Vencimiento individual", "Estado", "Disponible tras devolución"], items.map(i => [`<strong>${esc(i.copyId)}</strong><br>${esc(i.title)}${i.document ? `<br><small>${esc(i.document.author)}</small>` : ""}`, when(i.dueAt), tag(i.state), when(i.readyAt)])); }
const documentFields = d => `<div class="form-grid">${field("title", "Título", "text", d?.title || "", 'maxlength="200"')}${field("author", "Autor", "text", d?.author || "", 'maxlength="140"')}<label>Tipo<select name="type">${["BOOK", "TECHNICAL", "AUDIO", "VIDEO"].map(t => `<option ${d?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>Soporte<select name="medium">${["PAPER", "CASSETTE", "CD", "DVD", "BLURAY"].map(t => `<option ${d?.medium === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>${field("publisher", "Editorial", "text", d?.publisher || "")}${field("edition", "Edición", "text", d?.edition || "1")}${field("year", "Año", "number", d?.year || 2026, 'min="1450" max="2026"')}${field("category", "Categoría", "text", d?.category || "")}${field("shelf", "Ubicación inicial", "text", d?.shelf || "")}${field("homeDays", "Días de domicilio", "number", d?.homeDays || 7, 'min="1" max="30"')}${field("roomHours", "Horas de sala", "number", d?.roomHours || 3, 'min="1" max="8"')}</div>`;
async function inventory(edit) {
  const version = state.viewVersion;
  const data = await api("/catalog?size=20");
  if (version !== state.viewVersion) return;
  state.catalog = data.items;
  main.innerHTML = `<div class="section-heading"><h1>P04 · Administración de la colección</h1></div><section class="panel"><h2>${edit ? "Editar documento" : "Nuevo documento"}</h2><form id="document" data-id="${esc(edit?.id || "")}">${documentFields(edit)}<div class="actions"><button>Guardar documento</button>${edit ? '<button type="button" class="outline" data-page="inventory">Cancelar edición</button>' : ""}</div></form></section>
    <section class="panel"><h2>Documentos y ejemplares</h2>${table(["Título", "Código / existencias", "Acciones"], data.items.map(d => [esc(d.title), `<code>${esc(d.id)}</code><br>${d.available} disponibles / ${d.total} total`, `<div class="actions"><button class="small outline" data-action="edit-document" data-id="${esc(d.id)}">Editar</button><button class="small danger" data-action="archive-document" data-id="${esc(d.id)}">Archivar</button></div><p class="muted">${d.copies.map(c => `${esc(c.id)}: ${esc(c.state)}`).join("<br>")}</p>`]))}<p class="muted">Se muestran 20 títulos; el catálogo permite buscar y paginar. Archivar no elimina el historial.</p></section>
    <section class="panel"><h2>Ejemplares</h2><form id="copy" class="toolbar"><label class="grow">Documento<select name="documentId">${data.items.map(d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join("")}</select></label>${field("code", "Código nuevo", "text", "", 'pattern="[A-Z0-9-]{3,40}"')}${field("shelf", "Ubicación")}<button>Agregar ejemplar</button></form><form id="copy-update" class="toolbar">${field("code", "Código existente")}${field("shelf", "Nueva ubicación")}<button class="outline">Cambiar ubicación</button><button type="button" class="danger" data-action="retire-copy">Retirar ejemplar</button></form></section>`;
}
const samplePhoto = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII=";
async function readers() {
  const version = state.viewVersion;
  const data = await api("/readers?size=20");
  if (version !== state.viewVersion) return;
  main.innerHTML = `<div class="section-heading"><h1>P05 · Fichas de lectores</h1></div><p class="info warning">Adaptador biométrico determinista de laboratorio: recibe una muestra base64; no es reconocimiento de huellas físico ni está homologado.</p>
    <section class="panel"><h2>Inscripción administrativa</h2><form id="reader"><div class="form-grid">${field("rut", "RUN con dígito verificador", "text", "", 'placeholder="12345678-5"')}${field("names", "Nombres")}${field("surnames", "Apellidos")}${field("address", "Dirección")}${field("email", "Correo", "email")}${field("telephone", "Teléfono", "tel", "", 'minlength="8" maxlength="20"')}${field("password", "Contraseña inicial (12 caracteres mínimo)", "password", "", 'minlength="12" autocomplete="new-password"')}${field("fingerprint", "Muestra biométrica de prueba (base64)", "text", "", 'minlength="32" maxlength="2048"')}<label>Foto PNG/JPEG (hasta 128 KiB)<input type="file" name="photoFile" accept="image/png,image/jpeg"></label><label class="copy"><input name="documentsChecked" type="checkbox" required>Documentos de inscripción comprobados</label></div><div class="actions"><button>Inscribir y enviar activación</button><button type="button" class="outline" data-action="sample-photo">Usar foto ficticia de laboratorio</button></div><input type="hidden" name="samplePhoto" value=""></form></section>
    <section class="panel"><h2>Lectores registrados</h2><form id="reader-search" class="toolbar"><label class="grow">Buscar por nombre o RUN<input name="q" maxlength="100"></label><button class="outline">Buscar</button></form><div id="reader-list">${readerTable(data.items)}</div><div id="reader-detail"></div></section>`;
}
function readerTable(items) { return table(["Lector", "RUN", "Estado", "Ficha"], items.map(r => [`${esc(r.names)} ${esc(r.surnames)}`, esc(r.rut), tag(r.state), `<button class="outline small" data-action="reader-detail" data-id="${esc(r.id)}">Ver / actualizar</button>`])); }
async function readerDetail(id) {
  const version = state.viewVersion;
  const r = await api("/readers/" + id);
  if (version !== state.viewVersion) return;
  const destination = document.querySelector("#reader-detail") || main;
    destination.innerHTML = `<section class="panel"><h2>${esc(r.names)} ${esc(r.surnames)}</h2><img class="photo" alt="Fotografía de la ficha" src="data:image/png;base64,${esc(r.photo)}"><p class="muted">${esc(r.id)} · ${esc(r.email)} · ${tag(r.state)}</p><form id="reader-update" data-id="${esc(id)}" data-photo="${esc(r.photo)}"><div class="form-grid">${field("address", "Dirección", "text", r.address)}${field("telephone", "Teléfono", "text", r.telephone)}</div><div class="actions"><button>Actualizar contacto</button>${r.state === "INACTIVE" ? `<button type="button" class="outline" data-action="resend-activation" data-id="${esc(id)}">Reenviar activación</button>` : ""}</div></form><p class="muted">La fotografía original se conserva. RUN/correo/biometría no se modifican por este formulario para no eludir validación.</p></section>`;
}
async function queue() {
  const version = state.viewVersion;
  const [requests, reservations] = await Promise.all([api("/requests?size=20"), api("/reservations?size=20")]);
  if (version !== state.viewVersion) return;
  main.innerHTML = `<div class="section-heading"><h1>P06 · Preparar y entregar</h1><button class="outline small" data-page="queue">Actualizar</button></div><p class="info">Prepare los ejemplares indicados. La entrega final requiere presencia del lector, RUN y comprobación biométrica. Los plazos se calculan en el servidor.</p><section class="panel"><h2>Cola de solicitudes</h2>${table(["Solicitud / lector", "Material para preparar", "Modalidad / estado", "Acción"], requests.items.map(r => [`<code>${esc(r.id)}</code><br><code>${esc(r.ownerId)}</code>`, (r.items || []).map(i => `<strong>${esc(i.copyId)}</strong> · ${esc(i.title)}<br><small>Ubicación: ${esc(i.shelf)}</small>`).join("<br>"), `${esc(r.mode)}<br>${tag(r.state)}<br><small>Retención: ${when(r.expiresAt)}</small>`, r.state === "PENDING" ? `<button class="small" data-action="prepare" data-id="${esc(r.id)}" data-reader="${esc(r.ownerId)}">Verificar y entregar</button>` : "Procesamiento recuperable"]))}</section><div id="issue-area"></div><section class="panel"><h2>Reservas por fecha</h2>${table(["Código", "Ejemplar", "Fecha", "Estado"], reservations.items.map(r => [`<code>${esc(r.id)}</code>`, esc(r.copyId), esc(r.date), tag(r.state)]))}</section>`;
}
function returnView() {
  main.innerHTML = `<div class="section-heading"><h1>P07 · Devoluciones y salida</h1></div><section class="panel"><h2>Recibir devolución</h2><form id="return" class="toolbar">${field("copyId", "Código del ejemplar", "text", "", 'autofocus maxlength="40"')}<button>Registrar devolución</button></form><p class="info">La devolución queda registrada ahora. El ejemplar NO estará disponible hasta 30 minutos después, para permitir su reubicación. Si hay atraso, se aplica bloqueo temporal, nunca cobro.</p><div id="return-result"></div></section><section class="panel"><h2>Adaptador de control antirrobo</h2><form id="exit" class="toolbar">${field("copyId", "Código del ejemplar")}<button class="outline">Consultar salida autorizada</button></form><p class="muted">Simulación de software: solo HOME autoriza salida. No se conectó ni certificó una antena/RFID física.</p><div id="exit-result"></div></section>`;
}
async function overdue(mode = "HOME") {
  const version = state.viewVersion;
  const data = await api("/overdue?size=20&mode=" + mode);
  if (version !== state.viewVersion) return;
  main.innerHTML = `<div class="section-heading"><h1>P08 · Administración de morosidad</h1></div><form id="overdue" class="toolbar"><label>Modalidad<select name="mode"><option value="HOME" ${mode === "HOME" ? "selected" : ""}>Domicilio</option><option value="ROOM" ${mode === "ROOM" ? "selected" : ""}>Sala</option></select></label><button>Consultar</button></form><section class="panel">${table(["Lector", "Material", "Vencimiento", "Contacto"], data.items.map(r => [`<code>${esc(r.readerId)}</code>`, `<strong>${esc(r.copyId)}</strong><br>${esc(r.title)}`, when(r.dueAt), `<button class="small outline" data-action="reader-detail" data-id="${esc(r.readerId)}">Consultar ficha</button>`]))}<p class="info">${mode === "HOME" ? "El proceso automático encola un recordatorio de domicilio por préstamo y día, con reintentos y deduplicación." : "Sala: contacte presencialmente al lector para exigir devolución. No se envía recordatorio de domicilio."}</p><p class="muted">${data.total} ejemplares atrasados. Se muestran hasta 20.</p></section><div id="reader-detail"></div>`;
}
async function mailbox() {
  const version = state.viewVersion;
  const data = await api("/lab/mailbox?size=20");
  if (version !== state.viewVersion) return;
  main.innerHTML = `<div class="section-heading"><h1>P10 · Proveedor de correo de prueba</h1><button class="outline small" data-page="mailbox">Actualizar</button></div><p class="info warning">NO se enviaron correos por Internet. Esta bandeja permite comprobar el contrato, activación, comprobantes y recordatorios. Se deshabilita fuera del laboratorio.</p>${data.items.map(m => {
    const activation = m.text.match(/\?activation=([A-Za-z0-9_-]{43})/);
    return `<article class="panel"><span class="tag">Proveedor de prueba</span><h2>${esc(m.subject)}</h2><p class="muted">Para: ${esc(m.to)} · ${when(m.createdAt)}</p><pre class="mail">${esc(m.text)}</pre>${activation ? `<button class="outline" data-action="activate" data-token="${esc(activation[1])}">Seguir enlace de activación</button>` : ""}</article>`;
  }).join("") || '<p class="empty">Aún no hay mensajes. El trabajador procesa la cola periódicamente; actualice en unos segundos.</p>'}`;
}
async function receipt(id) {
  const version = ++state.viewVersion;
  const r = await api("/loans/" + id + "/receipt");
  if (version !== state.viewVersion) return;
  main.innerHTML = `<section class="panel receipt"><span class="eyebrow">P09 · Comprobante individualizado</span><h1>Biblioteca Estación Central</h1><h2>Préstamo a domicilio</h2><p>N.º ${esc(r.loanId)}<br>Lector: ${esc(r.readerId)}<br>Entrega: ${when(r.issuedAt)}</p>${loanItems(r.items)}<p>Importe: ${r.amount} ${esc(r.currency)} · servicio gratuito.</p><p>Respete el plazo de cada ejemplar. Los atrasos generan sanción temporal.</p><div class="actions no-print"><button data-action="print">Imprimir</button><button class="outline" data-page="${role() === "READER" ? "account" : "queue"}">Volver</button></div></section>`;
}
async function photoValue(form) {
  const file = form.elements.photoFile?.files[0];
  if (!file) { if (form.elements.samplePhoto.value) return form.elements.samplePhoto.value; throw new Error("Seleccione una foto o use la muestra ficticia."); }
  if (file.size > 128000) throw new Error("La foto excede 128 KiB.");
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}
document.addEventListener("submit", async e => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  e.preventDefault(); const b = Object.fromEntries(new FormData(form)); form.classList.add("busy"); notice("");
  try {
    if (form.id === "login") { const data = await api("/auth/login", "POST", b); state.token = data.token; state.user = { id: data.id, role: data.role }; state.idle = Date.now(); await show(role() === "READER" ? "account" : role() === "ADMIN" ? "readers" : "queue"); }
    else if (form.id === "search") { state.q = b.q; state.catalogPage = 0; await show("catalog"); }
    else if (form.classList.contains("reserve")) { await api("/reservations", "POST", { copyId: b.copyId, date: b.date, mode: document.querySelector("#request-mode").value }, key()); notice("Reserva registrada para la fecha indicada."); }
    else if (form.id === "document") { for (const n of ["year", "homeDays", "roomHours"]) b[n] = Number(b[n]); await api("/documents" + (form.dataset.id ? "/" + form.dataset.id : ""), form.dataset.id ? "PUT" : "POST", b); notice("Documento guardado."); await show("inventory"); }
    else if (form.id === "copy") { await api("/documents/" + b.documentId + "/copies", "POST", { code: b.code, shelf: b.shelf }); notice("Ejemplar incorporado."); await show("inventory"); }
    else if (form.id === "copy-update") { await api("/copies/" + encodeURIComponent(b.code), "PUT", { shelf: b.shelf }); notice("Ubicación actualizada."); await show("inventory"); }
    else if (form.id === "reader") { const photo = await photoValue(form); delete b.photoFile; delete b.samplePhoto; b.photo = photo; b.documentsChecked = form.elements.documentsChecked.checked; await api("/readers", "POST", b); notice("Inscripción registrada. Revise el correo de prueba y valide el enlace antes de ingresar."); await show("readers"); }
    else if (form.id === "reader-search") { const data = await api("/readers?size=20&q=" + encodeURIComponent(b.q)); document.querySelector("#reader-list").innerHTML = readerTable(data.items); }
    else if (form.id === "reader-update") { await api("/readers/" + form.dataset.id, "PUT", { ...b, photo: form.dataset.photo }); notice("Contacto actualizado."); }
    else if (form.id === "issue") { const loan = await api("/requests/" + form.dataset.id + "/issue", "POST", b); notice("Entrega confirmada. Vencimientos calculados por ejemplar."); if (loan.mode === "HOME") await receipt(loan.id); else await show("queue"); }
    else if (form.id === "return") { const r = await api("/returns", "POST", b, form.dataset.retryKey || (form.dataset.retryKey = key())); document.querySelector("#return-result").textContent = `Devolución ${r.state}. Disponible desde ${when(r.readyAt)}.${r.late ? " Sanción hasta " + when(r.sanctionUntil) : ""}`; delete form.dataset.retryKey; }
    else if (form.id === "exit") { const r = await api("/exit-check/" + encodeURIComponent(b.copyId)); document.querySelector("#exit-result").textContent = r.allowExit ? "Salida permitida: préstamo HOME confirmado (simulación)." : "Salida denegada: no existe préstamo HOME confirmado (simulación)."; }
    else if (form.id === "overdue") await overdue(b.mode);
  } catch (err) { notice(err.message, true); } finally { form.classList.remove("busy"); }
});
document.addEventListener("change", e => {
  if (!e.target.dataset.copy) return;
  const id = e.target.dataset.copy;
  if (e.target.checked && state.selected.size >= 5) { e.target.checked = false; notice("Puede seleccionar hasta cinco ejemplares.", true); return; }
  e.target.checked ? state.selected.add(id) : state.selected.delete(id);
  const button = document.querySelector('[data-action="request"]'); if (button) button.textContent = `Solicitar seleccionados (${state.selected.size}/5)`;
});
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action],[data-page]"); if (!el) return;
  if (el.dataset.page) { notice(""); await show(el.dataset.page); return; }
  try {
    switch (el.dataset.action) {
      case "login-page": await show("login"); break;
      case "logout": try { await api("/auth/logout", "POST", {}); } finally { state.token = null; state.user = null; state.selected.clear(); await show("catalog"); notice("Sesión cerrada."); } break;
      case "request": { if (!state.selected.size) throw new Error("Seleccione al menos un ejemplar."); const mode = document.querySelector("#request-mode").value; await api("/requests", "POST", { copyIds: [...state.selected], mode }, state.requestKey || (state.requestKey = key())); state.requestKey = null; state.selected.clear(); notice("Solicitud recibida. Acérquese al bibliotecario dentro de 20 minutos."); await show("account"); break; }
      case "catalog-page": state.catalogPage = Number(el.dataset.pageNumber); await show("catalog"); break;
      case "account-page": state.accountPage = Number(el.dataset.pageNumber); await show("account"); break;
      case "cancel-request": await api("/requests/" + el.dataset.id, "DELETE"); notice("Solicitud cancelada; retención liberada."); await show("account"); break;
      case "cancel-reservation": await api("/reservations/" + el.dataset.id, "DELETE"); notice("Reserva cancelada."); await show("account"); break;
      case "receipt": await receipt(el.dataset.id); break;
      case "print": window.print(); break;
      case "test-payment": await api("/payments/intents", "POST", { loanId: "simulado", amount: 1, currency: "CLP", paymentStatus: "PAID" }); break;
      case "edit-document": await inventory(state.catalog.find(d => d.id === el.dataset.id)); break;
      case "archive-document": if (confirm("¿Archivar el documento? Se conservará el historial.")) { await api("/documents/" + el.dataset.id, "DELETE"); await show("inventory"); notice("Documento archivado."); } break;
      case "retire-copy": { const form = document.querySelector("#copy-update"); if (confirm("¿Retirar este ejemplar de la colección?")) { await api("/copies/" + encodeURIComponent(form.elements.code.value), "DELETE"); await show("inventory"); } break; }
      case "sample-photo": document.querySelector('#reader input[name="samplePhoto"]').value = samplePhoto; notice("Se usará una imagen ficticia de laboratorio, no una fotografía real."); break;
      case "reader-detail": await readerDetail(el.dataset.id); break;
      case "resend-activation": await api("/readers/" + el.dataset.id + "/activation", "POST", {}); notice("Se encoló un nuevo enlace de 24 horas. El anterior quedó revocado."); break;
      case "prepare": { const r = await api("/readers/" + el.dataset.reader); document.querySelector("#issue-area").innerHTML = `<section class="panel"><h2>Confirmar identidad: ${esc(r.names)} ${esc(r.surnames)}</h2><img class="photo" alt="Foto registrada del lector" src="data:image/png;base64,${esc(r.photo)}"><form id="issue" data-id="${esc(el.dataset.id)}"><div class="form-grid">${field("rut", "RUN presentado")}${field("fingerprint", "Muestra base64 del adaptador de prueba")}</div><div class="actions"><button>Verificar y confirmar entrega</button></div></form></section>`; document.querySelector("#issue-area").scrollIntoView({ behavior: "smooth" }); break; }
      case "activate": await api("/auth/activate", "POST", { token: el.dataset.token }); notice("Correo validado. El lector ya puede ingresar."); el.disabled = true; break;
    }
  } catch (err) { notice(err.message, true); }
});
for (const event of ["click", "keydown", "pointerdown"]) document.addEventListener(event, () => { state.idle = Date.now(); }, { passive: true });
setInterval(async () => {
  if (state.token && Date.now() - state.idle >= 300000) {
    try { await api("/auth/logout", "POST", {}); } catch (_) {}
    state.token = null; state.user = null; state.selected.clear(); await show("catalog"); notice("Sesión cerrada por inactividad del kiosco.");
  }
}, 15000);
async function boot() {
  const activation = new URLSearchParams(location.search).get("activation"); history.replaceState({}, "", "/");
  await show("catalog");
  if (activation) {
    try { await api("/auth/activate", "POST", { token: activation }); notice("Correo validado. Ingrese con su contraseña."); await show("login"); }
    catch (e) { notice(e.message, true); }
  }
}
boot();
