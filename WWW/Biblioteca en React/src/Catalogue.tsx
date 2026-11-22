import { useEffect, useState, type FormEvent } from "react";
import { api, catalogueUrl, emptyFilters, errorMessage, go, mediumNames, statusName, typeNames,
  type Document, type Filters, type Page } from "./api";
import { AdminShell, Cover, Dialog, ErrorBox, Header, Pagination, SearchBox, Status } from "./components";
import { useApplication } from "./session";

function useCatalogue(filters: Filters, page: number) {
  const { revision } = useApplication();
  const [data, setData] = useState<Page<Document>>({ items: [], total: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
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
  }, [url, revision]);
  return { data, busy, error };
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
      <label>Título<input value={draft.title} maxLength={100} onChange={(event) => change("title", event.target.value)} placeholder="Todos los títulos" /></label>
      <label>Autor<input value={draft.author} maxLength={100} onChange={(event) => change("author", event.target.value)} placeholder="Todos los autores" /></label>
      <label>Tipo de documento<select aria-label="Tipo de documento" value={draft.type} onChange={(event) => change("type", event.target.value)}>
        <option value="">Todos los tipos</option><option value="BOOK">Libro</option>
        <option value="TECHNICAL">Documento técnico</option><option value="MULTIMEDIA">Multimedia (audio/video)</option>
        <option value="AUDIO">Multimedia · Audio</option><option value="VIDEO">Multimedia · Video</option>
      </select></label>
      <label>Editorial<input value={draft.publisher} maxLength={100} onChange={(event) => change("publisher", event.target.value)} placeholder="Todas las editoriales" /></label>
      <label>Disponibilidad<select aria-label="Disponibilidad" value={draft.availability} onChange={(event) => change("availability", event.target.value)}>
        <option value="">Cualquier disponibilidad</option><option value="AVAILABLE">Disponible</option>
        <option value="UNAVAILABLE">No disponible</option><option value="IN_ROOM">Con ejemplares en sala</option>
      </select></label>
      <label>Subcategoría<input value={draft.subcategory} maxLength={100} onChange={(event) => change("subcategory", event.target.value)} placeholder="Todas las subcategorías" /></label>
    </div>
    <div className="filter-actions"><button type="submit" className="dark-button">Aplicar filtros</button>
      <button type="button" onClick={() => { setDraft({ ...emptyFilters }); onApply({ ...emptyFilters }); }}>Limpiar filtros</button></div>
    <p className="filter-hint">Los filtros se combinan y se aplican a toda la colección. Disponible = al menos un ejemplar libre.</p>
  </form>;
}
export function Collections() {
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [page, setPage] = useState(0);
  const { data, busy, error } = useCatalogue(filters, page);
  function apply(value: Filters) { setFilters(value); setPage(0); }
  return <AdminShell title="Colecciones">
    <div className="table-tools">
      <SearchBox value={filters.q} onChange={(value) => apply({ ...filters, q: value })} />
      <button className="add-button" onClick={() => go("add")}><img src="/assets/84c1a.svg" alt="" />Añadir documento</button>
    </div>
    <FilterPanel filters={filters} onApply={apply} />
    <ErrorBox message={error} />
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
          {!busy && !error && data.items.length === 0 && <tr><td colSpan={8}>No hay documentos que coincidan con los filtros.</td></tr>}
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
  const { data, busy, error } = useCatalogue(filters, page);
  const [selected, select] = useState<Document | null>(null);
  const [copyId, setCopyId] = useState("");
  const [mode, setMode] = useState("HOME");
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState("");
  function apply(value: Filters) { setFilters(value); setPage(0); }
  function request(document: Document) {
    if (!session) { go("login"); return; }
    if (session.role !== "READER") { go("edit", document.id); return; }
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
  return <div className="home-screen">
    <Header />
    <aside className="filters"><SearchBox value={filters.q} onChange={(value) => apply({ ...filters, q: value })} /><FilterPanel filters={filters} onApply={apply} /></aside>
    <main className="book-list">
      <ErrorBox message={error} /><p className="results-count" role="status">{busy ? "Cargando catálogo…" : `${data.total} documentos encontrados`}</p>
      {data.items.map((document) => <article className="book-card" key={document.id}>
        <div className="cover-slot"><Cover document={document} /></div>
        <div className="book-copy"><h2>{document.title}</h2>
          <p>{document.description || `${document.author} · ${document.category} · ${document.publisher}`}</p>
          <p className="book-metadata">{typeNames[document.type]} · {mediumNames[document.medium]} · {document.available} disponibles · {document.inRoom} en sala</p>
          <button disabled={document.available === 0 && session?.role !== "LIBRARIAN"} onClick={() => request(document)}>
            {session?.role === "LIBRARIAN" ? "Editar documento" : document.available > 0 ? "Solicitar" : "No disponible"}
          </button>
        </div>
      </article>)}
      {!busy && !error && data.items.length === 0 && <p>No hay documentos que coincidan con los filtros.</p>}
      <Pagination page={page} total={data.total} onChange={setPage} busy={busy} />
    </main>
    {selected && <Dialog title={`Solicitar ${selected.title}`} busy={sending} onCancel={() => select(null)}>
      <form className="request-form" onSubmit={(event) => { void submit(event); }}>
        <label>Ejemplar<select aria-label="Ejemplar" required value={copyId} disabled={sending} onChange={(event) => { setCopyId(event.target.value); setKey(crypto.randomUUID()); }}>
          {selected.copies.filter((copy) => copy.state === "AVAILABLE").map((copy) => <option key={copy.id} value={copy.id}>{copy.id} · {copy.shelf}</option>)}
        </select></label>
        <label>Modalidad<select aria-label="Modalidad" value={mode} disabled={sending} onChange={(event) => { setMode(event.target.value); setKey(crypto.randomUUID()); }}>
          <option value="HOME">Domicilio</option><option value="ROOM">Sala</option>
        </select></label>
        <ErrorBox message={requestError} />
        <div className="dialog-actions"><button type="button" disabled={sending} onClick={() => select(null)}>Cancelar</button>
          <button className="dark-button" type="submit" disabled={sending || !copyId}>{sending ? "Registrando…" : "Confirmar solicitud"}</button></div>
      </form>
    </Dialog>}
  </div>;
}
