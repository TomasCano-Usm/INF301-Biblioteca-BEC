import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, go, type Account as AccountData, type GraphQLResponse, type LoanRequest, type Page, type Reservation } from "./api";
import { AdminShell, Dialog, ErrorBox, LoadState, Pagination, Status } from "./components";
import { useApplication } from "./session";

const ACCOUNT_QUERY = "query CuentaPersonal($page:Int!){account(first:10,page:$page){reader{id names surnames state email} totalLoans page hasMore sanctionUntil loans{id mode state issuedAt items{copyId title dueAt state returnedAt readyAt document{id author category}} assessment{amount currency state}} reservations{id copyId date mode state}}}";

function dateTime(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));
}

export function Account() {
  const { notify } = useApplication();
  const [page, setPage] = useState(0);
  const [version, setVersion] = useState(0);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [requests, setRequests] = useState<Page<LoanRequest>>({ items: [], total: 0 });
  const [policy, setPolicy] = useState<{ amount: number; currency: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [action, setAction] = useState<{ kind: "request" | "reservation"; id: string; label: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(() => {
    const controller = new AbortController();
    setBusy(true); setError(""); setPartialErrors([]);
    void Promise.all([
      api<GraphQLResponse<{ account: AccountData }>>("/api/graphql", {
        method: "POST", body: { query: ACCOUNT_QUERY, variables: { page } }, signal: controller.signal,
      }),
      api<Page<LoanRequest>>("/api/requests?page=0&size=20", { signal: controller.signal }),
      api<{ amount: number; currency: string }>("/api/payments/policy", { signal: controller.signal }),
    ]).then(([result, requestPage, paymentPolicy]) => {
      if (controller.signal.aborted) return;
      if (!result.data?.account) throw new Error(result.errors?.map((item) => item.message).join(" · ") || "El resumen de cuenta no está disponible.");
      setAccount(result.data.account); setRequests(requestPage); setPolicy(paymentPolicy);
      setPartialErrors(result.errors?.map((item) => item.message) ?? []);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page, version]);

  useEffect(() => load(), [load]);

  async function confirmAction() {
    if (!action || actionBusy) return;
    setActionBusy(true); setActionError("");
    try {
      if (action.kind === "request") await api(`/api/requests/${encodeURIComponent(action.id)}`, { method: "DELETE" });
      else await api(`/api/reservations/${encodeURIComponent(action.id)}`, { method: "DELETE" });
      setAction(null); setVersion((current) => current + 1);
      notify({ title: "Operación completada", message: action.kind === "request" ? "La solicitud fue cancelada." : "La reserva fue cancelada." });
    } catch (reason) { setActionError(errorMessage(reason)); }
    finally { setActionBusy(false); }
  }

  return <AdminShell title="Mi cuenta">
    <LoadState busy={busy} error={error} onRetry={() => setVersion((current) => current + 1)} />
    {!busy && !error && account && <>
      <section className="account-summary panel">
        <span className="eyebrow">Resumen personal</span>
        <h2>{account.reader.names} {account.reader.surnames}</h2>
        <p>{account.reader.email}</p>
        <div className="account-stats">
          <div><strong>{account.totalLoans}</strong><span>Préstamos registrados</span></div>
          <div><strong>{policy ? `$${policy.amount.toLocaleString("es-CL")}` : "—"}</strong><span>{policy?.currency ?? "CLP"} · biblioteca gratuita</span></div>
        </div>
        {account.sanctionUntil && new Date(account.sanctionUntil) > new Date() && <p className="notice notice-warning">No puedes solicitar hasta {dateTime(account.sanctionUntil)}. El sistema aplica una sanción temporal, no un cobro.</p>}
        {partialErrors.length > 0 && <p className="notice notice-warning" role="status">Resumen parcial: {partialErrors.join(" · ")}</p>}
      </section>
      <section className="account-section">
        <div className="section-heading"><h2>Mis préstamos</h2></div>
        <LoadState busy={false} empty={account.loans.length === 0} />
        {account.loans.map((loan) => <article className="account-loan panel" key={loan.id}>
          <div className="account-loan-heading"><div><span className="eyebrow">{loan.mode === "HOME" ? "Domicilio" : "Sala"}</span><h3>{loan.id}</h3></div><Status>{loan.state}</Status></div>
          <p className="muted">Entrega: {dateTime(loan.issuedAt)}</p>
          <div className="table-wrap"><table><thead><tr><th>Ejemplar</th><th>Vencimiento</th><th>Estado</th><th>Disponible desde</th></tr></thead>
            <tbody>{loan.items.map((item) => <tr key={item.copyId}><td><strong>{item.copyId}</strong><small>{item.title}</small></td><td>{dateTime(item.dueAt)}</td><td><Status>{item.state ?? loan.state}</Status></td><td>{dateTime(item.readyAt)}</td></tr>)}</tbody>
          </table></div>
          {loan.assessment && <p className="muted">Evaluación: <Status>{loan.assessment.state}</Status> · {loan.assessment.amount} {loan.assessment.currency}</p>}
          {loan.mode === "HOME" && loan.state !== "PREPARING" && loan.state !== "ABORTED" && <button className="secondary-button" onClick={() => go("receipt", loan.id)}>Ver / imprimir comprobante</button>}
        </article>)}
        <Pagination page={page} total={account.totalLoans} onChange={setPage} busy={busy} />
      </section>
      <section className="account-section">
        <div className="section-heading"><h2>Mis solicitudes</h2></div>
        <LoadState busy={false} empty={requests.items.length === 0} />
        {requests.items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Solicitud</th><th>Material</th><th>Modalidad</th><th>Estado</th><th>Retención</th><th>Acción</th></tr></thead>
          <tbody>{requests.items.map((request) => <tr key={request.id}><td>{request.id}</td><td>{request.items?.map((item) => `${item.title} · ${item.copyId}`).join(", ") || request.copyIds?.join(", ")}</td><td>{request.mode === "HOME" ? "Domicilio" : "Sala"}</td><td><Status>{request.state}</Status></td><td>{dateTime(request.expiresAt)}</td><td>{request.state === "PENDING" ? <button className="text-button danger-text" onClick={() => { setAction({ kind: "request", id: request.id, label: request.id }); setActionError(""); }}>Cancelar</button> : "—"}</td></tr>)}</tbody>
        </table></div>}
      </section>
      <section className="account-section">
        <div className="section-heading"><h2>Mis reservas</h2></div>
        <LoadState busy={false} empty={account.reservations.length === 0} />
        {account.reservations.length > 0 && <ReservationTable reservations={account.reservations} onCancel={(reservation) => { setAction({ kind: "reservation", id: reservation.id, label: reservation.copyId }); setActionError(""); }} />}
      </section>
    </>}
    {action && <Dialog title={`Cancelar ${action.kind === "request" ? "solicitud" : "reserva"}`} busy={actionBusy} onCancel={() => setAction(null)}>
      <p>¿Confirmas la cancelación de {action.label}?</p><ErrorBox message={actionError} />
      <div className="dialog-actions"><button type="button" disabled={actionBusy} onClick={() => setAction(null)}>Volver</button><button className="danger-button" type="button" disabled={actionBusy} onClick={() => { void confirmAction(); }}>{actionBusy ? "Cancelando…" : "Confirmar cancelación"}</button></div>
    </Dialog>}
  </AdminShell>;
}

function ReservationTable({ reservations, onCancel }: { reservations: Reservation[]; onCancel: (reservation: Reservation) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Ejemplar</th><th>Fecha</th><th>Modalidad</th><th>Estado</th><th>Acción</th></tr></thead>
    <tbody>{reservations.map((reservation) => <tr key={reservation.id}><td>{reservation.copyId}</td><td>{reservation.date}</td><td>{reservation.mode === "HOME" ? "Domicilio" : "Sala"}</td><td><Status>{reservation.state}</Status></td><td>{reservation.state === "ACTIVE" ? <button className="text-button danger-text" onClick={() => onCancel(reservation)}>Cancelar</button> : "—"}</td></tr>)}</tbody>
  </table></div>;
}
