import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, go, type Copy, type Document, type DocumentInput, type DocumentType, type Medium } from "./api";
import { AdminShell, Cover, Dialog, ErrorBox, Status } from "./components";
import { useApplication } from "./session";

type Kind = "BOOK" | "TECHNICAL" | "MULTIMEDIA";
interface Draft {
  title: string; author: string; kind: Kind; multimedia: "" | "AUDIO" | "VIDEO"; medium: "" | Medium;
  category: string; description: string; stock: string; publisher: string; edition: string;
  year: string; shelf: string; homeDays: string; roomHours: string;
}
function initialDraft(): Draft {
  return { title: "", author: "", kind: "BOOK", multimedia: "", medium: "PAPER", category: "", description: "",
    stock: "1", publisher: "", edition: "1", year: String(new Date().getFullYear()), shelf: "", homeDays: "7", roomHours: "2" };
}
function fromDocument(document: Document): Draft {
  const multimedia = document.type === "AUDIO" || document.type === "VIDEO";
  return { title: document.title, author: document.author, kind: multimedia ? "MULTIMEDIA" : document.type as Kind,
    multimedia: multimedia ? document.type as "AUDIO" | "VIDEO" : "", medium: document.medium,
    category: document.category, description: document.description ?? "", stock: String(document.total),
    publisher: document.publisher, edition: document.edition, year: String(document.year), shelf: document.shelf,
    homeDays: String(document.homeDays), roomHours: String(document.roomHours) };
}
export function DocumentForm({ id }: { id?: string }) {
  const edit = Boolean(id);
  const { notify, refreshCatalogue } = useApplication();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loading, setLoading] = useState(edit);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [originalTitle, setOriginalTitle] = useState("");
  const [copies, setCopies] = useState<Copy[]>([]);
  const [detailVersion, setDetailVersion] = useState(0);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [retireCopy, setRetireCopy] = useState<Copy | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    void api<Document>(`/api/catalog/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((document) => { if (!controller.signal.aborted) { setDraft(fromDocument(document)); setOriginalTitle(document.title); setCopies(document.copies ?? []); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setLoadError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, detailVersion]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((old) => ({ ...old, [key]: value })); }
  function changeKind(kind: Kind) {
    setDraft((old) => ({ ...old, kind,
      multimedia: kind === "MULTIMEDIA" ? old.multimedia : "",
      medium: kind === "MULTIMEDIA" ? old.medium === "PAPER" ? "" : old.medium : "PAPER" }));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (draft.kind === "MULTIMEDIA" && (!draft.multimedia || !draft.medium || draft.medium === "PAPER")) {
      setError("Selecciona el tipo de multimedia y su formato."); return;
    }
    const type: DocumentType = draft.kind === "MULTIMEDIA" ? draft.multimedia as "AUDIO" | "VIDEO" : draft.kind;
    const description = String(new FormData(event.currentTarget).get("description") ?? draft.description);
    const body: DocumentInput = {
      title: draft.title.trim(), author: draft.author.trim(), type, medium: draft.kind === "MULTIMEDIA" ? draft.medium as Medium : "PAPER",
      category: draft.category.trim(), description: description.trim(), stock: Number(draft.stock),
      publisher: draft.publisher.trim(), edition: draft.edition.trim(), year: Number(draft.year), shelf: draft.shelf.trim(),
      homeDays: Number(draft.homeDays), roomHours: Number(draft.roomHours),
    };
    setBusy(true); setError("");
    try {
      const result = await api<Document>(edit ? `/api/documents/${encodeURIComponent(id!)}` : "/api/documents", { method: edit ? "PUT" : "POST", body });
      refreshCatalogue();
      notify({ title: edit ? "Documento actualizado" : "Documento añadido",
        message: `«${result.title}» se ${edit ? "actualizó" : "añadió"} correctamente en la colección.`,
        afterClose: () => go("collections") });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!id || busy) return;
    setBusy(true); setDeleteError("");
    try {
      await api(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      setConfirmDelete(false); refreshCatalogue();
      notify({ title: "Documento eliminado", message: `«${originalTitle}» se eliminó de la colección activa. Su historial se conserva.`,
        afterClose: () => go("collections") });
    } catch (reason) { setDeleteError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  async function addCopy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || copyBusy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setCopyBusy(true); setCopyError("");
    try {
      await api(`/api/documents/${encodeURIComponent(id)}/copies`, { method: "POST", body: { code: String(values.get("code")).trim(), shelf: String(values.get("shelf")).trim() } });
      form.reset(); setDetailVersion((current) => current + 1); refreshCatalogue();
      notify({ title: "Ejemplar incorporado", message: "El nuevo ejemplar quedó registrado en la colección." });
    } catch (reason) { setCopyError(errorMessage(reason)); }
    finally { setCopyBusy(false); }
  }
  async function moveCopy(copy: Copy, shelf: string) {
    if (copyBusy) return;
    setCopyBusy(true); setCopyError("");
    try {
      await api(`/api/copies/${encodeURIComponent(copy.id)}`, { method: "PUT", body: { shelf: shelf.trim() } });
      setDetailVersion((current) => current + 1); refreshCatalogue();
      notify({ title: "Ubicación actualizada", message: `Se actualizó la ubicación del ejemplar ${copy.id}.` });
    } catch (reason) { setCopyError(errorMessage(reason)); }
    finally { setCopyBusy(false); }
  }
  async function removeCopy() {
    if (!retireCopy || copyBusy) return;
    setCopyBusy(true); setCopyError("");
    try {
      await api(`/api/copies/${encodeURIComponent(retireCopy.id)}`, { method: "DELETE" });
      const code = retireCopy.id; setRetireCopy(null); setDetailVersion((current) => current + 1); refreshCatalogue();
      notify({ title: "Ejemplar retirado", message: `El ejemplar ${code} fue retirado de la colección.` });
    } catch (reason) { setCopyError(errorMessage(reason)); }
    finally { setCopyBusy(false); }
  }
  const coverType: DocumentType = draft.kind === "MULTIMEDIA" ? draft.multimedia || "VIDEO" : draft.kind;
  return <AdminShell title={edit ? "Editar documento" : "Añadir documento"}>
    <button className="back-button" disabled={busy} onClick={() => go("collections")}>Volver</button>
    {loading ? <p role="status">Cargando documento…</p> : loadError ? <ErrorBox message={loadError} /> :
      <div className="document-layout">
        <div className="document-cover"><Cover document={{ title: draft.title, type: coverType }} /></div>
        <form className="document-form" onSubmit={(event) => { void save(event); }}>
          <h2>{edit ? "Editar documento" : "Añadir documento"}</h2>
          <p>Completa la información del libro o material multimedia.</p>
          <fieldset disabled={busy}>
            <legend className="sr-only">Información del documento</legend>
            <div className="form-grid">
              <label><span>Título</span><input required minLength={2} maxLength={200} value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="Ingresa el título" /></label>
              <label><span>Autor</span><input required minLength={2} maxLength={140} value={draft.author} onChange={(event) => change("author", event.target.value)} placeholder="Ingresa el autor" /></label>
            </div>
            <label htmlFor="document-kind"><span>Tipo de documento</span></label>
            <select id="document-kind" value={draft.kind} onChange={(event) => changeKind(event.target.value as Kind)}>
              <option value="BOOK">Libro</option><option value="TECHNICAL">Documento técnico</option><option value="MULTIMEDIA">Multimedia</option>
            </select>
            {draft.kind === "MULTIMEDIA" && <div className="form-grid multimedia-fields">
              <label><span>Tipo de multimedia</span><select aria-label="Tipo de multimedia" required value={draft.multimedia} onChange={(event) => change("multimedia", event.target.value as Draft["multimedia"])}>
                <option value="" disabled>Selecciona audio o video</option><option value="AUDIO">Audio</option><option value="VIDEO">Video</option>
              </select></label>
              <label><span>Formato</span><select aria-label="Formato" required value={draft.medium} onChange={(event) => change("medium", event.target.value as Medium)}>
                <option value="" disabled>Selecciona el formato</option>
                <option value="CD">CD</option><option value="CASSETTE">Casete</option><option value="DVD">DVD</option>
                <option value="BLURAY">Blu-ray</option><option value="DIGITAL">Digital</option>
              </select></label>
            </div>}
            <label><span>Subcategoría</span><input required minLength={2} maxLength={80} value={draft.category} onChange={(event) => change("category", event.target.value)} placeholder="Escribe una subcategoría" /></label>
            <label><span>Descripción</span><textarea name="description" aria-label="Descripción" maxLength={2000} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="Añade una descripción" /></label>
            <div className="form-grid">
              <label><span>Stock</span><input required type="number" min={0} max={200} step={1} value={draft.stock} onChange={(event) => change("stock", event.target.value)} /></label>
              <label><span>Editorial</span><input required minLength={2} maxLength={120} value={draft.publisher} onChange={(event) => change("publisher", event.target.value)} placeholder="Ingresa la editorial" /></label>
            </div>
            <p className="form-hint">Stock = total de ejemplares activos. No se pueden retirar ejemplares prestados, retenidos, reservados o en reposición.</p>
            <div className="form-grid">
              <label><span>Edición</span><input required minLength={1} maxLength={40} value={draft.edition} onChange={(event) => change("edition", event.target.value)} /></label>
              <label><span>Año</span><input required type="number" min={1450} max={new Date().getFullYear()} step={1} value={draft.year} onChange={(event) => change("year", event.target.value)} /></label>
            </div>
            <label><span>Ubicación / estante</span><input required maxLength={40} value={draft.shelf} onChange={(event) => change("shelf", event.target.value)} placeholder="Ej.: A-01" /></label>
            <div className="form-grid">
              <label><span>Plazo domicilio (días)</span><input required type="number" min={1} max={30} step={1} value={draft.homeDays} onChange={(event) => change("homeDays", event.target.value)} /></label>
              <label><span>Plazo sala (horas)</span><input required type="number" min={1} max={8} step={1} value={draft.roomHours} onChange={(event) => change("roomHours", event.target.value)} /></label>
            </div>
            <ErrorBox message={error} />
            <button className="dark-button" type="submit">{busy ? "Guardando…" : edit ? "Confirmar edición" : "Añadir documento"}</button>
            {edit && <button className="delete-button" type="button" onClick={() => { setDeleteError(""); setConfirmDelete(true); }}>Eliminar de colección</button>}
          </fieldset>
        </form>
      </div>}
    {edit && !loading && !loadError && <section className="screen-section panel copies-panel">
      <div className="section-heading"><div><span className="eyebrow">P04 · Ejemplares</span><h2>Existencias y ubicaciones</h2></div><span className="results-count">{copies.length} ejemplares</span></div>
      <p className="muted">Los ejemplares prestados, retenidos o en reposición no se pueden retirar. El backend aplica estas reglas al guardar.</p>
      <form className="table-tools copy-add-form" onSubmit={(event) => { void addCopy(event); }}>
        <label><span>Código del ejemplar</span><input name="code" required minLength={3} maxLength={40} pattern="[A-Z0-9-]{3,40}" placeholder="BEC-0001-3" /></label>
        <label><span>Ubicación</span><input name="shelf" required maxLength={40} placeholder="A-01" /></label>
        <button className="dark-button" type="submit" disabled={copyBusy}>{copyBusy ? "Guardando…" : "Añadir ejemplar"}</button>
      </form>
      <ErrorBox message={copyError} />
      {copies.length === 0 ? <p className="service-state service-empty" role="status">El documento aún no tiene ejemplares.</p> : <div className="table-wrap"><table><thead><tr><th>Código</th><th>Estado</th><th>Disponible desde</th><th>Ubicación nueva</th><th>Acciones</th></tr></thead>
        <tbody>{copies.map((copy) => <CopyRow key={`${copy.id}:${copy.shelf}`} copy={copy} busy={copyBusy} onMove={moveCopy} onRetire={setRetireCopy} />)}</tbody>
      </table></div>}
    </section>}
    {confirmDelete && <Dialog title="Confirmar eliminación" busy={busy} onCancel={() => setConfirmDelete(false)}>
      <p>¿Deseas eliminar «{originalTitle}» de la colección?</p>
      <p>Se conservará su historial. La operación se rechazará si hay préstamos, retenciones, reposiciones o reservas activas.</p>
      <ErrorBox message={deleteError} />
      <div className="dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button>
        <button type="button" className="danger-button" disabled={busy} onClick={() => { void remove(); }}>{busy ? "Eliminando…" : "Confirmar eliminación"}</button>
      </div>
    </Dialog>}
    {retireCopy && <Dialog title="Retirar ejemplar" busy={copyBusy} onCancel={() => setRetireCopy(null)}>
      <p>¿Confirmas el retiro del ejemplar {retireCopy.id}?</p><p>El servidor rechazará la operación si el ejemplar tiene un préstamo, retención o reposición activa.</p><ErrorBox message={copyError} />
      <div className="dialog-actions"><button type="button" disabled={copyBusy} onClick={() => setRetireCopy(null)}>Cancelar</button><button className="danger-button" type="button" disabled={copyBusy || retireCopy.state !== "AVAILABLE"} onClick={() => { void removeCopy(); }}>{copyBusy ? "Retirando…" : "Confirmar retiro"}</button></div>
    </Dialog>}
  </AdminShell>;
}

function CopyRow({ copy, busy, onMove, onRetire }: { copy: Copy; busy: boolean; onMove: (copy: Copy, shelf: string) => Promise<void>; onRetire: (copy: Copy) => void }) {
  const [shelf, setShelf] = useState(copy.shelf);
  return <tr><td>{copy.id}</td><td><Status>{copy.state}</Status></td><td>{copy.readyAt ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(copy.readyAt)) : "—"}</td>
    <td><input aria-label={`Nueva ubicación ${copy.id}`} value={shelf} maxLength={40} onChange={(event) => setShelf(event.target.value)} /></td>
    <td className="row-actions"><button className="secondary-button" disabled={busy || shelf.trim() === copy.shelf || !shelf.trim()} onClick={() => { void onMove(copy, shelf); }}>Guardar ubicación</button><button className="text-button danger-text" disabled={busy || copy.state !== "AVAILABLE"} onClick={() => onRetire(copy)}>Retirar</button></td>
  </tr>;
}
