import { useEffect, useId, useRef, type ReactNode } from "react";
import { go, type Document } from "./api";
import { useApplication } from "./session";

const A = "/assets";
export function Header({ title }: { title?: string }) {
  const { session, logout } = useApplication();
  return <header className="app-header">
    <button className="logo-button" onClick={() => go("home")} aria-label="Ir al inicio"><img src={`${A}/782e0.png`} alt="Biblioteca Estación Central" /></button>
    {title && <h1>{title}</h1>}
    {session?.role === "LIBRARIAN" && <button className="header-collection" onClick={() => go("collections")}>Colecciones</button>}
    <button className="auth-button" onClick={() => session ? void logout() : go("login")}>
      <img src={`${A}/4ff76.svg`} alt="" />{session ? "Cerrar sesión" : "Ingresar"}
    </button>
  </header>;
}
export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  const { notify } = useApplication();
  return <div className="admin-screen">
    <Header title={title} />
    <aside className="admin-sidebar" aria-label="Navegación">
      <button onClick={() => go("add")} aria-label="Añadir documento" title="Añadir documento"><img src={`${A}/c735e.svg`} alt="" /></button>
      <button onClick={() => go("collections")} aria-label="Colecciones" title="Colecciones"><img src={`${A}/ca582.svg`} alt="" /></button>
      <button onClick={() => go("requests")} aria-label="Solicitudes" title="Solicitudes"><img src={`${A}/a2ab7.svg`} alt="" /></button>
      <button className="sidebar-help" onClick={() => notify({ title: "Gestión de colección", message: "Selecciona Editar en la fila del documento para cambiar sus datos o eliminarlo. La eliminación requiere una confirmación y conserva el historial." })} aria-label="Ayuda">?</button>
    </aside>
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
  const kind = children === "Disponible" || children === "Finalizado" || children === "ISSUED"
    ? "good" : children === "No disponible" || children === "CANCELLED" || children === "EXPIRED"
      ? "bad" : children === "PENDING" || children === "ALLOCATING" ? "pending" : "loaned";
  return <span className={`status ${kind}`}>{children}</span>;
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
