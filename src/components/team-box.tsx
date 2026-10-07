import { useEffect, useState } from "react";
import { addTeamMember, listTeam, removeTeamMember, teamAccess } from "@/lib/team-fns";

export function TeamBox() {
  const [owner, setOwner] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    teamAccess()
      .then(async (access) => {
        if (cancelled || !access.owner) return;
        setOwner(true);
        const people = await listTeam();
        if (!cancelled) setEmails(people);
      })
      .catch(() => {
        if (!cancelled) setNote("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!owner) return null;

  async function add() {
    setNote("");
    try {
      const saved = await addTeamMember({ data: draft });
      setEmails((current) => (current.includes(saved.email) ? current : [...current, saved.email].sort()));
      setDraft("");
      setNote("Listo. Esa persona entra con Google usando ese correo.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "No se pudo agregar.");
    }
  }

  async function remove(email: string) {
    setNote("");
    try {
      await removeTeamMember({ data: email });
      setEmails((current) => current.filter((item) => item !== email));
    } catch (err) {
      setNote(err instanceof Error ? err.message : "No se pudo quitar.");
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl text-ink">Equipo</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Escribe el Gmail de cada persona. Solo esas cuentas pueden transcribir. No ven la clave.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="nombre@gmail.com"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm"
        />
        <button
          type="button"
          onClick={() => void add()}
          className="h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          Agregar
        </button>
      </div>
      {note && <p className="mt-3 text-sm text-ink">{note}</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {emails.map((email) => (
          <li key={email} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{email}</span>
            <button type="button" onClick={() => void remove(email)} className="h-9 shrink-0 rounded-lg px-2 text-muted">
              Quitar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
