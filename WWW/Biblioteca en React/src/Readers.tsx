import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type Page, type Reader, type ReaderInput } from "./api";
import { AdminShell, Dialog, ErrorBox, LoadState, Pagination, Status } from "./components";
import { useApplication } from "./session";

async function photoAsBase64(file?: File) {
  if (!file) throw new Error("Selecciona una fotografía PNG o JPEG para registrar la ficha.");
  if (!(["image/png", "image/jpeg"].includes(file.type)) || file.size > 128_000) {
    throw new Error("La foto debe ser PNG/JPEG y no superar 128 KiB.");
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("No se pudo leer la fotografía."));
    reader.readAsDataURL(file);
  });
}

export function Readers({ id }: { id?: string }) {
  const { notify } = useApplication();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Page<Reader>>({ items: [], total: 0 });
  const [selected, setSelected] = useState<Reader | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const loadReaders = useCallback(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    const params = new URLSearchParams({ page: String(page), size: "10" });
    if (query.trim()) params.set("q", query.trim());
    void api<Page<Reader>>(`/api/readers?${params}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, query, version]);

  useEffect(() => loadReaders(), [loadReaders]);

  const loadDetail = useCallback(() => {
    if (!id) { setSelected(null); return undefined; }
    const controller = new AbortController();
    setDetailError("");
    void api<Reader>(`/api/readers/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((reader) => { if (!controller.signal.aborted) setSelected(reader); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setDetailError(errorMessage(reason)); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => loadDetail(), [loadDetail]);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setFormBusy(true); setFormError("");
    try {
      const body: ReaderInput = {
        rut: String(values.get("rut") ?? "").trim(), names: String(values.get("names") ?? "").trim(),
        surnames: String(values.get("surnames") ?? "").trim(), address: String(values.get("address") ?? "").trim(),
        email: String(values.get("email") ?? "").trim(), telephone: String(values.get("telephone") ?? "").trim(),
        password: String(values.get("password") ?? ""), fingerprint: String(values.get("fingerprint") ?? "").trim(),
        photo: await photoAsBase64((form.elements.namedItem("photo") as HTMLInputElement).files?.[0]),
        documentsChecked: (form.elements.namedItem("documentsChecked") as HTMLInputElement).checked,
      };
      const created = await api<{ id: string; state: string }>("/api/readers", { method: "POST", body });
      form.reset(); setPage(0); setVersion((current) => current + 1);
      notify({ title: "Ficha registrada", message: `La ficha ${created.id} quedó ${created.state === "INACTIVE" ? "pendiente de activación por correo" : "registrada"}.` });
    } catch (reason) { setFormError(errorMessage(reason)); }
    finally { setFormBusy(false); }
  }

  async function updateContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || formBusy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setFormBusy(true); setDetailError("");
    try {
      const photoFile = (form.elements.namedItem("photo") as HTMLInputElement).files?.[0];
      const updated = await api<Reader>(`/api/readers/${encodeURIComponent(selected.id)}`, {
        method: "PUT", body: {
          address: String(values.get("address") ?? "").trim(),
          telephone: String(values.get("telephone") ?? "").trim(),
          photo: photoFile ? await photoAsBase64(photoFile) : selected.photo,
        },
      });
      setSelected(updated); setVersion((current) => current + 1);
      notify({ title: "Ficha actualizada", message: "Los datos de contacto se guardaron correctamente." });
    } catch (reason) { setDetailError(errorMessage(reason)); }
    finally { setFormBusy(false); }
  }

  async function resendActivation() {
    if (!selected || resendBusy) return;
    setResendBusy(true); setDetailError("");
    try {
      const result = await api<{ queued: boolean; expiresInHours: number }>(`/api/readers/${encodeURIComponent(selected.id)}/activation`, { method: "POST", body: {} });
      notify({ title: "Activación reenviada", message: result.queued ? `El enlace anterior se revocó; el nuevo vence en ${result.expiresInHours} horas.` : "No se pudo encolar la activación." });
    } catch (reason) { setDetailError(errorMessage(reason)); }
    finally { setResendBusy(false); }
  }

  return <AdminShell title="Fichas de lectores">
    <p className="notice notice-warning">La API utiliza un adaptador biométrico de laboratorio. No equivale a un lector de huellas físico.</p>
    <section className="screen-section panel">
      <div className="section-heading"><div><span className="eyebrow">Administración</span><h2>Inscribir lector</h2></div></div>
      <form className="screen-form" ref={formRef} onSubmit={(event) => { void register(event); }}>
        <div className="form-grid">
          <label><span>RUN</span><input name="rut" required minLength={9} maxLength={12} placeholder="12345678-5" /></label>
          <label><span>Nombres</span><input name="names" required minLength={2} maxLength={100} /></label>
          <label><span>Apellidos</span><input name="surnames" required minLength={2} maxLength={100} /></label>
          <label><span>Correo</span><input name="email" required type="email" maxLength={160} /></label>
          <label><span>Dirección</span><input name="address" required maxLength={200} /></label>
          <label><span>Teléfono</span><input name="telephone" required minLength={8} maxLength={20} /></label>
          <label><span>Contraseña inicial</span><input name="password" required type="password" minLength={12} maxLength={128} autoComplete="new-password" /></label>
          <label><span>Muestra del adaptador (base64)</span><input name="fingerprint" required minLength={32} maxLength={2048} /></label>
          <label><span>Foto PNG/JPEG, hasta 128 KiB</span><input name="photo" type="file" accept="image/png,image/jpeg" /></label>
        </div>
        <label className="check-control"><input name="documentsChecked" type="checkbox" required /> Confirmo que revisé los documentos de inscripción.</label>
        <ErrorBox message={formError} />
        <button className="dark-button" type="submit" disabled={formBusy}>{formBusy ? "Registrando…" : "Inscribir y solicitar activación"}</button>
      </form>
    </section>

    <section className="screen-section panel">
      <div className="section-heading"><div><span className="eyebrow">Directorio</span><h2>Lectores registrados</h2></div><span className="results-count">{data.total} fichas</span></div>
      <form className="table-tools" onSubmit={(event) => { event.preventDefault(); setPage(0); setVersion((current) => current + 1); }}>
        <SearchInput value={query} onChange={setQuery} />
        <button className="secondary-button" type="submit">Buscar</button>
      </form>
      <LoadState busy={busy} error={error} empty={!busy && !error && data.items.length === 0} onRetry={() => setVersion((current) => current + 1)} />
      {!busy && !error && data.items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Lector</th><th>RUN</th><th>Estado</th><th>Contacto</th><th>Ficha</th></tr></thead>
        <tbody>{data.items.map((reader) => <tr key={reader.id}><td>{reader.names} {reader.surnames}</td><td>{reader.rut}</td><td><Status>{reader.state}</Status></td><td>{reader.email}</td><td><button className="edit-button" onClick={() => { setSelected(reader); window.location.hash = `readers/${encodeURIComponent(reader.id)}`; }}>Ver ficha</button></td></tr>)}</tbody>
      </table></div>}
      <Pagination page={page} total={data.total} busy={busy} onChange={setPage} />
    </section>

    {id && <Dialog title={selected ? `Ficha de ${selected.names} ${selected.surnames}` : "Ficha de lector"} onCancel={() => { setSelected(null); window.location.hash = "readers"; }}>
      {detailError && <ErrorBox message={detailError} />}
      {!selected && !detailError && <p role="status">Cargando ficha…</p>}
      {selected && <>
        {selected.photo && <img className="reader-photo" alt={`Fotografía de ${selected.names} ${selected.surnames}`} src={`data:image/png;base64,${selected.photo}`} />}
        <p className="reader-private-line">{selected.rut} · {selected.email} · <Status>{selected.state}</Status></p>
        <form className="screen-form" onSubmit={(event) => { void updateContact(event); }}>
          <label><span>Dirección</span><input name="address" required maxLength={200} defaultValue={selected.address} /></label>
          <label><span>Teléfono</span><input name="telephone" required minLength={8} maxLength={20} defaultValue={selected.telephone} /></label>
          <label><span>Reemplazar fotografía</span><input name="photo" type="file" accept="image/png,image/jpeg" /></label>
          <p className="muted">RUN, correo y muestra biométrica no se editan desde esta ficha.</p>
          <button className="dark-button" type="submit" disabled={formBusy}>{formBusy ? "Guardando…" : "Actualizar contacto"}</button>
        </form>
        {selected.state === "INACTIVE" && <button className="secondary-button" disabled={resendBusy} onClick={() => { void resendActivation(); }}>{resendBusy ? "Enviando…" : "Reenviar activación"}</button>}
      </>}
    </Dialog>}
  </AdminShell>;
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="search-box"><span className="sr-only">Buscar por nombre o RUN</span><input type="search" value={value} maxLength={100} placeholder="Buscar por nombre o RUN" onChange={(event) => onChange(event.target.value)} /></label>;
}
