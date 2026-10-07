export const OWNER_EMAIL = "ahorahco@gmail.com";

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  return normalizeEmail(email) === OWNER_EMAIL;
}
