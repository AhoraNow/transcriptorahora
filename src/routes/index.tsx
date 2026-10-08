import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authClient, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { TranscribeDesk } from "@/components/transcribe-desk";
import { TeamBox } from "@/components/team-box";
import { isOwnerEmail } from "@/lib/team";
import { teamAccess } from "@/lib/team-fns";

export const Route = createFileRoute("/")({ component: Home });

const LEAVING_KEY = "ahora-saliendo";

/**
 * Salir de la sala. Detrás del gate de Grok la sesión vuelve sola en la
 * siguiente carga con la cuenta abierta en Grok, así que no basta con cerrar
 * sesión: dejamos una marca para explicar cómo entrar con otro correo.
 */
function leaveRoom() {
  try {
    sessionStorage.setItem(LEAVING_KEY, "1");
  } catch {
    // Sin almacenamiento solo se pierde el aviso.
  }
  void signOut().catch(() => window.location.assign("/"));
}

/**
 * Después de entrar con Google o por el gate, la primera lectura de la sesión
 * puede llegar antes que la cookie y quedarse en "Entrar". Se vuelve a leer
 * unas veces y cada vez que la pestaña recupera el foco.
 */
function useSessionCatchUp(signedOut: boolean) {
  useEffect(() => {
    if (!signedOut) return;
    let stopped = false;
    const refresh = () => {
      // Señal de Better Auth: vuelve a pedir la sesión y actualiza useSession.
      if (!stopped) authClient.$store.notify("$sessionSignal");
    };
    const timers = [400, 1500, 4000].map((ms) => window.setTimeout(refresh, ms));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [signedOut]);
}

function AccountBar() {
  const { user } = useCurrentUserState();
  const [leaving, setLeaving] = useState(false);
  if (!user) return null;
  const label = user.primaryEmail ?? user.displayName ?? "Cuenta";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="font-medium text-ink">{label}</span>
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          leaveRoom();
        }}
        className="h-11 rounded-xl border border-line px-3 text-sm disabled:opacity-50"
      >
        {leaving ? "Saliendo…" : "Salir"}
      </button>
    </div>
  );
}

function StillInsideNotice() {
  const { user } = useCurrentUserState();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!user) return;
    try {
      if (sessionStorage.getItem(LEAVING_KEY)) {
        sessionStorage.removeItem(LEAVING_KEY);
        setShow(true);
      }
    } catch {
      // Sin almacenamiento no hay aviso.
    }
  }, [user]);
  if (!show || !user) return null;
  return (
    <div role="status" className="mt-6 rounded-xl border border-line bg-surface p-4 text-sm leading-relaxed">
      <p className="font-medium text-ink">Sigues dentro con {user.primaryEmail ?? "tu cuenta"}.</p>
      <p className="mt-1 text-muted">
        La sala usa la cuenta con la que entraste a Grok en este navegador, y vuelve a entrar sola. Para
        usar otro correo, abre una ventana privada (Ctrl+Shift+N o Cmd+Shift+N) y entra ahí con ese
        correo, o cierra sesión en grok.com.
      </p>
      <button type="button" onClick={() => setShow(false)} className="mt-2 h-11 text-sm text-primary">
        Entendido
      </button>
    </div>
  );
}

function Home() {
  const { user, isPending } = useCurrentUserState();
  const [kept, setKept] = useState(false);
  useSessionCatchUp(!isPending && !user);

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
        <AccountBar />
      </header>
      <StillInsideNotice />
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
        Entraste con {user.primaryEmail ?? "otra cuenta"}, que no está en Equipo. Pide a la cuenta
        del diario que te agregue. Si querías entrar con ahorahco@gmail.com, abre una ventana privada y
        entra ahí con ese correo.
      </p>
      <GoogleButton className="mt-6 items-start" />
      <button
        type="button"
        onClick={() => leaveRoom()}
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
