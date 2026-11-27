import { useEffect, useId, useRef, type ReactNode } from "react";
import { go, type Document, type Role } from "./api";
import { useApplication } from "./session";

const A = "/assets";
export function Header({ title }: { title?: string }) {
  const { session, logout } = useApplication();
  return <>
    <header className="app-header">
      <button className="logo-button" onClick={() => go("home")} aria-label="Ir al inicio"><img src={`${A}/782e0.png`} alt="Biblioteca Estación Central" /></button>
      <div className="header-title"><span className="eyebrow">Biblioteca Municipal</span>{title && <h1>{title}</h1>}</div>
      {session && <span className="session-chip">{roleName(session.role)}</span>}
      <button className="auth-button" onClick={() => session ? void logout() : go("login")}>
        <img src={`${A}/4ff76.svg`} alt="" /><span>{session ? "Cerrar sesión" : "Ingresar"}</span>
      </button>
    </header>
    {!title && session && <WorkspaceNavigation />}
  </>;
}

const navigation: { label: string; route: string; roles: Role[] }[] = [
  { label: "Panel", route: "menu", roles: ["READER", "LIBRARIAN", "ADMIN"] },
  { label: "Catálogo", route: "home", roles: ["READER", "LIBRARIAN", "ADMIN"] },
  { label: "Mi cuenta", route: "account", roles: ["READER"] },
  { label: "Colección", route: "collections", roles: ["LIBRARIAN"] },
  { label: "Solicitudes", route: "requests", roles: ["LIBRARIAN"] },
  { label: "Devoluciones", route: "returns", roles: ["LIBRARIAN"] },
  { label: "Lectores", route: "readers", roles: ["ADMIN"] },
  { label: "Morosidad", route: "overdue", roles: ["ADMIN"] },
  { label: "Correo de prueba", route: "mailbox", roles: ["ADMIN"] },
];

export function roleName(role: Role) {
  return role === "LIBRARIAN" ? "Bibliotecario" : role === "ADMIN" ? "Administrativo" : "Lector";
}

function WorkspaceNavigation() {
  const { notify, session } = useApplication();
  const visibleNavigation = navigation.filter((item) => session && item.roles.includes(session.role));
  const rawRoute = window.location.hash.slice(1).split("/")[0] || "home";
  const currentRoute = ["add", "edit", "detail"].includes(rawRoute) ? "collections" : rawRoute === "loan" ? "requests" : rawRoute === "return" ? "returns" : rawRoute;
  return <nav className="workspace-nav" aria-label="Navegación principal">
    {visibleNavigation.map((item) => <button key={item.route} type="button" aria-current={currentRoute === item.route ? "page" : undefined} onClick={() => go(item.route)}>{item.label}</button>)}
    {session?.role === "LIBRARIAN" && <button type="button" onClick={() => go("add")} className="nav-primary">Añadir documento</button>}
    <button className="nav-help" type="button" onClick={() => notify({ title: "Ayuda de la biblioteca", message: "Las acciones disponibles dependen del perfil de tu cuenta. El servidor valida permisos y reglas para cada operación." })} aria-label="Ayuda">?</button>
  </nav>;
}

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return <div className="admin-screen">
    <Header title={title} />
    <WorkspaceNavigation />
    <main className="admin-main">{children}</main>
  </div>;
}
export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className="search-box">
    <span className="sr-only">Buscar en la colección</span>
    <input type="search" value={value} maxLength={100} onChange={(event) => onChange(event.target.value)} placeholder="Buscar en la colección" />
    <img src={`${A}/a6fae.svg`} alt="" />
  </label>;
}
export function Status({ children }: { children: string }) {
  const labels: Record<string, string> = {
    AVAILABLE: "Disponible", UNAVAILABLE: "No disponible", PENDING: "Pendiente",
    ALLOCATING: "Asignando", ISSUING: "Preparando entrega", ISSUED: "Entregado",
    ACTIVE: "Activo", INACTIVE: "Inactivo", CANCELLED: "Cancelado", CANCELLING: "Cancelando",
    EXPIRED: "Vencido", FAILED: "Fallido", RETURNED: "Devuelto", RESHELVING: "En reposición",
    ROOM: "En sala", HOME: "Domicilio", EXEMPT: "Sin cobro", PREPARING: "Preparando",
    ABORTED: "Interrumpido", RESERVING: "Reservando", RESERVED: "Reservado",
  };
  const good = ["Disponible", "Finalizado", "ISSUED", "ACTIVE", "RETURNED", "EXEMPT"];
  const bad = ["No disponible", "CANCELLED", "CANCELLING", "EXPIRED", "FAILED", "ABORTED", "INACTIVE"];
  const pending = ["PENDING", "ALLOCATING", "ISSUING", "PREPARING", "RESERVING", "RESHELVING"];
  const kind = good.includes(children) ? "good" : bad.includes(children) ? "bad" : pending.includes(children) ? "pending" : "loaned";
  return <span className={`status ${kind}`}><span>{labels[children] ?? children}</span></span>;
}

export function LoadState({ busy, error = "", empty, onRetry }: { busy: boolean; error?: string; empty?: boolean; onRetry?: () => void }) {
  if (busy) return <div className="service-state service-loading" role="status"><span className="loading-spinner" /><span>Cargando información…</span></div>;
  if (error) return <div className="service-state service-error" role="alert"><strong>No se pudo cargar la información.</strong><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Reintentar</button>}</div>;
  if (empty) return <div className="service-state service-empty" role="status"><span>No hay resultados para mostrar.</span></div>;
  return null;
}
export function Dialog({ title, children, onCancel, busy = false }: {
  title: string; children: ReactNode; onCancel: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="message-dialog" aria-labelledby={heading} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={heading}>{title}</h2>{children}
  </dialog>;
}
export function ErrorBox({ message }: { message: string }) {
  return message ? <p role="alert" className="error-message">{message}</p> : null;
}
const originalCovers: [string, string][] = [
  ["phantom blood", "13b97.png"], ["battle tendency", "31a2d.png"], ["stardust", "ec346.png"],
  ["diamond", "be1c6.png"], ["golden wind", "66241.png"], ["stone ocean", "6faa0.png"], ["steel ball run", "76af2.png"],
];
export function Cover({ document }: { document: Pick<Document, "title" | "type"> }) {
  const image = originalCovers.find(([title]) => document.title.toLowerCase().startsWith(title))?.[1];
  return image ? <img src={`${A}/${image}`} alt={`Portada de ${document.title}`} /> :
    <div className="cover-placeholder" aria-label="Documento sin portada">
      <span aria-hidden="true">{document.type === "AUDIO" ? "♫" : document.type === "VIDEO" ? "▶" : "▤"}</span>
      <strong>{document.title || "Nuevo documento"}</strong>
      <small>{document.type === "AUDIO" || document.type === "VIDEO" ? "Multimedia" : "Biblioteca Estación Central"}</small>
    </div>;
}
export function Pagination({ page, total, onChange, busy }: { page: number; total: number; onChange: (page: number) => void; busy: boolean }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  return <nav className="pagination" aria-label="Paginación">
    <button type="button" disabled={busy || page === 0} onClick={() => onChange(page - 1)}>Anterior</button>
    <span>Página {page + 1} de {pages} · {total} documentos</span>
    <button type="button" disabled={busy || page + 1 >= pages} onClick={() => onChange(page + 1)}>Siguiente</button>
  </nav>;
}
