export type Book = {
  title: string;
  author: string;
  category: string;
  image: string;
  description: string;
};

export type ServiceStatus = "idle" | "loading" | "success" | "error";
export type TableRow = string[];

function ensureAvailable(message: string) {
  if (!navigator.onLine || sessionStorage.getItem("biblioteca-api-error") === "true") {
    throw new Error(message);
  }
}

const wait = (milliseconds = 650) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

async function getJson<T>(path: string): Promise<T> {
  await wait();
  if (!navigator.onLine || sessionStorage.getItem("biblioteca-api-error") === "true") {
    throw new Error("El servicio simulado no está disponible.");
  }

  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`El servicio respondió con estado ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export const dummyApi = {
  getBooks: () => getJson<Book[]>("/api/books.json"),
  getCollections: () => getJson<TableRow[]>("/api/collections.json"),
  getRequests: () => getJson<TableRow[]>("/api/requests.json"),

  async validateCredentials(email: string, password: string) {
    await wait(700);
    ensureAvailable("No fue posible validar las credenciales. Inténtalo nuevamente.");
    if (email.toLowerCase() !== "bibliotecario@bec.cl" || password !== "biblioteca") {
      throw new Error("Correo o contraseña incorrectos.");
    }
    sessionStorage.setItem("biblioteca-sesion", JSON.stringify({ email, role: "Bibliotecario" }));
    return { email, role: "Bibliotecario" };
  },

  async createRequest(title: string) {
    await wait(850);
    if (!navigator.onLine || sessionStorage.getItem("biblioteca-api-error") === "true") {
      throw new Error("No fue posible registrar la solicitud. Revisa tu conexión e inténtalo nuevamente.");
    }

    const request = {
      id: `SOL-${Date.now()}`,
      title,
      status: "Pendiente",
      createdAt: new Date().toISOString(),
    };
    const previous = JSON.parse(localStorage.getItem("biblioteca-solicitudes") ?? "[]") as object[];
    localStorage.setItem("biblioteca-solicitudes", JSON.stringify([...previous, request]));
    return request;
  },

  async saveDocument(data: Record<string, string>, edit: boolean) {
    await wait(850);
    if (!navigator.onLine || sessionStorage.getItem("biblioteca-api-error") === "true") {
      throw new Error("No fue posible guardar el documento. Inténtalo nuevamente.");
    }

    const document = { ...data, id: edit ? "00001" : String(Date.now()), updatedAt: new Date().toISOString() };
    localStorage.setItem("biblioteca-ultimo-documento", JSON.stringify(document));
    return document;
  },

  async registerLoan(data: Record<string, string>) {
    await wait(900);
    ensureAvailable("No fue posible registrar el préstamo. Inténtalo nuevamente.");
    const now = new Date();
    const dueAt = new Date(now);
    if (data.loanType === "sala") dueAt.setHours(dueAt.getHours() + 2);
    else dueAt.setDate(dueAt.getDate() + 14);

    const receipt = {
      id: `PRE-${Date.now().toString().slice(-7)}`,
      ...data,
      registeredAt: now.toISOString(),
      dueAt: dueAt.toISOString(),
    };
    const previous = JSON.parse(localStorage.getItem("biblioteca-prestamos") ?? "[]") as object[];
    localStorage.setItem("biblioteca-prestamos", JSON.stringify([...previous, receipt]));
    return receipt;
  },

  async registerReturn(copyCode: string) {
    await wait(900);
    ensureAvailable("No fue posible registrar la devolución. Inténtalo nuevamente.");
    const returnedAt = new Date();
    const availableAt = new Date(returnedAt.getTime() + 30 * 60 * 1000);
    const lateDays = copyCode.trim().endsWith("7") ? 3 : 0;
    const result = {
      copyCode,
      returnedAt: returnedAt.toISOString(),
      availableAt: availableAt.toISOString(),
      lateDays,
      sanctionDays: lateDays > 0 ? lateDays * 2 : 0,
    };
    localStorage.setItem("biblioteca-ultima-devolucion", JSON.stringify(result));
    return result;
  },
};
