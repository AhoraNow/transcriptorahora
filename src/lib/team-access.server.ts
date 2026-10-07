import { getSql } from "@/lib/db";
import { isOwnerEmail, normalizeEmail } from "@/lib/team";

export async function assertOnTeam(email: string | null): Promise<void> {
  if (isOwnerEmail(email)) return;
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("Esta cuenta no está autorizada.");
  const sql = await getSql();
  const rows = await sql<{ email: string }>`select email from team_member where email = ${normalized}`;
  if (rows.length === 0) throw new Error("Esta cuenta no está autorizada.");
}
