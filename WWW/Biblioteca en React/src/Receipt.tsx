import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Receipt as ReceiptData } from "./api";
import { AdminShell, LoadState, Status } from "./components";

function dateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));
}

export function Receipt({ id }: { id?: string }) {
  const [data, setData] = useState<ReceiptData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    if (!id) { setError("No se indicó el préstamo del comprobante."); setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true); setError("");
    void api<ReceiptData>(`/api/loans/${encodeURIComponent(id)}/receipt`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => load(), [load]);

  return <AdminShell title="Comprobante de préstamo">
    <LoadState busy={busy} error={error} onRetry={load} />
    {!busy && !error && data && <article className="receipt-card panel">
      <div className="receipt-header"><div><span className="eyebrow">P09 · Biblioteca Estación Central</span><h2>Comprobante de préstamo a domicilio</h2></div><Status>HOME</Status></div>
      <dl className="receipt-meta"><div><dt>Número</dt><dd>{data.loanId}</dd></div><div><dt>Lector</dt><dd>{data.readerId}</dd></div><div><dt>Fecha de entrega</dt><dd>{dateTime(data.issuedAt)}</dd></div></dl>
      <div className="table-wrap"><table><thead><tr><th>Ejemplar</th><th>Documento</th><th>Vencimiento</th><th>Estado</th></tr></thead>
        <tbody>{data.items.map((item) => <tr key={item.copyId}><td>{item.copyId}</td><td>{item.title}</td><td>{dateTime(item.dueAt)}</td><td><Status>{item.state ?? "ACTIVE"}</Status></td></tr>)}</tbody>
      </table></div>
      <div className="receipt-footer"><p>Servicio bibliotecario gratuito · Importe: {data.amount} {data.currency}</p><button className="dark-button no-print" onClick={() => window.print()}>Imprimir comprobante</button></div>
      <p className="muted">Respeta el plazo individual de cada ejemplar. Los atrasos pueden generar una sanción temporal; no se aplican multas.</p>
    </article>}
  </AdminShell>;
}
