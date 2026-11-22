import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, go, type LoanRequest, type Page, type Session } from "./api";
import { Collections, Home } from "./Catalogue";
import { DocumentForm } from "./DocumentForm";
import { AdminShell, Dialog, ErrorBox, Header, Status } from "./components";
import { ApplicationProvider, useApplication } from "./session";

function Login() {
  const { login } = useApplication();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const session = await api<Session>("/api/auth/login", { method: "POST", body: { email, password } });
      login(session); setPassword("");
      go(session.role === "LIBRARIAN" ? "collections" : "home");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div className="login-screen">
    <button className="home-button" onClick={() => go("home")}>Inicio</button>
    <form className="login-card" onSubmit={(event) => { void submit(event); }}>
      <h1>Ingresar a la biblioteca</h1>
      <p>El perfil se verifica en el servidor según tu cuenta.</p>
      <label>Email<input type="email" required autoComplete="username" value={email} maxLength={160} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Contraseña<input type="password" required autoComplete="current-password" value={password} maxLength={128} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <ErrorBox message={error} /><button className="dark-button" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
    </form>
  </div>;
}
function Requests() {
  const [data, setData] = useState<Page<LoanRequest>>({ items: [], total: 0 });
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError("");
    void api<Page<LoanRequest>>(`/api/requests?page=${page}&size=20`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(errorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [page]);
  const date = (value?: string) => value ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
  return <AdminShell title="Solicitudes">
    <h2>Solicitudes recibidas por el backend</h2>
    <ErrorBox message={error} /><p role="status">{busy ? "Cargando solicitudes…" : `${data.total} solicitudes pendientes`}</p>
    <div className="table-wrap" aria-busy={busy}><table>
      <thead><tr>{["ID SOLICITUD", "DOCUMENTOS / EJEMPLARES", "ID LECTOR", "FECHA SOLICITUD", "MODALIDAD", "VENCE RETENCIÓN", "ESTADO"].map((text) => <th key={text}>{text}</th>)}</tr></thead>
      <tbody>{data.items.map((row) => <tr key={row.id}>
        <td>{row.id}</td><td>{row.items?.map((item) => `${item.title} (${item.copyId} · ${item.shelf})`).join(", ") || row.copyIds?.join(", ")}</td>
        <td>{row.ownerId}</td><td>{date(row.createdAt)}</td><td>{row.mode === "HOME" ? "Domicilio" : "Sala"}</td>
        <td>{date(row.expiresAt)}</td><td><Status>{row.state}</Status></td>
      </tr>)}{!busy && !data.items.length && <tr><td colSpan={7}>No hay solicitudes pendientes.</td></tr>}</tbody>
    </table></div>
    <nav className="pagination" aria-label="Paginación de solicitudes">
      <button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page + 1}</span><button disabled={busy || (page + 1) * 20 >= data.total} onClick={() => setPage(page + 1)}>Siguiente</button>
    </nav>
  </AdminShell>;
}
function location() {
  const [name, rawId] = window.location.hash.slice(1).split("/");
  return { name: name || "home", id: rawId && /^[A-Za-z0-9_-]{1,100}$/.test(rawId) ? rawId : undefined };
}
function Screens() {
  const [route, setRoute] = useState(location);
  const { session, notice, notify } = useApplication();
  useEffect(() => {
    const changed = () => setRoute(location());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const protectedRoute = ["collections", "requests", "add", "detail", "edit"].includes(route.name);
  let screen;
  if (route.name === "login" || protectedRoute && !session) screen = <Login />;
  else if (protectedRoute && session?.role !== "LIBRARIAN") screen = <><Header /><main className="access-denied"><h1>Acceso restringido</h1><p>Esta vista requiere una cuenta de bibliotecario.</p><button onClick={() => go("home")}>Volver al catálogo</button></main></>;
  else if (route.name === "collections") screen = <Collections />;
  else if (route.name === "requests") screen = <Requests />;
  else if (route.name === "add") screen = <DocumentForm key="add" />;
  else if ((route.name === "edit" || route.name === "detail") && route.id) screen = <DocumentForm key={route.id} id={route.id} />;
  else screen = <Home />;
  return <>{screen}{notice && <Dialog title={notice.title} onCancel={() => { notify(null); notice.afterClose?.(); }}>
    <p>{notice.message}</p><div className="dialog-actions"><button className="dark-button" autoFocus onClick={() => { notify(null); notice.afterClose?.(); }}>Aceptar</button></div>
  </Dialog>}</>;
}
export default function App() {
  return <ApplicationProvider><Screens /></ApplicationProvider>;
}
