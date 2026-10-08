export const OWNER_EMAIL = "ahorahco@gmail.com";

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export type Access = "owner" | "check-team" | "denied";

/**
 * Quién puede entrar. Solo el correo del diario es dueño; cualquier otro
 * correo tiene que estar en Equipo. Pasar por el gate de Grok NO da acceso:
 * el gate deja entrar a cualquier cuenta que abra el enlace publicado.
 * La única excepción es la vista previa de Grok, que solo ve quien edita.
 */
export function accessFor(input: { preview: boolean; signedIn: boolean; email: string | null }): Access {
  if (!input.signedIn) return "denied";
  if (input.preview) return "owner";
  if (isOwnerEmail(input.email)) return "owner";
  return normalizeEmail(input.email) ? "check-team" : "denied";
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return normalizeEmail(email) === OWNER_EMAIL;
}
