import { createServerFn } from "@tanstack/react-start";
import { getSql, rememberScribeKey } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Cue } from "@/lib/transcript";

type CueRow = Cue;

export const keyStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const rows = await sql<{ id: number }>`select id from scribe_secret where id = 1`;
    return { configured: rows.length > 0 };
  });

export const saveKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((key: string) => {
    const trimmed = key.trim();
    if (trimmed.length < 16 || trimmed.length > 400) {
      throw new Error("Esa clave no parece válida.");
    }
    return trimmed;
  })
  .handler(async ({ context, data: key }) => {
    if (!context.owner) {
      throw new Error("Solo la cuenta del diario puede cambiar la clave.");
    }
    const sql = await getSql();
    await sql`
      insert into scribe_secret (id, api_key, updated_by)
      values (1, ${key}, ${context.userId})
      on conflict (id) do update
        set api_key = excluded.api_key,
            updated_by = excluded.updated_by,
            updated_at = now()
    `;
    // La copia en disco solo existe en la vista previa de Grok. En Vercel no hay
    // carpeta donde escribir, y la clave ya quedó guardada en la base.
    const { isWorkspacePreview } = await import("@/lib/env.server");
    if (isWorkspacePreview()) await rememberScribeKey(key).catch(() => undefined);
    return { configured: true };
  });

export const mintScribeToken = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const rows = await sql<{ api_key: string }>`select api_key from scribe_secret where id = 1`;
    const apiKey = rows[0]?.api_key;
    if (!apiKey) throw new Error("Todavía no hay una clave de ElevenLabs configurada.");
    const response = await fetch("https://api.elevenlabs.io/v1/single-use-token/batch_scribe", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) {
      const detail = await response.text();
      // ElevenLabs responde 400 (no 401) cuando la clave tiene un formato inválido.
      if (response.status === 401 || response.status === 403 || /invalid_api_key/.test(detail)) {
        throw new Error("ElevenLabs rechazó la clave guardada. Hay que reemplazarla.");
      }
      if (response.status === 429) {
        throw new Error("ElevenLabs está limitando las peticiones. Espera un minuto y reintenta.");
      }
      throw new Error(
        `ElevenLabs no respondió bien (${response.status}). Intenta de nuevo en un momento.`,
      );
    }
    const payload = (await response.json()) as { token?: string };
    if (!payload.token) throw new Error("ElevenLabs no entregó un pase de un solo uso.");
    return { token: payload.token };
  });

export const listTranscripts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      title: string;
      duration_sec: number;
      created_at: string;
    }>`
      select id, title, duration_sec, created_at::text as created_at
      from transcripts
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      durationSec: Number(row.duration_sec) || 0,
      createdAt: String(row.created_at),
    }));
  });

export const getTranscript = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      title: string;
      duration_sec: number;
      words_json: string;
      names_json: string;
    }>`
      select id, title, duration_sec, words_json, names_json
      from transcripts
      where id = ${id} and user_id = ${context.userId}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      durationSec: Number(row.duration_sec) || 0,
      cues: JSON.parse(row.words_json) as CueRow[],
      names: JSON.parse(row.names_json) as Record<string, string>,
    };
  });

export const saveTranscript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { title: string; durationSec: number; cues: Cue[] }) => {
    if (!input || !Array.isArray(input.cues) || input.cues.length === 0) {
      throw new Error("No hay texto para guardar.");
    }
    if (input.cues.length > 30000) throw new Error("La transcripción es demasiado larga.");
    return {
      title: String(input.title || "Entrevista").trim().slice(0, 180),
      durationSec: Number(input.durationSec) || 0,
      cues: input.cues.map((cue) => ({
        speaker: String(cue.speaker || "speaker_0").slice(0, 40),
        start: Number(cue.start) || 0,
        end: Number(cue.end) || 0,
        text: String(cue.text || "").slice(0, 240),
      })),
    };
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = crypto.randomUUID();
    await sql`
      insert into transcripts (id, user_id, title, duration_sec, words_json, names_json)
      values (
        ${id},
        ${context.userId},
        ${data.title},
        ${data.durationSec},
        ${JSON.stringify(data.cues)},
        '{}'
      )
    `;
    return { id };
  });

export const updateTranscriptCues = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; cues: Cue[] }) => {
    if (!input || !Array.isArray(input.cues) || input.cues.length === 0) {
      throw new Error("No hay texto para guardar.");
    }
    if (input.cues.length > 30000) throw new Error("La transcripción es demasiado larga.");
    return {
      id: String(input.id || "").trim(),
      // Una frase corregida reúne varias palabras: el límite es por turno, no por palabra.
      cues: input.cues.map((cue) => ({
        speaker: String(cue.speaker || "speaker_0").slice(0, 40),
        start: Number(cue.start) || 0,
        end: Number(cue.end) || 0,
        text: String(cue.text || "").slice(0, 20000),
      })),
    };
  })
  .handler(async ({ context, data }) => {
    if (!data.id) return { ok: false };
    const sql = await getSql();
    await sql`
      update transcripts
      set words_json = ${JSON.stringify(data.cues)}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true };
  });

export const renameSpeakers = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; names: Record<string, string> }) => ({
    id: String(input.id || "").trim(),
    names: Object.fromEntries(
      Object.entries(input.names || {})
        .slice(0, 16)
        .map(([key, value]) => [String(key).slice(0, 40), String(value).slice(0, 80)]),
    ),
  }))
  .handler(async ({ context, data }) => {
    if (!data.id) return { ok: false };
    const sql = await getSql();
    await sql`
      update transcripts
      set names_json = ${JSON.stringify(data.names)}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true };
  });

export const deleteTranscript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from transcripts where id = ${id} and user_id = ${context.userId}`;
    return { ok: true };
  });
