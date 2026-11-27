import { useEffect, useRef, useState, type FormEvent } from "react";
import { Account } from "./Account";
import { api, errorMessage, go, type Role, type Session } from "./api";
import { Collections as HomeCollections, Home } from "./Catalogue";
import { Returns, Overdue } from "./Circulation";
import { Dashboard } from "./Dashboard";
import { DocumentForm } from "./DocumentForm";
import { Mailbox } from "./Mailbox";
import { Readers } from "./Readers";
import { Receipt } from "./Receipt";
import { RequestsQueue } from "./RequestsQueue";
import { AdminShell, Dialog, ErrorBox, Header, roleName } from "./components";
import { ApplicationProvider, useApplication } from "./session";

interface Route { name: string; id?: string }

function location(): Route {
  const [name, rawId] = window.location.hash.slice(1).split("/");
  let id: string | undefined;
  try { id = rawId ? decodeURIComponent(rawId) : undefined; } catch { id = undefined; }
  if (id && !/^[A-Za-z0-9_-]{1,100}$/.test(id)) id = undefined;
  return { name: name || "home", id };
}

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
      go(session.role === "READER" ? "account" : "menu");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div className="login-screen">
    <Header title="Acceso a la biblioteca" />
    <form className="login-card" onSubmit={(event) => { void submit(event); }}>
      <span className="eyebrow">Biblioteca Estación Central</span>
      <h1>Ingresar a la biblioteca</h1>
      <p>Tu perfil y permisos se determinan desde el servidor.</p>
      <label><span>Correo electrónico</span><input type="email" required autoComplete="username" value={email} maxLength={160} disabled={busy} onChange={(event) => setEmail(event.target.value)} /></label>
      <label><span>Contraseña</span><input type="password" required autoComplete="current-password" value={password} maxLength={128} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <ErrorBox message={error} />
      <button className="dark-button" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}</button>
      <p className="muted">Por seguridad, la sesión no se conserva al recargar la página.</p>
    </form>
  </div>;
}

function AccessDenied({ role }: { role?: Role }) {
  return <><Header title="Acceso restringido" /><main className="access-denied panel">
    <span className="eyebrow">Permisos de la cuenta</span><h1>Esta pantalla no está disponible para tu perfil</h1>
    <p>{role ? `Sesión iniciada como ${roleName(role)}.` : "Inicia sesión con una cuenta autorizada."} El servidor sigue validando cada operación.</p>
    <button className="dark-button" onClick={() => go("menu")}>Ir a mi menú</button>
  </main></>;
}

const routeRoles: Record<string, Role[]> = {
  menu: ["READER", "LIBRARIAN", "ADMIN"], account: ["READER"],
  collections: ["LIBRARIAN"], requests: ["LIBRARIAN"], loan: ["LIBRARIAN"], add: ["LIBRARIAN"], edit: ["LIBRARIAN"], detail: ["LIBRARIAN"],
  returns: ["LIBRARIAN"], return: ["LIBRARIAN"], receipt: ["READER", "LIBRARIAN"],
  readers: ["ADMIN"], overdue: ["ADMIN"], mailbox: ["ADMIN"],
};

function Screens() {
  const [route, setRoute] = useState(location);
  const { session, notice, notify } = useApplication();
  const activationStarted = useRef(false);

  useEffect(() => {
    const changed = () => setRoute(location());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("activation");
    if (!token || activationStarted.current) return;
    activationStarted.current = true;
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    void api("/api/auth/activate", { method: "POST", body: { token } }).then(() => {
      notify({ title: "Cuenta activada", message: "El enlace fue validado. Ya puedes iniciar sesión." });
      go("login");
    }).catch((reason: unknown) => {
      notify({ title: "No se pudo activar la cuenta", message: errorMessage(reason) });
      go("login");
    });
  }, [notify]);

  const requiredRoles = routeRoles[route.name];
  const denied = requiredRoles && session && !requiredRoles.includes(session.role);
  const needsSession = requiredRoles && !session;
  let screen;
  if (route.name === "login" || needsSession) screen = <Login />;
  else if (denied) screen = <AccessDenied role={session?.role} />;
  else if (route.name === "menu") screen = <Dashboard role={session!.role} />;
  else if (route.name === "account") screen = <Account />;
  else if (route.name === "collections") screen = <div id="collections"><HomeCollections /></div>;
  else if (route.name === "requests" || route.name === "loan") screen = <RequestsQueue selectedId={route.id} />;
  else if (route.name === "add") screen = <DocumentForm key="add" />;
  else if ((route.name === "edit" || route.name === "detail") && route.id) screen = <DocumentForm key={route.id} id={route.id} />;
  else if (route.name === "returns" || route.name === "return") screen = <Returns />;
  else if (route.name === "readers") screen = <Readers id={route.id} />;
  else if (route.name === "overdue") screen = <Overdue />;
  else if (route.name === "receipt") screen = <Receipt id={route.id} />;
  else if (route.name === "mailbox") screen = <Mailbox />;
  else screen = <Home />;

  return <>{screen}{notice && <Dialog title={notice.title} onCancel={() => { notify(null); notice.afterClose?.(); }}>
    <p>{notice.message}</p><div className="dialog-actions"><button className="dark-button" autoFocus onClick={() => { notify(null); notice.afterClose?.(); }}>Aceptar</button></div>
  </Dialog>}</>;
}

export default function App() {
  return <ApplicationProvider><Screens /></ApplicationProvider>;
}
