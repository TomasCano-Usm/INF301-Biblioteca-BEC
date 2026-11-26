import { useCallback, useEffect, useMemo, useState } from "react";
import { announceRuntimeMessage, initializeDomRuntime } from "./dom-runtime";
import { dummyApi, type Book, type ServiceStatus, type TableRow } from "./services/dummyApi";

const A = "/assets";

type Route = "home" | "login" | "menu" | "collections" | "catalog" | "requests" | "loan" | "return" | "add" | "edit";
const validRoutes: Route[] = ["home", "login", "menu", "collections", "catalog", "requests", "loan", "return", "add", "edit"];

function resolveRoute(hash: string): Route {
  if (hash === "detail") return sessionStorage.getItem("biblioteca-sesion") ? "collections" : "home";
  return validRoutes.includes(hash as Route) ? hash as Route : "home";
}

function useDummyResource<T>(loader: () => Promise<T>, initialValue: T) {
  const [data, setData] = useState<T>(initialValue);
  const [status, setStatus] = useState<ServiceStatus>("idle");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      setData(await loader());
      setStatus("success");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "Ocurrió un error inesperado.");
    }
  }, [loader]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, status, error, retry: load };
}

function ServiceState({
  status,
  error,
  empty,
  onRetry,
}: {
  status: ServiceStatus;
  error: string;
  empty?: boolean;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "idle") {
    return <div className="service-state service-loading" role="status"><span />Cargando información…</div>;
  }
  if (status === "error") {
    return (
      <div className="service-state service-error" role="alert">
        <strong>No pudimos cargar la información.</strong>
        <span>{error}</span>
        <button onClick={onRetry}>Reintentar</button>
      </div>
    );
  }
  if (empty) {
    return <div className="service-state service-empty" role="status">No hay resultados para esta búsqueda.</div>;
  }
  return null;
}

function go(route: Route) {
  window.location.hash = route;
}

function Header({ title, publicView = false }: { title?: string; publicView?: boolean }) {
  return (
    <header className="app-header">
      <button className="logo-button" onClick={() => go(publicView ? "home" : "menu")} aria-label="Ir al inicio">
        <img src={`${A}/782e0.png`} alt="Biblioteca Estación Central" />
      </button>
      {title && <h1>{title}</h1>}
      <button className="auth-button" onClick={() => {
        if (!publicView) {
          sessionStorage.removeItem("biblioteca-sesion");
          sessionStorage.removeItem("biblioteca-solicitud-activa");
        }
        go(publicView ? "login" : "home");
      }}>
        <img src={`${A}/4ff76.svg`} alt="" />
        {publicView ? "Sign in" : "Cerrar Sesión"}
      </button>
    </header>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder = "Buscar",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <span className="sr-only">Buscar</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <img src={`${A}/a6fae.svg`} alt="" />
    </label>
  );
}

function AdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-screen">
      <Header title={title} />
      <main className="admin-main">{children}</main>
    </div>
  );
}

function Home() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [requesting, setRequesting] = useState("");
  const [requested, setRequested] = useState<string[]>([]);
  const { data: books, status, error, retry } = useDummyResource<Book[]>(dummyApi.getBooks, []);
  const categories = useMemo(
    () => Array.from(new Set(books.flatMap((book) => book.category.split("/")))).sort(),
    [books],
  );
  const filteredBooks = useMemo(
    () => {
      const normalizedQuery = query.trim().toLocaleLowerCase("es");
      return books.filter((book) =>
        `${book.title} ${book.author}`.toLocaleLowerCase("es").includes(normalizedQuery)
        && (category === "Todas" || book.category.includes(category)),
      );
    },
    [books, category, query],
  );

  return (
    <div className="home-screen">
      <Header publicView />
      <aside className="filters">
        <div className="filter-search">
          <SearchBox value={query} onChange={setQuery} placeholder="Buscar por título o autor" />
        </div>
        <div className="filter-menu">
          <h2>Filtros</h2>
          <label>Categoría
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>Todas</option>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <button
            className="reset-button"
            type="button"
            disabled={!query && category === "Todas"}
            onClick={() => {
              setQuery("");
              setCategory("Todas");
            }}
          >
            Restablecer
          </button>
        </div>
      </aside>
      <main className="book-list" aria-busy={status === "loading"}>
        <ServiceState status={status} error={error} empty={status === "success" && filteredBooks.length === 0} onRetry={retry} />
        {filteredBooks.map((book) => (
          <article className="book-card" key={book.title}>
            <div className="cover-slot"><img src={book.image} alt={`Portada de ${book.title}`} /></div>
            <div className="book-copy">
              <h2>{book.title}</h2>
              <span className="book-meta">{book.author} · {book.category}</span>
              <p>{book.description}</p>
              <button
                disabled={requesting === book.title || requested.includes(book.title)}
                onClick={async () => {
                  setRequesting(book.title);
                  try {
                    await dummyApi.createRequest(book.title);
                    setRequested((current) => [...current, book.title]);
                    announceRuntimeMessage(`Solicitud registrada para ${book.title}.`);
                  } catch (reason) {
                    announceRuntimeMessage(reason instanceof Error ? reason.message : "No fue posible registrar la solicitud.", "error");
                  } finally {
                    setRequesting("");
                  }
                }}
              >
                {requesting === book.title ? "Enviando…" : requested.includes(book.title) ? "Solicitado" : "Solicitar"}
              </button>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}

function Login() {
  const [profile, setProfile] = useState("Bibliotecario");
  const [status, setStatus] = useState<ServiceStatus>("idle");
  const [error, setError] = useState("");
  return (
    <div className="login-screen">
      <button className="home-button" onClick={() => go("home")}>Home</button>
      <form className="login-card" onSubmit={async (event) => {
        event.preventDefault();
        setStatus("loading");
        setError("");
        const values = new FormData(event.currentTarget);
        try {
          await dummyApi.validateCredentials(String(values.get("email")), String(values.get("password")));
          setStatus("success");
          announceRuntimeMessage("Credenciales validadas. Bienvenido.");
          go("menu");
        } catch (reason) {
          setStatus("error");
          setError(reason instanceof Error ? reason.message : "No fue posible iniciar sesión.");
        }
      }}>
        <label>Perfil
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option>Bibliotecario</option><option>Usuario</option>
          </select>
        </label>
        <label>Email<input name="email" type="email" defaultValue="bibliotecario@bec.cl" required /></label>
        <label>Contraseña<input name="password" type="password" defaultValue="biblioteca" required /></label>
        {status === "error" && <div className="inline-error" role="alert">{error} Puedes volver a intentarlo.</div>}
        <button className="dark-button" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Validando…" : "Ingresar"}
        </button>
        <button className="text-link" type="button">Forgot password?</button>
      </form>
    </div>
  );
}

const menuItems: Array<{ title: string; description: string; route: Route }> = [
  { title: "Administrar colección", description: "Añadir, editar y organizar documentos.", route: "collections" },
  { title: "Consultar catálogo", description: "Buscar por nombre, autor o categoría y revisar disponibilidad.", route: "catalog" },
  { title: "Revisar solicitudes", description: "Preparar solicitudes recibidas desde los tótems.", route: "requests" },
  { title: "Registrar préstamo", description: "Validar al lector y registrar préstamos en sala o a domicilio.", route: "loan" },
  { title: "Ingresar devolución", description: "Devolver ejemplares y calcular atrasos o sanciones.", route: "return" },
];

function MainMenu() {
  return (
    <AdminShell title="Menú principal">
      <section className="dashboard-intro">
        <p>Selecciona una tarea para continuar con el flujo de atención bibliotecaria.</p>
      </section>
      <div className="dashboard-grid">
        {menuItems.map((item) => (
          <button className="dashboard-card" onClick={() => go(item.route)} key={item.route}>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <strong>Continuar →</strong>
          </button>
        ))}
      </div>
    </AdminShell>
  );
}

function Status({ children }: { children: string }) {
  const kind = children === "Disponible" || children === "Finalizado"
    ? "good" : children === "No disponible" || children === "No Repuesto"
      ? "bad" : children === "Pendiente" || children === "En camino" ? "pending" : "loaned";
  return <span className={`status ${kind}`}>{children}</span>;
}

function Collections() {
  const [query, setQuery] = useState("");
  const { data, status, error, retry } = useDummyResource<TableRow[]>(dummyApi.getCollections, []);
  const rows = data.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <AdminShell title="Colecciones">
      <div className="table-tools">
        <SearchBox value={query} onChange={setQuery} />
        <button className="add-button" onClick={() => go("add")}><img src={`${A}/84c1a.svg`} alt="" />Añadir Libro</button>
      </div>
      <ServiceState status={status} error={error} empty={status === "success" && rows.length === 0} onRetry={retry} />
      <div className="table-wrap">
        <table>
          <thead><tr>{["ID", "NOMBRE", "EDITORIAL", "FECHA INGRESO", "STOCK", "TIPO", "STATUS", "EDITAR"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row[0]}>
              {row.slice(0, 6).map((cell) => <td key={cell}>{cell}</td>)}
              <td><Status>{row[6]}</Status></td>
              <td><button className="edit-button" onClick={() => go("edit")}>Editar</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </AdminShell>
  );
}

const catalogAuthors = ["Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki", "Hirohiko Araki"];

function Catalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todas");
  const [availability, setAvailability] = useState("Todos");
  const { data, status, error, retry } = useDummyResource<TableRow[]>(dummyApi.getCollections, []);
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const categories = useMemo(
    () => Array.from(new Set(data.flatMap((row) => row[5].split("/")))).sort(),
    [data],
  );
  const rows = data
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row, sourceIndex }) => {
    const searchable = `${row[1]} ${catalogAuthors[sourceIndex]} ${row[5]}`.toLocaleLowerCase("es");
    return searchable.includes(normalizedQuery)
      && (category === "Todas" || row[5].includes(category))
      && (availability === "Todos" || row[6] === availability);
  });
  const hasActiveFilters = Boolean(query) || category !== "Todas" || availability !== "Todos";

  return (
    <AdminShell title="Consultar catálogo">
      <button className="back-button" onClick={() => go("menu")}>Volver al menú</button>
      <div className="catalog-filters">
        <SearchBox value={query} onChange={setQuery} placeholder="Buscar por título o autor" />
        <label>Categoría
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option>Todas</option>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Disponibilidad
          <select value={availability} onChange={(event) => setAvailability(event.target.value)}>
            <option>Todos</option><option>Disponible</option><option>No disponible</option><option>En camino</option>
          </select>
        </label>
        <button
          className="reset-button"
          type="button"
          disabled={!hasActiveFilters}
          onClick={() => {
            setQuery("");
            setCategory("Todas");
            setAvailability("Todos");
          }}
        >
          Restablecer
        </button>
      </div>
      <ServiceState status={status} error={error} empty={status === "success" && rows.length === 0} onRetry={retry} />
      <div className="catalog-grid">
        {rows.map(({ row, sourceIndex }) => {
          const stock = Number.parseInt(row[4], 10) || 0;
          const inRoom = row[6] === "Disponible" ? Math.min(sourceIndex % 3, stock) : 0;
          return (
            <article className="catalog-card" key={row[0]}>
              <div>
                <span className="catalog-id">Ejemplar {row[0]}</span>
                <h2>{row[1]}</h2>
                <p>{catalogAuthors[sourceIndex]} · {row[5]}</p>
              </div>
              <Status>{row[6]}</Status>
              <dl>
                <div><dt>Editorial</dt><dd>{row[2]}</dd></div>
                <div><dt>Ejemplares</dt><dd>{stock}</dd></div>
                <div><dt>Prestados en sala</dt><dd>{inRoom}</dd></div>
                <div><dt>Ubicación</dt><dd>Estante {String.fromCharCode(65 + (sourceIndex % 4))}-{sourceIndex + 1}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </AdminShell>
  );
}

function Requests() {
  const [query, setQuery] = useState("");
  const { data, status, error, retry } = useDummyResource<TableRow[]>(dummyApi.getRequests, []);
  const rows = data.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase()));
  return (
    <AdminShell title="Solicitudes">
      <div className="table-tools"><SearchBox value={query} onChange={setQuery} /></div>
      <ServiceState status={status} error={error} empty={status === "success" && rows.length === 0} onRetry={retry} />
      <div className="table-wrap">
        <table>
          <thead><tr>{["ID SOLICITUD", "DOCUMENTO", "RUT", "SOLICITANTE", "UBICACIÓN", "STATUS", "ACCIÓN"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row[0]}>
              <td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td>{row[4]}</td>
              <td>Estante {String.fromCharCode(65 + (index % 4))}-{index + 1}</td>
              <td><Status>{row[6]}</Status></td>
              <td>
                <button className="edit-button" onClick={() => {
                  sessionStorage.setItem("biblioteca-solicitud-activa", JSON.stringify({
                    id: row[0], document: row[1], rut: row[2], reader: row[4],
                    location: `Estante ${String.fromCharCode(65 + (index % 4))}-${index + 1}`,
                  }));
                  go("loan");
                }}>Preparar préstamo</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function LoanRegistration() {
  const [fingerprint, setFingerprint] = useState(false);
  const [loanType, setLoanType] = useState<"sala" | "domicilio">("sala");
  const [status, setStatus] = useState<ServiceStatus>("idle");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; dueAt: string; rut: string; copies: string; loanType: string } | null>(null);
  const request = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("biblioteca-solicitud-activa") ?? "null") as null | {
        id: string; document: string; rut: string; reader: string; location: string;
      };
    } catch {
      return null;
    }
  }, []);

  return (
    <AdminShell title="Registrar préstamo">
      <button className="back-button" onClick={() => go(request ? "requests" : "menu")}>Volver</button>
      <div className="workflow-layout">
        <section className="workflow-summary">
          <span className="eyebrow">Atención en mesón</span>
          <h2>{request ? request.document : "Nuevo préstamo"}</h2>
          {request ? (
            <>
              <p><strong>Solicitud:</strong> {request.id}</p>
              <p><strong>Lector:</strong> {request.reader}</p>
              <p><strong>Ubicación:</strong> {request.location}</p>
              <div className="workflow-callout">Busca el ejemplar en la estantería y espera la llegada del lector antes de continuar.</div>
            </>
          ) : <p>Ingresa los datos del lector y los ejemplares que serán entregados.</p>}
        </section>
        <form className="workflow-form" onSubmit={async (event) => {
          event.preventDefault();
          if (!fingerprint) {
            setError("Debes validar la huella digital antes de registrar el préstamo.");
            return;
          }
          setStatus("loading");
          setError("");
          const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
          try {
            const result = await dummyApi.registerLoan({ ...values, loanType });
            setReceipt(result);
            setStatus("success");
            sessionStorage.removeItem("biblioteca-solicitud-activa");
            announceRuntimeMessage("Préstamo registrado correctamente.");
          } catch (reason) {
            setStatus("error");
            setError(reason instanceof Error ? reason.message : "No fue posible registrar el préstamo.");
          }
        }}>
          <h2>Datos del préstamo</h2>
          <label>Códigos de ejemplares
            <input name="copies" defaultValue={request ? "EJ-00001" : ""} placeholder="Ej: EJ-00001, EJ-00002" required />
          </label>
          <label>RUT del lector
            <input name="rut" defaultValue={request?.rut ?? ""} placeholder="12.345.678-9" pattern="[0-9.]{7,12}-[0-9Kk]" required />
          </label>
          <div className={`fingerprint-box ${fingerprint ? "validated" : ""}`}>
            <div><strong>Huella digital</strong><span>{fingerprint ? "Identidad validada" : "Pendiente de validación"}</span></div>
            <button type="button" onClick={() => setFingerprint(true)}>{fingerprint ? "Validada" : "Validar huella"}</button>
          </div>
          <fieldset>
            <legend>Tipo de préstamo</legend>
            <div className="type-toggle">
              <button type="button" className={loanType === "sala" ? "selected" : ""} onClick={() => setLoanType("sala")}>En sala</button>
              <button type="button" className={loanType === "domicilio" ? "selected" : ""} onClick={() => setLoanType("domicilio")}>A domicilio</button>
            </div>
          </fieldset>
          <p className="calculation-note">{loanType === "sala" ? "La devolución se calculará para 2 horas desde el registro." : "La devolución se calculará para 14 días desde el registro."}</p>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="dark-button" type="submit" disabled={status === "loading" || Boolean(receipt)}>
            {status === "loading" ? "Registrando…" : receipt ? "Préstamo registrado" : "Registrar préstamo"}
          </button>
          {receipt && (
            <section className="receipt" aria-live="polite">
              <span>Comprobante {receipt.id}</span>
              <h3>Préstamo registrado</h3>
              <p><strong>RUT:</strong> {receipt.rut}</p>
              <p><strong>Ejemplares:</strong> {receipt.copies}</p>
              <p><strong>Devolución:</strong> {formatDateTime(receipt.dueAt)}</p>
              <button type="button" className="text-link" onClick={() => window.print()}>Imprimir comprobante</button>
              <button type="button" className="dark-button" onClick={() => go("menu")}>Finalizar y volver al menú</button>
            </section>
          )}
        </form>
      </div>
    </AdminShell>
  );
}

function ReturnRegistration() {
  const [status, setStatus] = useState<ServiceStatus>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ copyCode: string; availableAt: string; lateDays: number; sanctionDays: number } | null>(null);
  return (
    <AdminShell title="Ingresar devolución">
      <button className="back-button" onClick={() => go("menu")}>Volver al menú</button>
      <div className="return-panel">
        <section>
          <span className="eyebrow">Devoluciones</span>
          <h2>Registrar ejemplar devuelto</h2>
          <p>Ingresa el código físico del ejemplar. El sistema revisará atrasos y programará su disponibilidad.</p>
        </section>
        <form onSubmit={async (event) => {
          event.preventDefault();
          setStatus("loading");
          setError("");
          setResult(null);
          const code = String(new FormData(event.currentTarget).get("copyCode"));
          try {
            const response = await dummyApi.registerReturn(code);
            setResult(response);
            setStatus("success");
            announceRuntimeMessage(`Ejemplar ${code} marcado como devuelto.`);
          } catch (reason) {
            setStatus("error");
            setError(reason instanceof Error ? reason.message : "No fue posible registrar la devolución.");
          }
        }}>
          <label>Código del ejemplar
            <input name="copyCode" placeholder="Ej: EJ-00017" required />
          </label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="dark-button" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Consultando…" : "Registrar devolución"}
          </button>
        </form>
        {result && (
          <section className="return-result" aria-live="polite">
            <Status>Devuelto</Status>
            <h3>{result.copyCode} fue marcado como devuelto</h3>
            {result.lateDays > 0 ? (
              <div className="sanction"><strong>Devolución con {result.lateDays} días de atraso.</strong><span>Sanción temporal calculada: {result.sanctionDays} días.</span></div>
            ) : <p>El lector no presenta atraso ni sanciones.</p>}
            <p>Restaura el ejemplar en su estantería. Estará disponible desde <strong>{formatDateTime(result.availableAt)}</strong>.</p>
            <button className="dark-button" onClick={() => go("menu")}>Finalizar y volver al menú</button>
          </section>
        )}
      </div>
    </AdminShell>
  );
}

function DocumentForm({ edit = false }: { edit?: boolean }) {
  const [type, setType] = useState<"Libro" | "Multimedia">("Libro");
  const [saveStatus, setSaveStatus] = useState<ServiceStatus>("idle");
  const [saveError, setSaveError] = useState("");
  return (
    <AdminShell title={edit ? "Editar documento" : "Añadir Libro"}>
      <button className="back-button" onClick={() => go("collections")}>Volver</button>
      <div className="document-layout">
        <div className="document-cover"><img src={`${A}/76af2.png`} alt="Portada de Steel Ball Run 01" /></div>
        <form className="document-form" onSubmit={async (event) => {
          event.preventDefault();
          setSaveStatus("loading");
          setSaveError("");
          const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
          try {
            await dummyApi.saveDocument({ ...values, type }, edit);
            setSaveStatus("success");
            announceRuntimeMessage(edit ? "Documento actualizado correctamente." : "Documento añadido correctamente.");
            go("menu");
          } catch (reason) {
            setSaveStatus("error");
            setSaveError(reason instanceof Error ? reason.message : "No fue posible guardar el documento.");
          }
        }}>
          <h2>{edit ? "Editar documento" : "Añadir documento"}</h2>
          <p>Completa la información del libro o material multimedia.</p>
          <div className="form-grid">
            <label>Título<input name="title" placeholder="Ingresa el título" required /></label>
            <label>Autor<input name="author" placeholder="Ingresa el autor" required /></label>
          </div>
          <label>Tipo de documento</label>
          <div className="type-toggle">
            {(["Libro", "Multimedia"] as const).map((item) => (
              <button type="button" className={type === item ? "selected" : ""} onClick={() => setType(item)} key={item}>{item}</button>
            ))}
          </div>
          <label>Categoría<input name="subcategory" placeholder="Escribe una categoría" required /></label>
          <label>Descripción<textarea name="description" placeholder="Añade una descripción" /></label>
          <div className="form-grid">
            <label>Stock{edit ? <select name="stock"><option>Ingresa la cantidad</option><option>1</option><option>2</option></select> : <input name="stock" placeholder="Ingresa la cantidad" />}</label>
            <label>Editorial{edit ? <select name="publisher"><option>Selecciona la editorial</option><option>Ivrea</option><option>Panini</option></select> : <input name="publisher" placeholder="Selecciona la editorial" />}</label>
          </div>
          <div className="form-grid form-grid-three">
            <label>Edición<input name="edition" placeholder="Ej: 1ª edición" required /></label>
            <label>Año<input name="year" type="number" min="1500" max="2100" placeholder="2026" required /></label>
            <label>Ubicación<input name="location" placeholder="Estante A-1" required /></label>
          </div>
          {saveStatus === "error" && <div className="inline-error" role="alert">{saveError}</div>}
          <button className="dark-button" type="submit" disabled={saveStatus === "loading"}>
            {saveStatus === "loading" ? "Guardando…" : edit ? "Confirmar edicion" : "Añadir"}
          </button>
        </form>
      </div>
    </AdminShell>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(() => {
    return resolveRoute(window.location.hash.slice(1));
  });
  useEffect(() => {
    const onHash = () => {
      setRoute(resolveRoute(window.location.hash.slice(1)));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => initializeDomRuntime(), []);

  return (
    <>
      {route === "home" && <Home />}
      {route === "login" && <Login />}
      {route === "menu" && <MainMenu />}
      {route === "collections" && <Collections />}
      {route === "catalog" && <Catalog />}
      {route === "requests" && <Requests />}
      {route === "loan" && <LoanRegistration />}
      {route === "return" && <ReturnRegistration />}
      {route === "add" && <DocumentForm />}
      {route === "edit" && <DocumentForm edit />}
    </>
  );
}

export default App;
