import { useState, type FormEvent } from "react";
import { api, errorMessage, type ExitCheck, type ReturnResult } from "./api";
import { AdminShell, ErrorBox, Status } from "./components";
import { useApplication } from "./session";

function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));
}

export function Returns() {
  const { notify } = useApplication();
  const [copyId, setCopyId] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [checkId, setCheckId] = useState("");
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [exit, setExit] = useState<ExitCheck | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const returned = await api<ReturnResult>("/api/returns", { method: "POST", body: { copyId: copyId.trim() }, idempotencyKey: key });
      setResult(returned); setCopyId(""); setKey(crypto.randomUUID());
      notify({ title: "Devolución registrada", message: `El ejemplar quedará disponible desde ${dateTime(returned.readyAt)}.` });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function checkExit(event: FormEvent) {
    event.preventDefault();
    if (checkBusy) return;
    setCheckBusy(true); setCheckError(""); setExit(null);
    try { setExit(await api<ExitCheck>(`/api/exit-check/${encodeURIComponent(checkId.trim())}`)); }
    catch (reason) { setCheckError(errorMessage(reason)); }
    finally { setCheckBusy(false); }
  }

  return <AdminShell title="Devoluciones y control de salida">
    <section className="workflow-layout circulation-layout">
      <section className="workflow-summary"><span className="eyebrow">P07 · Circulación</span><h2>Registrar devolución</h2>
        <p>Introduce el código del ejemplar. La fecha de devolución, el atraso y la sanción los determina el servidor.</p>
        <div className="workflow-callout">El ejemplar queda en reposición hasta la hora indicada por la respuesta del API.</div>
      </section>
      <section className="workflow-form panel">
        <h2>Recibir ejemplar</h2>
        <form className="screen-form" onSubmit={(event) => { void submit(event); }}>
          <label><span>Código del ejemplar</span><input required maxLength={40} value={copyId} disabled={busy} onChange={(event) => setCopyId(event.target.value)} /></label>
          <ErrorBox message={error} />
          <button className="dark-button" type="submit" disabled={busy}>{busy ? "Registrando…" : "Registrar devolución"}</button>
        </form>
        {result && <section className="operation-result" aria-live="polite">
          <Status>{result.state}</Status><h3>{result.copyId} · devolución registrada</h3>
          <dl className="result-grid"><div><dt>Recibido</dt><dd>{dateTime(result.returnedAt)}</dd></div><div><dt>Disponible desde</dt><dd>{dateTime(result.readyAt)}</dd></div></dl>
          {result.late && <p className="notice notice-warning">El servidor aplicó una sanción temporal hasta {dateTime(result.sanctionUntil)}. No se realiza un cobro.</p>}
        </section>}
      </section>
    </section>

    <section className="screen-section panel exit-check-panel">
      <div><span className="eyebrow">Adaptador de software</span><h2>Consultar salida autorizada</h2><p className="muted">Esta consulta simula el control de salida; no opera una antena RFID física.</p></div>
      <form className="table-tools" onSubmit={(event) => { void checkExit(event); }}>
        <label className="search-box"><span className="sr-only">Código de ejemplar</span><input required maxLength={40} value={checkId} onChange={(event) => setCheckId(event.target.value)} placeholder="Código del ejemplar" /></label>
        <button className="secondary-button" type="submit" disabled={checkBusy}>{checkBusy ? "Consultando…" : "Consultar"}</button>
      </form>
      <ErrorBox message={checkError} />
      {exit && <p className={`exit-result ${exit.allowExit ? "exit-result-allowed" : "exit-result-denied"}`} role="status">
        {exit.allowExit ? `Salida permitida para ${exit.copyId}: préstamo HOME confirmado.` : `Salida denegada para ${exit.copyId}: no hay préstamo HOME confirmado.`}
        <small>{exit.adapter}</small>
      </p>}
    </section>
  </AdminShell>;
}

export function Overdue() {
  const [mode, setMode] = useState<"HOME" | "ROOM">("HOME");
  const [rows, setRows] = useState<{ readerId: string; copyId: string; title: string; dueAt: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api<{ items: typeof rows; total: number }>(`/api/overdue?size=20&mode=${mode}`);
      setRows(result.items); setTotal(result.total);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  return <AdminShell title="Administración de morosidad">
    <section className="screen-section panel">
      <div className="section-heading"><div><span className="eyebrow">P08 · Administración</span><h2>Consultar ejemplares atrasados</h2></div><span className="results-count">{total} resultados</span></div>
      <form className="table-tools" onSubmit={(event) => { void load(event); }}>
        <label><span>Modalidad</span><select value={mode} onChange={(event) => setMode(event.target.value as "HOME" | "ROOM")}><option value="HOME">Domicilio</option><option value="ROOM">Sala</option></select></label>
        <button className="dark-button" type="submit" disabled={busy}>{busy ? "Consultando…" : "Consultar morosidad"}</button>
      </form>
      <ErrorBox message={error} />
      {rows.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Lector</th><th>Ejemplar</th><th>Título</th><th>Vencimiento</th><th>Ficha</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.readerId}-${row.copyId}`}><td>{row.readerId}</td><td>{row.copyId}</td><td>{row.title}</td><td>{dateTime(row.dueAt)}</td><td><button className="text-button" onClick={() => { window.location.hash = `readers/${encodeURIComponent(row.readerId)}`; }}>Consultar ficha</button></td></tr>)}</tbody>
      </table></div> : !busy && !error && <p className="service-state service-empty" role="status">No hay ejemplares atrasados en esta modalidad.</p>}
      <p className="muted">{mode === "HOME" ? "El proceso de recordatorios de domicilio depende del proveedor configurado. La interfaz no envía correos." : "Para préstamos en sala, contacte presencialmente al lector para coordinar la devolución."}</p>
    </section>
  </AdminShell>;
}
