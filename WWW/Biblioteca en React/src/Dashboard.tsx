import { go, type Role } from "./api";
import { AdminShell } from "./components";

const cards: Record<Role, { title: string; description: string; route: string }[]> = {
  READER: [
    { title: "Consultar catálogo", description: "Busca documentos y disponibilidad de ejemplares.", route: "home" },
    { title: "Mi cuenta", description: "Revisa préstamos, solicitudes, reservas y sanciones.", route: "account" },
  ],
  LIBRARIAN: [
    { title: "Administrar colección", description: "Gestiona documentos y ejemplares.", route: "collections" },
    { title: "Preparar y entregar", description: "Atiende solicitudes y verifica la identidad del lector.", route: "requests" },
    { title: "Ingresar devolución", description: "Registra la devolución y consulta el control de salida.", route: "returns" },
  ],
  ADMIN: [
    { title: "Fichas de lectores", description: "Inscribe lectores y administra sus datos de contacto.", route: "readers" },
    { title: "Administrar morosidad", description: "Consulta atrasos por modalidad de préstamo.", route: "overdue" },
    { title: "Correo de prueba", description: "Inspecciona mensajes del adaptador de laboratorio.", route: "mailbox" },
  ],
};

export function Dashboard({ role }: { role: Role }) {
  return <AdminShell title="Menú principal">
    <section className="dashboard-intro">
      <span className="eyebrow">Biblioteca Estación Central</span>
      <h2>¿Qué necesitas hacer hoy?</h2>
      <p>Selecciona una tarea para continuar.</p>
    </section>
    <div className="dashboard-grid">
      {cards[role].map((card) => <button className="dashboard-card" key={card.route} onClick={() => go(card.route)}>
        <span className="dashboard-card-mark" aria-hidden="true">BEC</span>
        <h3>{card.title}</h3><p>{card.description}</p><strong>Continuar <span aria-hidden="true">→</span></strong>
      </button>)}
    </div>
  </AdminShell>;
}
