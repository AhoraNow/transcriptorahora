import { toCues, type Cue, type ScribePayload } from "@/lib/transcript";

export async function transcribeWithScribe(options: {
  file: File;
  token: string;
  speakers: number | null;
  keyterms: string[];
  signal?: AbortSignal;
}): Promise<{ cues: Cue[] }> {
  const body = new FormData();
  body.append("model_id", "scribe_v2");
  body.append("file", options.file);
  body.append("language_code", "es");
  body.append("diarize", "true");
  body.append("timestamps_granularity", "word");
  body.append("tag_audio_events", "false");
  if (options.speakers && options.speakers > 0) {
    body.append("num_speakers", String(options.speakers));
  }
  for (const term of options.keyterms) body.append("keyterms", term);

  const url = `https://api.elevenlabs.io/v1/speech-to-text?token=${encodeURIComponent(options.token)}`;
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body, signal: options.signal });
  } catch {
    throw new Error("No se pudo conectar con ElevenLabs. Revisa la conexión y vuelve a intentar.");
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(friendlyApiError(response.status, detail));
  }

  const payload = (await response.json()) as ScribePayload;
  const cues = toCues(payload.words);
  if (cues.length === 0 && payload.text?.trim()) {
    return { cues: [{ speaker: "speaker_0", start: 0, end: 0, text: payload.text.trim() }] };
  }
  if (cues.length === 0) {
    throw new Error("ElevenLabs no devolvió texto. Revisa que el archivo tenga voz.");
  }
  return { cues };
}

function friendlyApiError(status: number, detail: string): string {
  if (status === 401 || status === 403) {
    return "El pase de transcripción venció o la clave no tiene permiso. Intenta de nuevo.";
  }
  if (status === 429) return "ElevenLabs limitó las peticiones. Espera un momento y reintenta.";
  const compact = detail.replace(/\s+/g, " ").slice(0, 280);
  if (status === 400 || status === 422) return `ElevenLabs rechazó el archivo. ${compact}`;
  return `Error ${status} de ElevenLabs. ${compact}`;
}

export function parseKeyterms(raw: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const term = part.trim();
    if (term.length < 2 || term.length > 49) continue;
    const key = term.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= 40) break;
  }
  return terms;
}
