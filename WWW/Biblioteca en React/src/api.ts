/** Solo se llama al gateway del mismo origen. Nunca se conecta React con Oracle. */
export type DocumentType = "BOOK" | "TECHNICAL" | "AUDIO" | "VIDEO";
export type Medium = "PAPER" | "CASSETTE" | "CD" | "DVD" | "BLURAY" | "DIGITAL";
export type Role = "LIBRARIAN" | "ADMIN" | "READER";
export interface Session { token: string; id: string; role: Role; expiresAt: string }
export interface Copy { id: string; state: string; shelf: string; dueAt?: string; readyAt?: string }
export interface Document {
  id: string; title: string; author: string; type: DocumentType; medium: Medium;
  publisher: string; edition: string; year: number; shelf: string; category: string;
  homeDays: number; roomHours: number; description?: string; state: string;
  total: number; available: number; inRoom: number; copies: Copy[];
}
export type DocumentInput = Pick<Document, "title" | "author" | "type" | "medium" | "publisher" | "edition" | "year" | "shelf" | "category" | "homeDays" | "roomHours"> & {
  description: string; stock: number;
};
export interface Page<T> { items: T[]; total: number; page?: number; size?: number }
export interface LoanRequest {
  id: string; ownerId: string; state: string; mode: "HOME" | "ROOM"; createdAt: string; expiresAt?: string;
  items?: { copyId: string; documentId?: string; title: string; shelf: string; homeDays?: number; roomHours?: number }[];
  copyIds?: string[];
}
export interface LoanItem {
  copyId: string; documentId: string; title: string; shelf?: string; dueAt?: string;
  state?: string; returnedAt?: string; readyAt?: string;
  document?: { id: string; author: string; category: string; available: number };
}
export interface Loan {
  id: string; requestId: string; ownerId: string; mode: "HOME" | "ROOM"; state: string;
  preparedAt?: string; issuedAt?: string; dueAt?: string; items: LoanItem[];
  assessment?: { amount: number; currency: string; state: string } | null;
}
export interface Reservation {
  id: string; ownerId: string; state: string; copyId: string; date: string;
  mode: "HOME" | "ROOM"; createdAt: string;
}
export interface Reader {
  id: string; state: "ACTIVE" | "INACTIVE"; names: string; surnames: string;
  photo?: string; rut?: string; email?: string; address?: string; telephone?: string;
  documentsChecked?: boolean;
}
export interface ReaderInput {
  rut: string; names: string; surnames: string; address: string; email: string;
  telephone: string; password: string; fingerprint: string; photo: string; documentsChecked: boolean;
}
export interface ReturnResult {
  id: string; loanId: string; copyId: string; returnedAt: string; state: string;
  late: boolean; sanctionUntil: string | null; readyAt: string;
}
export interface ExitCheck { copyId: string; allowExit: boolean; adapter: string }
export interface Receipt {
  id: string; loanId: string; readerId: string; issuedAt: string;
  items: LoanItem[]; amount: number; currency: string;
}
export interface OverdueItem { readerId: string; copyId: string; title: string; dueAt: string }
export interface MailMessage { id: string; to: string; subject: string; text: string; createdAt: string }
export interface GraphQLIssue { message: string; path?: (string | number)[]; extensions?: { code?: string } }
export interface GraphQLResponse<T> { data?: T | null; errors?: GraphQLIssue[] }
export interface Account {
  reader: Reader; loans: Loan[]; reservations: Reservation[]; totalLoans: number;
  page: number; hasMore: boolean; sanctionUntil: string | null;
}
export interface OverduePage extends Page<OverdueItem> {}
export interface MailboxPage extends Page<MailMessage> { adapter?: string }
export interface Filters {
  q: string; title: string; author: string; type: string;
  publisher: string; availability: string; subcategory: string;
}
export const emptyFilters: Filters = { q: "", title: "", author: "", type: "", publisher: "", availability: "", subcategory: "" };
export const typeNames: Record<DocumentType, string> = { BOOK: "Libro", TECHNICAL: "Documento técnico", AUDIO: "Multimedia · Audio", VIDEO: "Multimedia · Video" };
export const mediumNames: Record<Medium, string> = { PAPER: "Papel", CASSETTE: "Casete", CD: "CD", DVD: "DVD", BLURAY: "Blu-ray", DIGITAL: "Digital" };

let bearer: string | null = null;
export function setBearer(value: string | null) { bearer = value; }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId?: string) {
    super(message); this.name = "ApiError";
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}
export async function api<T>(path: string, options: {
  method?: string; body?: unknown; signal?: AbortSignal; idempotencyKey?: string;
} = {}): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("Solo se permiten rutas del API Gateway.");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if ((bearer || options.body !== undefined) && window.location.protocol !== "https:") {
    throw new Error("Abre el frontend mediante HTTPS antes de ingresar o modificar datos.");
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? "GET", headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal, cache: "no-store", credentials: "omit" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("No se pudo contactar al backend. Revisa que el gateway esté iniciado y su certificado sea válido.");
  }
  let data: unknown;
  try { data = await response.json(); } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "El gateway no devolvió JSON válido. Comprueba la configuración del proxy.");
  }
  if (!response.ok) {
    const problem = (data as { error?: { code?: string; message?: string; correlationId?: string } })?.error;
    if (response.status === 401 && path !== "/api/auth/login") {
      setBearer(null); window.dispatchEvent(new Event("bec:session-expired"));
    }
    throw new ApiError(response.status, problem?.code ?? "REQUEST_FAILED", problem?.message ?? "No se pudo realizar la acción.", problem?.correlationId);
  }
  return data as T;
}
export function catalogueUrl(filters: Filters, page: number) {
  const query = new URLSearchParams({ page: String(page), size: "10" });
  Object.entries(filters).forEach(([key, value]) => { if (value.trim()) query.set(key, value.trim()); });
  return `/api/catalog?${query}`;
}
export function go(name: string, id?: string) {
  window.location.hash = id ? `${name}/${encodeURIComponent(id)}` : name;
}
export function statusName(document: Document) {
  return document.available > 0 ? "Disponible" : "No disponible";
}
