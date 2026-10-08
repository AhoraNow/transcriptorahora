import { createServerFn } from "@tanstack/react-start";
import { getSql, rememberScribeKey } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Cue } from "@/lib/transcript";
import { toCues } from "@/lib/transcript";

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
    const sql = await getSql();
    await sql`
      insert into scribe_secret (id, api_key, updated_by)
      values (1, ${key}, ${context.userId})
      on conflict (id) do update
        set api_key = excluded.api_key,
            updated_by = excluded.updated_by,
            updated_at = now()
    `;
    await rememberScribeKey(key);
    return { configured: true };
  });

export const transcribeOnServer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: FormData) => {
    const file = data.get("file");
    if (!(file instanceof Blob) || file.size < 1000) {
      throw new Error("El archivo no llegó o está vacío.");
    }
    if (file.size > 250 * 1024 * 1024) {
      throw new Error("El archivo pasa de 250 MB. Bájalo de peso o recórtalo.");
    }
    const speakers = Number(data.get("speakers") || 0);
    const keyterms = String(data.get("keyterms") || "");
    const name = file instanceof File && file.name ? file.name : "audio.mp3";
    return { file, speakers: Number.isFinite(speakers) ? speakers : 0, keyterms, name };
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<{ api_key: string }>`select api_key from scribe_secret where id = 1`;
    const apiKey = rows[0]?.api_key?.trim();
    if (!apiKey) throw new Error("Todavía no hay una clave de ElevenLabs configurada.");

    const send = async (withTerms: boolean) => {
      const body = new FormData();
      body.append("model_id", "scribe_v2");
      body.append("file", data.file, data.name);
      body.append("language_code", "es");
      body.append("diarize", "true");
      body.append("timestamps_granularity", "word");
      body.append("tag_audio_events", "false");
      if (data.speakers > 0 && data.speakers <= 32) {
        body.append("num_speakers", String(Math.round(data.speakers)));
      }
      if (withTerms) {
        for (const term of data.keyterms.split(/[\n,;]+/)) {
          const clean = term.trim();
          if (clean.length >= 2 && clean.length < 50) body.append("keyterms", clean);
        }
      }
      return fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body,
      });
    };

    let response = await send(true);
    if ((response.status === 400 || response.status === 422) && data.keyterms.trim()) {
      response = await send(false);
    }
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 220);
      if (response.status === 401) {
        throw new Error("ElevenLabs rechazó la clave. Toca Reemplazar y pega una clave nueva.");
      }
      throw new Error(`ElevenLabs no transcribió (${response.status}). ${detail}`);
    }
    const payload = (await response.json()) as {
      text?: string;
      words?: Array<{
        text?: string;
        word?: string;
        start?: number;
        end?: number;
        type?: string;
        speaker_id?: string;
        speaker?: string;
      }>;
    };
    const cues = toCues(payload.words);
    if (cues.length === 0 && payload.text?.trim()) {
      return { cues: [{ speaker: "speaker_0", start: 0, end: 0, text: payload.text.trim() }] };
    }
    if (cues.length === 0) {
      throw new Error("ElevenLabs no devolvió texto. Revisa que el archivo tenga voz.");
    }
    return { cues };
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
      const detail = (await response.text()).slice(0, 180);
      if (response.status === 401) {
        throw new Error("ElevenLabs rechazó la clave guardada. Hay que reemplazarla.");
      }
      throw new Error(`No se pudo preparar la transcripción. ${detail}`);
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
