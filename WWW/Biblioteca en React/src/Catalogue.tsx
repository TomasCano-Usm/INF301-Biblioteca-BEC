import { useEffect, useState, type FormEvent } from "react";
import { api, catalogueUrl, emptyFilters, errorMessage, go, mediumNames, statusName, typeNames,
  type Document, type Filters, type Page } from "./api";
import { AdminShell, Cover, Dialog, ErrorBox, Header, LoadState, Pagination, SearchBox, Status } from "./components";
import { useApplication } from "./session";

function useCatalogue(filters: Filters, page: number) {
  const { revision } = useApplication();
  const [data, setData] = useState<Page<Document>>({ items: [], total: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const url = catalogueUrl(filters, page);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    // Cancela búsquedas anteriores y evita que una respuesta tardía cambie la vista.
    const timer = setTimeout(() => {
      void api<Page<Document>>(url, { signal: controller.signal })
        .then((value) => { if (!controller.signal.aborted) setData(value); })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) { setError(errorMessage(reason)); setData({ items: [], total: 0 }); }
        }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, revision, retryVersion]);
  return { data, busy, error, retry: () => setRetryVersion((value) => value + 1) };
}
function FilterPanel({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState(filters);
  useEffect(() => { setDraft(filters); }, [filters]);
  const change = (key: keyof Filters, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  return <form className="collection-filters" aria-label="Filtros de la colección" onSubmit={(event) => {
    event.preventDefault(); onApply({ ...draft, q: filters.q });
  }}>
    <h2>Filtrar colección</h2>
    <div className="filter-fields">
      <label><span>Título</span><input value={draft.title} maxLength={100} onChange={(event) => change("title", event.target.value)} placeholder="Todos los títulos" /></label>
      <label><span>Autor</span><input value={draft.author} maxLength={100} onChange={(event) => change("author", event.target.value)} placeholder="Todos los autores" /></label>
      <label><span>Tipo de documento</span><select aria-label="Tipo de documento" value={draft.type} onChange={(event) => change("type", event.target.value)}>
        <option value="">Todos los tipos</option><option value="BOOK">Libro</option>
        <option value="TECHNICAL">Documento técnico</option><option value="MULTIMEDIA">Multimedia (audio/video)</option>
        <option value="AUDIO">Multimedia · Audio</option><option value="VIDEO">Multimedia · Video</option>
      </select></label>
      <label><span>Editorial</span><input value={draft.publisher} maxLength={100} onChange={(event) => change("publisher", event.target.value)} placeholder="Todas las editoriales" /></label>
      <label><span>Disponibilidad</span><select aria-label="Disponibilidad" value={draft.availability} onChange={(event) => change("availability", event.target.value)}>
        <option value="">Cualquier disponibilidad</option><option value="AVAILABLE">Disponible</option>
        <option value="UNAVAILABLE">No disponible</option><option value="IN_ROOM">Con ejemplares en sala</option>
      </select></label>
      <label><span>Subcategoría</span><input value={draft.subcategory} maxLength={100} onChange={(event) => change("subcategory", event.target.value)} placeholder="Todas las subcategorías" /></label>
    </div>
    <div className="filter-actions"><button type="submit" className="dark-button">Aplicar filtros</button>
      <button type="button" onClick={() => { setDraft({ ...emptyFilters }); onApply({ ...emptyFilters }); }}>Limpiar filtros</button></div>
    <p className="filter-hint">Los filtros se combinan y se aplican a toda la colección. Disponible = al menos un ejemplar libre.</p>
  </form>;
}
export function Collections() {
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [page, setPage] = useState(0);
  const { data, busy, error, retry } = useCatalogue(filters, page);
  function apply(value: Filters) { setFilters(value); setPage(0); }
  return <AdminShell title="Colecciones">
    <div className="table-tools">
      <SearchBox value={filters.q} onChange={(value) => apply({ ...filters, q: value })} />
      <button className="add-button" onClick={() => go("add")}><img src="/assets/84c1a.svg" alt="" />Añadir documento</button>
    </div>
    <FilterPanel filters={filters} onApply={apply} />
    <LoadState busy={busy} error={error} empty={!busy && !error && data.items.length === 0} onRetry={retry} />
    <p className="results-count" role="status">{busy ? "Cargando colección…" : `${data.total} documentos encontrados`}</p>
    <div className="table-wrap" aria-busy={busy}>
      <table>
        <thead><tr>{["DOCUMENTO", "AUTOR", "TIPO / FORMATO", "EDITORIAL", "STOCK", "SUBCATEGORÍA", "DISPONIBILIDAD", "ACCIONES"].map((text) => <th key={text}>{text}</th>)}</tr></thead>
        <tbody>{data.items.map((document) => <tr key={document.id} data-document-id={document.id}>
          <td><strong>{document.title}</strong><small className="document-code">{document.id}</small></td>
          <td>{document.author}</td><td>{typeNames[document.type]}<small className="document-code">{mediumNames[document.medium]}</small></td>
          <td>{document.publisher}</td>
          <td>{document.total} unid.<small className="document-code">{document.available} libres · {document.inRoom} en sala</small></td>
          <td>{document.category}</td><td><Status>{statusName(document)}</Status></td>
          <td><button className="edit-button" aria-label={`Editar ${document.title}`} onClick={() => go("edit", document.id)}>Editar</button></td>
        </tr>)}
        </tbody>
      </table>
    </div>
    <Pagination page={page} total={data.total} onChange={setPage} busy={busy} />
  </AdminShell>;
}
export function Home() {
  const { session, notify, refreshCatalogue } = useApplication();
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [page, setPage] = useState(0);
  const { data, busy, error, retry } = useCatalogue(filters, page);
  const [selected, select] = useState<Document | null>(null);
  const [reservationDocument, setReservationDocument] = useState<Document | null>(null);
  const [copyId, setCopyId] = useState("");
  const [mode, setMode] = useState("HOME");
  const [reservationMode, setReservationMode] = useState<"HOME" | "ROOM">("ROOM");
  const [reservationDate, setReservationDate] = useState(() => localDate(new Date(Date.now() + 86_400_000)));
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [reservationError, setReservationError] = useState("");
  function apply(value: Filters) { setFilters(value); setPage(0); }
  function request(document: Document) {
    if (!session) { go("login"); return; }
    if (session.role === "LIBRARIAN") { go("edit", document.id); return; }
    if (session.role !== "READER") return;
    select(document); setCopyId(document.copies.find((copy) => copy.state === "AVAILABLE")?.id ?? "");
    setMode("HOME"); setKey(crypto.randomUUID()); setRequestError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true); setRequestError("");
    try {
      const result = await api<{ id: string }>("/api/requests", { method: "POST", body: { copyIds: [copyId], mode }, idempotencyKey: key });
      select(null); refreshCatalogue();
      notify({ title: "Solicitud registrada", message: `La solicitud ${result.id} fue recibida. La entrega debe confirmarla un bibliotecario.` });
    } catch (reason) { setRequestError(errorMessage(reason)); }
    finally { setSending(false); }
  }
  function startReservation(document: Document) {
    if (!session) { go("login"); return; }
    if (session.role !== "READER") return;
    const availableCopy = document.copies.find((copy) => copy.state === "AVAILABLE");
    if (!availableCopy) return;
    setCopyId(availableCopy.id); setReservationMode("ROOM"); setReservationError("");
    setReservationDate(localDate(new Date(Date.now() + 86_400_000)));
    setKey(crypto.randomUUID()); setReservationDocument(document);
  }
  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (!reservationDocument || sending) return;
    setSending(true); setReservationError("");
    try {
      const result = await api<{ id: string }>("/api/reservations", {
        method: "POST", body: { copyId, date: reservationDate, mode: reservationMode }, idempotencyKey: key,
      });
      setReservationDocument(null); refreshCatalogue();
      notify({ title: "Reserva registrada", message: `La reserva ${result.id} quedó registrada para la fecha indicada.` });
    } catch (reason) { setReservationError(errorMessage(reason)); }
    finally { setSending(false); }
  }
  return <div className="home-screen">
    <Header />
    <aside className="filters"><SearchBox value={filters.q} onChange={(value) => apply({ ...filters, q: value })} /><FilterPanel filters={filters} onApply={apply} /></aside>
    <main className="book-list">
      <p className="results-count" role="status">{busy ? "Cargando catálogo…" : `${data.total} documentos encontrados`}</p>
      <LoadState busy={busy} error={error} empty={!busy && !error && data.items.length === 0} onRetry={retry} />
      {data.items.map((document) => <article className="book-card" key={document.id}>
        <div className="cover-slot"><Cover document={document} /></div>
        <div className="book-copy"><h2>{document.title}</h2>
          <p>{document.description || `${document.author} · ${document.category} · ${document.publisher}`}</p>
          <p className="book-metadata">{typeNames[document.type]} · {mediumNames[document.medium]} · {document.available} disponibles · {document.inRoom} en sala</p>
          <div className="book-actions">
            {session?.role !== "ADMIN" && <button disabled={document.available === 0 && session?.role !== "LIBRARIAN"} onClick={() => request(document)}>
              {session?.role === "LIBRARIAN" ? "Editar documento" : document.available > 0 ? session?.role === "READER" ? "Solicitar" : "Ingresar para solicitar" : "No disponible"}
            </button>}
            {session?.role === "READER" && <button className="secondary-button" disabled={document.available === 0} onClick={() => startReservation(document)}>Reservar fecha</button>}
          </div>
        </div>
      </article>)}
      <Pagination page={page} total={data.total} onChange={setPage} busy={busy} />
    </main>
    {selected && <Dialog title={`Solicitar ${selected.title}`} busy={sending} onCancel={() => select(null)}>
      <form className="request-form" onSubmit={(event) => { void submit(event); }}>
        <label><span>Ejemplar</span><select aria-label="Ejemplar" required value={copyId} disabled={sending} onChange={(event) => { setCopyId(event.target.value); setKey(crypto.randomUUID()); }}>
          {selected.copies.filter((copy) => copy.state === "AVAILABLE").map((copy) => <option key={copy.id} value={copy.id}>{copy.id} · {copy.shelf}</option>)}
        </select></label>
        <label><span>Modalidad</span><select aria-label="Modalidad" value={mode} disabled={sending} onChange={(event) => { setMode(event.target.value); setKey(crypto.randomUUID()); }}>
          <option value="HOME">Domicilio</option><option value="ROOM">Sala</option>
        </select></label>
        <ErrorBox message={requestError} />
        <div className="dialog-actions"><button type="button" disabled={sending} onClick={() => select(null)}>Cancelar</button>
          <button className="dark-button" type="submit" disabled={sending || !copyId}>{sending ? "Registrando…" : "Confirmar solicitud"}</button></div>
      </form>
    </Dialog>}
    {reservationDocument && <Dialog title={`Reservar ${reservationDocument.title}`} busy={sending} onCancel={() => setReservationDocument(null)}>
      <form className="request-form" onSubmit={(event) => { void reserve(event); }}>
        <label><span>Ejemplar</span><select aria-label="Ejemplar para reservar" required value={copyId} disabled={sending} onChange={(event) => { setCopyId(event.target.value); setKey(crypto.randomUUID()); }}>
          {reservationDocument.copies.filter((copy) => copy.state === "AVAILABLE").map((copy) => <option key={copy.id} value={copy.id}>{copy.id} · {copy.shelf}</option>)}
        </select></label>
        <label><span>Fecha</span><input aria-label="Fecha de reserva" type="date" required value={reservationDate} disabled={sending} onChange={(event) => { setReservationDate(event.target.value); setKey(crypto.randomUUID()); }} /></label>
        <label><span>Modalidad</span><select aria-label="Modalidad de reserva" value={reservationMode} disabled={sending} onChange={(event) => { setReservationMode(event.target.value as "HOME" | "ROOM"); setKey(crypto.randomUUID()); }}>
          <option value="ROOM">Sala</option><option value="HOME">Domicilio</option>
        </select></label>
        <ErrorBox message={reservationError} />
        <div className="dialog-actions"><button type="button" disabled={sending} onClick={() => setReservationDocument(null)}>Cancelar</button>
          <button className="dark-button" type="submit" disabled={sending || !copyId}>{sending ? "Reservando…" : "Confirmar reserva"}</button></div>
      </form>
    </Dialog>}
  </div>;
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
