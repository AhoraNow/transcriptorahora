import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { isOwnerEmail, normalizeEmail } from "@/lib/team";

function requireOwner(context: { email: string; gateOwner: boolean }) {
  if (context.gateOwner || isOwnerEmail(context.email)) return;
  throw new Error("Solo la cuenta del diario puede cambiar el equipo.");
}

export const teamAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return { owner: context.gateOwner || isOwnerEmail(context.email) };
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    requireOwner(context);
    const sql = await getSql();
    const rows = await sql<{ email: string }>`select email from team_member order by email`;
    return rows.map((row) => row.email);
  });

export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((email: string) => {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 180) {
      throw new Error("Ese correo no parece válido.");
    }
    if (isOwnerEmail(normalized)) throw new Error("Tu cuenta ya entra siempre. Agrega la de otra persona.");
    return normalized;
  })
  .handler(async ({ context, data: email }) => {
    requireOwner(context);
    const sql = await getSql();
    const count = await sql<{ n: number }>`select count(*)::int as n from team_member`;
    if (Number(count[0]?.n ?? 0) >= 40) throw new Error("Ya hay demasiadas personas en el equipo.");
    await sql`
      insert into team_member (email)
      values (${email})
      on conflict (email) do nothing
    `;
    return { email };
  });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((email: string) => normalizeEmail(email))
  .handler(async ({ context, data: email }) => {
    requireOwner(context);
    const sql = await getSql();
    await sql`delete from team_member where email = ${email}`;
    return { email };
  });
