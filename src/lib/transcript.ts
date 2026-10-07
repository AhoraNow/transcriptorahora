export type RawWord = {
  text?: string;
  word?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
  speaker?: string;
};

export type Cue = {
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export type Turn = {
  speaker: string;
  start: number;
  end: number;
  text: string;
  cues: Cue[];
};

export type ScribePayload = {
  text?: string;
  words?: RawWord[];
  language_code?: string;
};

const SKIP = new Set(["audio_event"]);

export function toCues(words: RawWord[] | undefined): Cue[] {
  const cues: Cue[] = [];
  if (!words?.length) return cues;
  for (const token of words) {
    const kind = token.type ?? "word";
    const piece = token.text ?? token.word ?? "";
    if (!piece) continue;
    if (kind === "spacing") {
      const last = cues[cues.length - 1];
      if (last && !last.text.endsWith(" ") && !piece.startsWith(" ")) last.text += piece;
      else if (last) last.text += piece;
      continue;
    }
    if (SKIP.has(kind)) continue;
    cues.push({
      speaker: token.speaker_id || token.speaker || "speaker_0",
      start: token.start ?? 0,
      end: token.end ?? token.start ?? 0,
      text: piece,
    });
  }
  return cues.filter((cue) => cue.text.trim().length > 0);
}

export function cuesToTurns(cues: Cue[]): Turn[] {
  const turns: Turn[] = [];
  for (const cue of cues) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === cue.speaker) {
      last.cues.push(cue);
      last.end = cue.end;
      last.text = `${last.text} ${cue.text}`.replace(/\s+/g, " ").trim();
    } else {
      turns.push({
        speaker: cue.speaker,
        start: cue.start,
        end: cue.end,
        text: cue.text.trim(),
        cues: [cue],
      });
    }
  }
  return turns;
}

export function groupTurns(words: RawWord[] | undefined): Turn[] {
  return cuesToTurns(toCues(words));
}

export function speakerLabel(id: string, names: Record<string, string>): string {
  const custom = names[id]?.trim();
  if (custom) return custom;
  const n = Number(id.replace(/\D/g, ""));
  return Number.isFinite(n) ? `Voz ${n + 1}` : id;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function srtStamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function toPlainText(turns: Turn[], names: Record<string, string>): string {
  return turns
    .map((turn) => `[${formatClock(turn.start)}] ${speakerLabel(turn.speaker, names)}: ${turn.text}`)
    .join("\n\n");
}

export function toSrt(turns: Turn[], names: Record<string, string>): string {
  return turns
    .map((turn, i) => {
      const end = Math.max(turn.end, turn.start + 0.4);
      return `${i + 1}\n${srtStamp(turn.start)} --> ${srtStamp(end)}\n${speakerLabel(turn.speaker, names)}: ${turn.text}\n`;
    })
    .join("\n");
}

export function toWordHtml(turns: Turn[], names: Record<string, string>, title: string): string {
  const body = turns
    .map((turn) => {
      const who = escapeHtml(speakerLabel(turn.speaker, names));
      const when = escapeHtml(formatClock(turn.start));
      const text = escapeHtml(turn.text);
      return `<p><strong>${who}</strong> <span style="color:#6e675f">(${when})</span><br>${text}</p>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:Georgia,serif;line-height:1.5">${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "\\u0026amp;";
    if (ch === "<") return "\\u0026lt;";
    if (ch === ">") return "\\u0026gt;";
    return "\\u0026quot;";
  });
}

export const BAJAR_KEY = "ahora-bajar";

export function downloadText(filename: string, contents: string, mime: string): string {
  const safe =
    filename.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) ||
    "transcripcion.txt";
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safe;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
  return url;
}

export function copyPlain(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function copyRich(html: string): boolean {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = html;
  holder.style.position = "fixed";
  holder.style.top = "0";
  holder.style.left = "0";
  holder.style.opacity = "0";
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  holder.remove();
  return ok;
}

export function costUsd(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return (seconds / 3600) * 0.22;
}

export function readDuration(file: File): Promise<number> {
  const video = file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name);
  if (video || file.size > 15_000_000) return Promise.resolve(0);
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (value: number) => {
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 && value < 60 * 60 * 6 ? value : 0);
    };
    const timer = window.setTimeout(() => done(0), 4000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done(el.duration);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      done(0);
    };
    el.src = url;
  });
}
