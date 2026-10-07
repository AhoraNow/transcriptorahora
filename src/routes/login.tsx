import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <p className="text-xs font-medium tracking-widest text-primary uppercase">Ahora · Huánuco</p>
        <h1 className="mt-2 font-display text-4xl text-ink">Entrar a la sala</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Cada persona del diario usa su propia cuenta. La clave de transcripción no se muestra.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {authEnabled ? (
            GROK_PROVIDERS.map((provider) => (
              <button
                key={provider.providerId}
                type="button"
                onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
                className="h-11 rounded-xl bg-primary text-sm font-medium text-primary-fg"
              >
                Continuar con {provider.label}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted">El ingreso está desactivado.</p>
          )}
        </div>
      </div>
    </main>
  );
}
