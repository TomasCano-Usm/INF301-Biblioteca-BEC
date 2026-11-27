import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type MailboxPage } from "./api";
import { AdminShell, LoadState } from "./components";
import { useApplication } from "./session";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(value));
}

export function Mailbox() {
  const { notify } = useApplication();
  const [data, setData] = useState<MailboxPage>({ items: [], total: 0 });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [activating, setActivating] = useState<string | null>(null);

  const load = useCallback(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    void api<MailboxPage>("/api/lab/mailbox?page=0&size=20", { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [version]);
  useEffect(() => load(), [load]);

  async function activate(id: string, token: string) {
    setActivating(id); setError("");
    try {
      await api("/api/auth/activate", { method: "POST", body: { token } });
      notify({ title: "Cuenta activada", message: "El enlace de activación fue aceptado por el servicio." });
      setVersion((current) => current + 1);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setActivating(null); }
  }

  return <AdminShell title="Correo de prueba">
    <p className="notice notice-warning"><strong>Adaptador de laboratorio:</strong> estos mensajes no se entregan por Internet. La pantalla está disponible solo cuando el backend habilita el modo laboratorio.</p>
    <div className="section-heading"><div><span className="eyebrow">P10 · Administración</span><h2>Bandeja de mensajes</h2></div><button className="secondary-button" onClick={() => setVersion((current) => current + 1)}>Actualizar</button></div>
    <LoadState busy={busy} error={error} empty={!busy && !error && data.items.length === 0} onRetry={() => setVersion((current) => current + 1)} />
    {!busy && !error && <div className="mailbox-list">{data.items.map((message) => {
      const token = message.text.match(/[?&]activation=([A-Za-z0-9_-]{43})/)?.[1];
      return <article className="mail-card panel" key={message.id}>
        <div className="mail-card-heading"><div><span className="eyebrow">Proveedor TEST</span><h2>{message.subject}</h2></div><time>{dateTime(message.createdAt)}</time></div>
        <p><strong>Para:</strong> {message.to}</p><pre className="mail-content">{message.text}</pre>
        {token && <button className="secondary-button" disabled={activating === message.id} onClick={() => { void activate(message.id, token); }}>{activating === message.id ? "Activando…" : "Validar enlace de activación"}</button>}
      </article>;
    })}</div>}
  </AdminShell>;
}
