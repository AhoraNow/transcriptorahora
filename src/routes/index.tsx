import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { TranscribeDesk } from "@/components/transcribe-desk";
import { TeamBox } from "@/components/team-box";
import { isOwnerEmail } from "@/lib/team";
import { teamAccess } from "@/lib/team-fns";

export const Route = createFileRoute("/")({ component: Home });

/**
 * Después de entrar, la primera lectura de la sesión puede llegar antes que
 * la cookie del gate. Se vuelve a pedir UNA sola vez por carga; nunca en bucle,
 * porque cada lectura pone la sesión en "cargando" un instante.
 */
function useSessionCatchUp(signedOut: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!signedOut || done.current) return;
    done.current = true;
    const id = window.setTimeout(() => authClient.$store.notify("$sessionSignal"), 1500);
    return () => window.clearTimeout(id);
  }, [signedOut]);
}

/**
 * La sala usa la cuenta con la que se entró a Grok en este navegador, y el
 * gate la vuelve a abrir sola: cerrar sesión aquí no sirve. En vez de un botón
 * que no hace nada, se explica cómo usar otro correo.
 */
const OTHER_ACCOUNT_HINT =
  "La sala usa la cuenta con la que entraste a Grok en este navegador y vuelve a entrar sola. " +
  "Para usar otro correo, abre una ventana privada (Ctrl+Shift+N o Cmd+Shift+N) y entra ahí " +
  "con ese correo, o cierra sesión en grok.com.";

function AccountBar() {
  const { user } = useCurrentUserState();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const label = user.primaryEmail ?? user.displayName ?? "Cuenta";
  return (
    <div className="flex max-w-sm flex-col items-end gap-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="font-medium text-ink">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="h-11 rounded-xl border border-line px-3 text-sm"
        >
          Otro correo
        </button>
      </div>
      {open && <p className="text-right text-xs leading-relaxed text-muted">{OTHER_ACCOUNT_HINT}</p>}
    </div>
  );
}

function Home() {
  const { user, isPending } = useCurrentUserState();
  const [kept, setKept] = useState(false);
  // Una vez que se sabe si hay sesión, una relectura (isPending un instante)
  // no debe vaciar la pantalla: eso era el parpadeo.
  const [resolved, setResolved] = useState(false);
  useSessionCatchUp(resolved && !user);

  useEffect(() => {
    if (user) setKept(true);
  }, [user]);
  useEffect(() => {
    if (!isPending) setResolved(true);
  }, [isPending]);

  const showDesk = Boolean(user) || kept;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">Ahora · Huánuco</p>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink sm:text-5xl">
            Sala de transcripción
          </h1>
        </div>
        <AccountBar />
      </header>
      {showDesk ? (
        <TeamOnly>
          <TeamBox />
          <TranscribeDesk />
        </TeamOnly>
      ) : resolved ? (
        <Lobby />
      ) : null}
    </main>
  );
}

function TeamOnly({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [access, setAccess] = useState<"pending" | "yes" | "no">("pending");

  const userId = user?.id ?? "";

  useEffect(() => {
    if (!userId) return;
    if (isOwnerEmail(user?.primaryEmail)) {
      setAccess("yes");
      return;
    }
    let cancelled = false;
    teamAccess()
      .then(() => {
        if (!cancelled) setAccess("yes");
      })
      .catch(() => {
        if (!cancelled) setAccess("no");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, user?.primaryEmail]);

  if (access === "yes") return children;
  if (isPending || !user || access === "pending") return null;
  return (
    <section className="mt-8 max-w-lg">
      <p className="text-base leading-relaxed text-ink">Esta cuenta no está autorizada.</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Entraste con {user.primaryEmail ?? "otra cuenta"}, que no está en Equipo. Pide a la cuenta
        del diario que te agregue.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-muted">{OTHER_ACCOUNT_HINT}</p>
    </section>
  );
}

function Lobby() {
  return (
    <section className="mt-8 max-w-lg">
      <p className="text-base leading-relaxed text-muted">
        Entra con Google. Solo trabaja quien el diario agregó a Equipo. Nadie ve la clave.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {GROK_PROVIDERS.filter((provider) => provider.providerId === "grok-google").map((provider) => (
          <button
            key={provider.providerId}
            type="button"
            onClick={() =>
              void signIn(provider.providerId, { callbackURL: "/" })
                .then(() => window.location.assign("/"))
                .catch(() => undefined)
            }
            className="h-11 rounded-xl bg-primary text-sm font-medium text-primary-fg"
          >
            Continuar con {provider.label}
          </button>
        ))}
      </div>
    </section>
  );
}
