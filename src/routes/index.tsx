import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn, signOut } from "@/lib/auth/client";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { TranscribeDesk } from "@/components/transcribe-desk";
import { TeamBox } from "@/components/team-box";
import { isOwnerEmail } from "@/lib/team";
import { teamAccess } from "@/lib/team-fns";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  const [kept, setKept] = useState(false);

  useEffect(() => {
    if (user) setKept(true);
  }, [user]);

  const showDesk = Boolean(user) || (kept && isPending);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary uppercase">Ahora · Huánuco</p>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink sm:text-5xl">
            Sala de transcripción
          </h1>
        </div>
        <UserButton />
      </header>
      {showDesk ? (
        <TeamOnly>
          <TeamBox />
          <TranscribeDesk />
        </TeamOnly>
      ) : isPending ? null : (
        <Lobby />
      )}
    </main>
  );
}

function GoogleButton({ className = "" }: { className?: string }) {
  const [error, setError] = useState("");
  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => {
          setError("");
          void signIn("grok-google", { callbackURL: "/" })
            .then(() => window.location.assign("/"))
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "No se pudo abrir Google.");
            });
        }}
        className="h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg"
      >
        Entrar con Google
      </button>
      {error && <p className="max-w-xs text-right text-xs text-primary">{error}</p>}
    </div>
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
        Estás con otra cuenta. Toca Entrar con Google y elige ahorahco@gmail.com. Si el navegador
        pregunta, permite la ventana emergente.
      </p>
      <GoogleButton className="mt-6 items-start" />
      <button
        type="button"
        onClick={() => signOut()}
        className="mt-3 h-11 rounded-xl border border-line px-4 text-sm"
      >
        Cerrar sesión
      </button>
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
            onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
            className="h-11 rounded-xl bg-primary text-sm font-medium text-primary-fg"
          >
            Continuar con {provider.label}
          </button>
        ))}
      </div>
    </section>
  );
}
