import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, go, type Document, type DocumentInput, type DocumentType, type Medium } from "./api";
import { AdminShell, Cover, Dialog, ErrorBox } from "./components";
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
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    void api<Document>(`/api/catalog/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((document) => { if (!controller.signal.aborted) { setDraft(fromDocument(document)); setOriginalTitle(document.title); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setLoadError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);
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
    const body: DocumentInput = {
      title: draft.title.trim(), author: draft.author.trim(), type, medium: draft.kind === "MULTIMEDIA" ? draft.medium as Medium : "PAPER",
      category: draft.category.trim(), description: draft.description.trim(), stock: Number(draft.stock),
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
              <label>Título<input required minLength={2} maxLength={200} value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="Ingresa el título" /></label>
              <label>Autor<input required minLength={2} maxLength={140} value={draft.author} onChange={(event) => change("author", event.target.value)} placeholder="Ingresa el autor" /></label>
            </div>
            <label htmlFor="document-kind">Tipo de documento</label>
            <select id="document-kind" value={draft.kind} onChange={(event) => changeKind(event.target.value as Kind)}>
              <option value="BOOK">Libro</option><option value="TECHNICAL">Documento técnico</option><option value="MULTIMEDIA">Multimedia</option>
            </select>
            {draft.kind === "MULTIMEDIA" && <div className="form-grid multimedia-fields">
              <label>Tipo de multimedia<select aria-label="Tipo de multimedia" required value={draft.multimedia} onChange={(event) => change("multimedia", event.target.value as Draft["multimedia"])}>
                <option value="" disabled>Selecciona audio o video</option><option value="AUDIO">Audio</option><option value="VIDEO">Video</option>
              </select></label>
              <label>Formato<select aria-label="Formato" required value={draft.medium} onChange={(event) => change("medium", event.target.value as Medium)}>
                <option value="" disabled>Selecciona el formato</option>
                <option value="CD">CD</option><option value="CASSETTE">Casete</option><option value="DVD">DVD</option>
                <option value="BLURAY">Blu-ray</option><option value="DIGITAL">Digital</option>
              </select></label>
            </div>}
            <label>Subcategoría<input required minLength={2} maxLength={80} value={draft.category} onChange={(event) => change("category", event.target.value)} placeholder="Escribe una subcategoría" /></label>
            <label>Descripción<textarea aria-label="Descripción" maxLength={2000} value={draft.description} onChange={(event) => change("description", event.target.value)} placeholder="Añade una descripción" /></label>
            <div className="form-grid">
              <label>Stock<input required type="number" min={0} max={200} step={1} value={draft.stock} onChange={(event) => change("stock", event.target.value)} /></label>
              <label>Editorial<input required minLength={2} maxLength={120} value={draft.publisher} onChange={(event) => change("publisher", event.target.value)} placeholder="Ingresa la editorial" /></label>
            </div>
            <p className="form-hint">Stock = total de ejemplares activos. No se pueden retirar ejemplares prestados, retenidos, reservados o en reposición.</p>
            <div className="form-grid">
              <label>Edición<input required minLength={1} maxLength={40} value={draft.edition} onChange={(event) => change("edition", event.target.value)} /></label>
              <label>Año<input required type="number" min={1450} max={new Date().getFullYear()} step={1} value={draft.year} onChange={(event) => change("year", event.target.value)} /></label>
            </div>
            <label>Ubicación / estante<input required maxLength={40} value={draft.shelf} onChange={(event) => change("shelf", event.target.value)} placeholder="Ej.: A-01" /></label>
            <div className="form-grid">
              <label>Plazo domicilio (días)<input required type="number" min={1} max={30} step={1} value={draft.homeDays} onChange={(event) => change("homeDays", event.target.value)} /></label>
              <label>Plazo sala (horas)<input required type="number" min={1} max={8} step={1} value={draft.roomHours} onChange={(event) => change("roomHours", event.target.value)} /></label>
            </div>
            <ErrorBox message={error} />
            <button className="dark-button" type="submit">{busy ? "Guardando…" : edit ? "Confirmar edición" : "Añadir documento"}</button>
            {edit && <button className="delete-button" type="button" onClick={() => { setDeleteError(""); setConfirmDelete(true); }}>Eliminar de colección</button>}
          </fieldset>
        </form>
      </div>}
    {confirmDelete && <Dialog title="Confirmar eliminación" busy={busy} onCancel={() => setConfirmDelete(false)}>
      <p>¿Deseas eliminar «{originalTitle}» de la colección?</p>
      <p>Se conservará su historial. La operación se rechazará si hay préstamos, retenciones, reposiciones o reservas activas.</p>
      <ErrorBox message={deleteError} />
      <div className="dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button>
        <button type="button" className="danger-button" disabled={busy} onClick={() => { void remove(); }}>{busy ? "Eliminando…" : "Confirmar eliminación"}</button>
      </div>
    </Dialog>}
  </AdminShell>;
}
