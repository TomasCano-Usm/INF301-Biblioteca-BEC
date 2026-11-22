import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, go, setBearer, type Session } from "./api";

export interface Notice { title: string; message: string; afterClose?: () => void }
interface Application {
  session: Session | null; login: (session: Session) => void; logout: () => Promise<void>;
  notice: Notice | null; notify: (notice: Notice | null) => void;
  revision: number; refreshCatalogue: () => void;
}
const Context = createContext<Application | null>(null);
export function useApplication() {
  const value = useContext(Context);
  if (!value) throw new Error("Falta el contexto de aplicación.");
  return value;
}
export function ApplicationProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [notice, notify] = useState<Notice | null>(null);
  const [revision, setRevision] = useState(0);
  const refreshCatalogue = useCallback(() => setRevision((value) => value + 1), []);
  const login = useCallback((value: Session) => { setBearer(value.token); setSession(value); }, []);
  const logout = useCallback(async () => {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); }
    catch { notify({ title: "Sesión local cerrada", message: "El servidor no confirmó la revocación. El token local se eliminó; la sesión del servidor tiene una duración máxima de 20 minutos." }); }
    finally { setBearer(null); setSession(null); go("home"); }
  }, []);
  useEffect(() => {
    const expired = () => {
      setSession(null); setBearer(null);
      notify({ title: "Sesión finalizada", message: "Ingresa nuevamente para continuar." });
      go("login");
    };
    window.addEventListener("bec:session-expired", expired);
    return () => window.removeEventListener("bec:session-expired", expired);
  }, []);
  useEffect(() => {
    if (!session) return;
    // Kiosco: no se persiste el token en localStorage, sessionStorage ni cookies.
    let idle: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(idle); idle = setTimeout(() => { void logout(); }, 5 * 60_000); };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(idle);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [session, logout]);
  return <Context.Provider value={{ session, login, logout, notice, notify, revision, refreshCatalogue }}>{children}</Context.Provider>;
}
