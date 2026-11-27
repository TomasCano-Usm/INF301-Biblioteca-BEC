import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, go, type Loan, type LoanRequest, type Page, type Reader, type Reservation } from "./api";
import { AdminShell, Dialog, ErrorBox, LoadState, Pagination, Status } from "./components";
import { useApplication } from "./session";

function dateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));
}

export function RequestsQueue({ selectedId }: { selectedId?: string }) {
  const { notify } = useApplication();
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [requests, setRequests] = useState<Page<LoanRequest>>({ items: [], total: 0 });
  const [reservations, setReservations] = useState<Page<Reservation>>({ items: [], total: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<LoanRequest | null>(null);
  const [reader, setReader] = useState<Reader | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [readerError, setReaderError] = useState("");
  const [run, setRun] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [cancelRequest, setCancelRequest] = useState<LoanRequest | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    void Promise.all([
      api<Page<LoanRequest>>(`/api/requests?page=${page}&size=10`, { signal: controller.signal }),
      api<Page<Reservation>>("/api/reservations?page=0&size=20", { signal: controller.signal }),
    ]).then(([requestPage, reservationPage]) => {
      if (!controller.signal.aborted) { setRequests(requestPage); setReservations(reservationPage); }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, version]);
  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!selectedId || !requests.items.length) return;
    const request = requests.items.find((item) => item.id === selectedId);
    if (request) void openIssue(request);
  // Only auto-open the request once the current page has loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, requests.items]);

  async function openIssue(request: LoanRequest) {
    setSelected(request); setReader(null); setReaderError(""); setIssueError(""); setRun(""); setFingerprint("");
    setReaderBusy(true);
    try { setReader(await api<Reader>(`/api/readers/${encodeURIComponent(request.ownerId)}`)); }
    catch (reason) { setReaderError(errorMessage(reason)); }
    finally { setReaderBusy(false); }
  }

  async function issue(event: FormEvent) {
    event.preventDefault();
    if (!selected || issueBusy) return;
    setIssueBusy(true); setIssueError("");
    try {
      const result = await api<Loan>(`/api/requests/${encodeURIComponent(selected.id)}/issue`, {
        method: "POST", body: { rut: run.trim(), fingerprint: fingerprint.trim() },
      });
      setSelected(null); setReader(null); setVersion((current) => current + 1);
      notify({ title: "Entrega procesada", message: `La operación quedó en estado ${result.state}. Los plazos fueron calculados por el servidor.` });
      if (result.mode === "HOME" && result.id) go("receipt", result.id);
      else go("requests");
    } catch (reason) { setIssueError(errorMessage(reason)); }
    finally { setIssueBusy(false); }
  }

  async function cancel() {
    if (!cancelRequest || cancelBusy) return;
    setCancelBusy(true);
    try {
      await api(`/api/requests/${encodeURIComponent(cancelRequest.id)}`, { method: "DELETE" });
      setCancelRequest(null); setVersion((current) => current + 1);
      notify({ title: "Solicitud cancelada", message: "La solicitud pendiente fue cancelada por el bibliotecario." });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setCancelBusy(false); }
  }

  async function cancelReservation(reservation: Reservation) {
    try {
      await api(`/api/reservations/${encodeURIComponent(reservation.id)}`, { method: "DELETE" });
      setVersion((current) => current + 1);
      notify({ title: "Reserva cancelada", message: `La reserva de ${reservation.copyId} fue cancelada.` });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <AdminShell title="Preparar y entregar">
    <section className="workflow-banner"><div><span className="eyebrow">Atención en mesón</span><h2>Cola de solicitudes</h2><p>Selecciona una solicitud pendiente. El servidor valida identidad, elegibilidad y plazos al confirmar la entrega.</p></div><button className="secondary-button" onClick={() => setVersion((current) => current + 1)}>Actualizar</button></section>
    <LoadState busy={busy} error={error} empty={!busy && !error && requests.items.length === 0} onRetry={() => setVersion((current) => current + 1)} />
    {!busy && requests.items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Solicitud / lector</th><th>Material y ubicación</th><th>Modalidad</th><th>Estado</th><th>Retención</th><th>Acción</th></tr></thead>
      <tbody>{requests.items.map((request) => <tr key={request.id}>
        <td><strong>{request.id}</strong><small>{request.ownerId}</small></td>
        <td>{request.items?.map((item) => <span className="stacked-value" key={item.copyId}><strong>{item.copyId}</strong> · {item.title}<small>{item.shelf}</small></span>) ?? request.copyIds?.join(", ")}</td>
        <td>{request.mode === "HOME" ? "Domicilio" : "Sala"}</td><td><Status>{request.state}</Status></td><td>{dateTime(request.expiresAt)}</td>
        <td className="row-actions">{request.state === "PENDING" ? <><button className="edit-button" onClick={() => { void openIssue(request); }}>Verificar y entregar</button><button className="text-button danger-text" onClick={() => setCancelRequest(request)}>Cancelar</button></> : <span className="muted">Procesamiento en curso</span>}</td>
      </tr>)}</tbody>
    </table></div>}
    <Pagination page={page} total={requests.total} onChange={setPage} busy={busy} />

    <section className="screen-section panel">
      <div className="section-heading"><div><span className="eyebrow">P06</span><h2>Reservas próximas</h2></div><span className="results-count">{reservations.total} reservas</span></div>
      {reservations.items.length === 0 ? <LoadState busy={false} empty /> : <div className="table-wrap"><table><thead><tr><th>Reserva</th><th>Lector</th><th>Ejemplar</th><th>Fecha</th><th>Estado</th><th>Acción</th></tr></thead>
        <tbody>{reservations.items.map((reservation) => <tr key={reservation.id}><td>{reservation.id}</td><td>{reservation.ownerId}</td><td>{reservation.copyId}</td><td>{reservation.date}</td><td><Status>{reservation.state}</Status></td><td>{reservation.state === "ACTIVE" ? <button className="text-button danger-text" onClick={() => { void cancelReservation(reservation); }}>Cancelar reserva</button> : "—"}</td></tr>)}</tbody>
      </table></div>}
    </section>

    {selected && <Dialog title="Verificar y confirmar entrega" busy={issueBusy || readerBusy} onCancel={() => setSelected(null)}>
      <div className="workflow-summary compact-summary"><span className="eyebrow">Solicitud {selected.id}</span><h3>{reader ? `${reader.names} ${reader.surnames}` : selected.ownerId}</h3>
        <p>{selected.items?.map((item) => `${item.copyId} · ${item.title} · ${item.shelf}`).join(" / ")}</p>
        <p>Modalidad: {selected.mode === "HOME" ? "Domicilio" : "Sala"} · retención hasta {dateTime(selected.expiresAt)}</p>
        {reader?.photo && <img className="reader-photo" alt="Fotografía registrada del lector" src={`data:image/png;base64,${reader.photo}`} />}
      </div>
      {readerBusy && <p role="status">Consultando ficha permitida para bibliotecario…</p>}
      {readerError && <ErrorBox message={readerError} />}
      {reader && <>
        <p className="notice notice-warning">La validación biométrica disponible corresponde al adaptador de laboratorio; no es un lector físico homologado.</p>
        <form className="screen-form" onSubmit={(event) => { void issue(event); }}>
          <label><span>RUN presentado</span><input required maxLength={12} value={run} onChange={(event) => setRun(event.target.value)} /></label>
          <label><span>Muestra del adaptador biométrico (base64)</span><textarea required minLength={32} maxLength={2048} value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} /></label>
          <ErrorBox message={issueError} />
          <div className="dialog-actions"><button className="dark-button" type="submit" disabled={issueBusy}>{issueBusy ? "Verificando…" : "Verificar y confirmar entrega"}</button></div>
        </form>
      </>}
    </Dialog>}
    {cancelRequest && <Dialog title="Cancelar solicitud pendiente" busy={cancelBusy} onCancel={() => setCancelRequest(null)}>
      <p>¿Confirmas la cancelación de {cancelRequest.id}? La operación libera la retención según las reglas del servidor.</p>
      <div className="dialog-actions"><button type="button" disabled={cancelBusy} onClick={() => setCancelRequest(null)}>Volver</button><button className="danger-button" type="button" disabled={cancelBusy} onClick={() => { void cancel(); }}>{cancelBusy ? "Cancelando…" : "Confirmar cancelación"}</button></div>
    </Dialog>}
  </AdminShell>;
}
