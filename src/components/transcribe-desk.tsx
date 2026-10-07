import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileAudio, Film, LoaderCircle, Pause, Play, Trash2, Upload } from "lucide-react";
import { dropAudio, loadAudio, saveAudio } from "@/lib/audio-cache";
import { transcribeWithScribe } from "@/lib/scribe";
import {
  deleteTranscript,
  getTranscript,
  keyStatus,
  listTranscripts,
  mintScribeToken,
  renameSpeakers,
  saveKey,
  saveTranscript,
} from "@/lib/scribe-fns";
import { teamAccess } from "@/lib/team-fns";
import {
  copyPlain,
  copyRich,
  costUsd,
  cuesToTurns,
  formatClock,
  readDuration,
  speakerLabel,
  toPlainText,
  toSrt,
  toWordHtml,
  type Cue,
} from "@/lib/transcript";

const DEFAULT_TERMS =
  "Huánuco, Pillco Marca, Ambo, Tingo María, Leoncio Prado, Gorehco, Gobierno Regional";

type Job = { id: string; title: string; durationSec: number; createdAt: string };
type Phase = "idle" | "extracting" | "sending" | "done";

const SPEAKER_COLORS = [
  "bg-[#8f1d2c] text-white",
  "bg-[#1d4e63] text-white",
  "bg-[#8a5a12] text-white",
  "bg-[#2c5a3c] text-white",
  "bg-[#3d3a78] text-white",
  "bg-[#6d3b55] text-white",
];

const BAR_HEX = ["#8f1d2c", "#1d4e63", "#8a5a12", "#2c5a3c", "#3d3a78", "#6d3b55"];

const NAMES_KEY = "ahora-speaker-names";
const LAST_KEY = "ahora-last-transcript";

function rememberTranscript(title: string, cues: Cue[], names: Record<string, string>) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ title, cues, names }));
  } catch {
    // Si el navegador no puede guardar, el texto igual queda en pantalla.
  }
}

function recallTranscript(): { title: string; cues: Cue[]; names: Record<string, string> } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { title?: string; cues?: Cue[]; names?: Record<string, string> };
    if (!data.cues?.length) return null;
    return { title: data.title || "Transcripción", cues: data.cues, names: data.names ?? {} };
  } catch {
    return null;
  }
}

export function TranscribeDesk() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [owner, setOwner] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [speakers, setSpeakers] = useState(0);
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [cues, setCues] = useState<Cue[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [exportFile, setExportFile] = useState<{
    href: string;
    name: string;
    text: string;
    note: string;
  } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [focusSpeaker, setFocusSpeaker] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLVideoElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const cancelRef = useRef<{ cancelled: boolean; abort?: AbortController }>({ cancelled: false });
  const urlRef = useRef<string | null>(null);
  const renameTimer = useRef(0);
  const editTimer = useRef(0);

  const turns = useMemo(() => cuesToTurns(cues), [cues]);
  const speakerIds = useMemo(() => {
    const ids: string[] = [];
    for (const cue of cues) if (!ids.includes(cue.speaker)) ids.push(cue.speaker);
    return ids;
  }, [cues]);
  const activeIndex = useMemo(() => {
    if (cues.length === 0) return -1;
    let found = -1;
    for (let i = 0; i < cues.length; i++) {
      if (cues[i].start <= now + 0.05) found = i;
      else break;
    }
    return found;
  }, [cues, now]);

  const busy = phase === "extracting" || phase === "sending";
  const estimate = costUsd(duration);

  useEffect(() => {
    const saved = recallTranscript();
    if (saved) {
      setCues(saved.cues);
      setNames(saved.names);
      setTitle(saved.title);
      setPhase("done");
    }
    try {
      const raw = localStorage.getItem(NAMES_KEY);
      if (raw) setNames(JSON.parse(raw) as Record<string, string>);
    } catch {
      // El nombre se sigue pudiendo escribir aunque el navegador no lo recuerde.
    }
    void loadAudio("current").then((blob) => {
      if (blob) setPlayback(blob);
    });
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (urlRef.current && el.getAttribute("src") !== urlRef.current) el.src = urlRef.current;
    let frame = 0;
    const tick = () => {
      setNow(el.currentTime);
      if (!el.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame);
      setNow(el.currentTime);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", tick);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (activeIndex < 0 || !playing) return;
    document.getElementById(`cue-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, playing]);

  function setPlayback(blob: Blob | null) {
    blobRef.current = blob;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = blob ? URL.createObjectURL(blob) : null;
    setAudioUrl(urlRef.current);
    setPlaying(false);
    setNow(0);
    const el = audioRef.current;
    if (el && urlRef.current) el.src = urlRef.current;
  }

  function attachSrc(el: HTMLVideoElement): boolean {
    const blob = blobRef.current ?? file;
    if (!blob) return false;
    if (!urlRef.current) {
      urlRef.current = URL.createObjectURL(blob);
      blobRef.current = blob;
      setAudioUrl(urlRef.current);
    }
    if (el.getAttribute("src") !== urlRef.current) el.src = urlRef.current;
    el.muted = false;
    el.volume = 1;
    return true;
  }

  async function refreshMeta() {
    try {
      const statusRow = await keyStatus();
      setConfigured(statusRow.configured);
      const access = await teamAccess();
      setOwner(access.owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la sala.");
    }
    try {
      setJobs(await listTranscripts());
    } catch {
      // El historial puede fallar sin volver a pedir la clave.
    }
  }

  async function takeFile(next: File | null) {
    setFile(next);
    setError("");
    setDuration(0);
    setPlayback(next);
    if (next) void saveAudio("current", next);
    if (!next) return;
    setDuration(await readDuration(next));
  }

  function playFrom(seconds: number) {
    const el = audioRef.current;
    if (!el || !attachSrc(el)) {
      setError("Suelta de nuevo el audio para escucharlo.");
      setStatus("No hay audio cargado.");
      return;
    }
    const at = Math.max(0, seconds);
    if (el.readyState >= 1) el.currentTime = at;
    else el.addEventListener("loadedmetadata", () => { el.currentTime = at; }, { once: true });
    setError("");
    void el.play().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "sin permiso";
      setError(`No sonó: ${message}`);
      setStatus(`No sonó: ${message}`);
    });
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el || !attachSrc(el)) {
      setError("Suelta de nuevo el audio para escucharlo.");
      setStatus("No hay audio cargado.");
      return;
    }
    if (!el.paused) {
      el.pause();
      return;
    }
    setError("");
    void el.play().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "sin permiso";
      setError(`No sonó: ${message}`);
      setStatus(`No sonó: ${message}`);
    });
  }

  function cancelJob() {
    cancelRef.current.cancelled = true;
    cancelRef.current.abort?.abort();
    setPhase("idle");
    setStatus("Cancelado.");
    setProgress(0);
  }

  async function run() {
    if (!file) {
      setError("Elige un audio o un video.");
      return;
    }
    setError("");
    setCues([]);
    setNames({});
    setFocusSpeaker(null);
    cancelRef.current = { cancelled: false };
    const gate = cancelRef.current;

    try {
      setPhase("sending");
      setStatus("Transcribiendo. Un audio largo puede tardar unos minutos. No cierres esta página.");
      const minted = await mintScribeToken();
      if (gate.cancelled) return;
      const result = await transcribeWithScribe({
        file,
        token: minted.token,
        speakers: speakers > 0 ? speakers : null,
        keyterms: terms
          .split(/[\n,;]+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 2 && term.length < 50)
          .slice(0, 40),
      });
      if (gate.cancelled) return;

      rememberTranscript(file.name, result.cues, {});
      setCues(result.cues);
      setNames({});
      setTitle(file.name);
      setPlayback(file);
      setPhase("done");
      setStatus("Listo. Escribe el nombre de cada voz arriba del texto.");
      try {
        const saved = await saveTranscript({
          data: { title: file.name, durationSec: duration, cues: result.cues },
        });
        setActiveId(saved.id);
        setJobs((prev) => [
          { id: saved.id, title: file.name, durationSec: duration, createdAt: new Date().toISOString() },
          ...prev.filter((job) => job.id !== saved.id),
        ]);
      } catch (err) {
        setStatus(
          err instanceof Error
            ? `El texto ya está en pantalla. No se pudo guardar el historial: ${err.message}`
            : "El texto ya está en pantalla.",
        );
      }
    } catch (err) {
      if (gate.cancelled) return;
      setPhase("idle");
      setStatus("");
      setError(err instanceof Error ? err.message : "No se pudo transcribir.");
    }
  }

  async function openJob(job: Job) {
    setError("");
    const row = await getTranscript({ data: job.id });
    if (!row) return;
    setCues(row.cues);
    setNames(row.names);
    setActiveId(row.id);
    setTitle(row.title);
    setPhase("done");
    setFocusSpeaker(null);
    setStatus(row.title);
  }

  async function attachAudio(next: File | null) {
    if (!next || !activeId) return;
    await saveAudio(activeId, next);
    setPlayback(next);
    setStatus("Audio listo. Haz clic en una frase para oírla.");
  }

  function editTurn(speaker: string, start: number, value: string) {
    setCues((current) => {
      const startIndex = current.findIndex((cue) => cue.speaker === speaker && cue.start === start);
      if (startIndex < 0) return current;
      let endIndex = startIndex;
      while (endIndex + 1 < current.length && current[endIndex + 1].speaker === speaker) endIndex += 1;
      const next = [
        ...current.slice(0, startIndex),
        { speaker, start, end: current[endIndex].end, text: value },
        ...current.slice(endIndex + 1),
      ];
      window.clearTimeout(editTimer.current);
      editTimer.current = window.setTimeout(() => {
        rememberTranscript(title || "Transcripción", next, names);
      }, 900);
      return next;
    });
  }
  function rename(id: string, value: string) {
    const next = { ...names, [id]: value };
    setNames(next);
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(next));
    } catch {
      // Escribir el nombre no debe recargar la página.
    }
    if (!activeId) return;
    window.clearTimeout(renameTimer.current);
    renameTimer.current = window.setTimeout(() => {
      void renameSpeakers({ data: { id: activeId, names: next } }).catch(() => undefined);
    }, 800);
  }

  async function removeJob(id: string) {
    await deleteTranscript({ data: id });
    await dropAudio(id);
    setJobs((prev) => prev.filter((job) => job.id !== id));
    if (activeId === id) {
      setCues([]);
      setActiveId(null);
      setPlayback(null);
    }
  }

  async function storeKey() {
    try {
      await saveKey({ data: keyDraft });
      setKeyDraft("");
      setConfigured(true);
      setReplacingKey(false);
      setError("");
      setStatus("Clave guardada. El equipo no puede verla.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se guardó la clave.");
    }
  }

  function saveExport(kind: "txt" | "doc" | "srt") {
    if (turns.length === 0) return;
    const base = (title || "transcripcion").replace(/\.[^.]+$/, "") || "transcripcion";
    const plain = toPlainText(turns, names);
    const srt = toSrt(turns, names);
    const item =
      kind === "txt"
        ? { name: `${base}.txt`, payload: `\uFEFF${plain}`, plain }
        : kind === "doc"
          ? { name: `${base}.doc`, payload: toWordHtml(turns, names, base), plain }
          : { name: `${base}.srt`, payload: `\uFEFF${srt}`, plain: srt };
    const url = URL.createObjectURL(new Blob([item.payload], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
    const copied = kind === "doc" ? copyRich(toWordHtml(turns, names, item.name)) : copyPlain(item.plain);
    setExportFile({
      href: url,
      name: item.name,
      text: item.plain,
      note: copied
        ? `${item.name} va a Descargas. Si no aparece, el texto ya está copiado: pégalo en Word.`
        : `${item.name} va a Descargas. Si no aparece, selecciona el texto de abajo.`,
    });
    setStatus(`${item.name} se está guardando en Descargas.`);
  }

  const showKeyForm = owner && (configured === false || replacingKey);

  return (
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[340px_1fr]">
      <section className="flex max-h-[calc(100vh-2rem)] flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-4">
        <div className="rounded-xl bg-bg px-3 py-3 text-sm leading-relaxed text-muted">
          Las voces se detectan solas. Un clic en una frase la resalta y la reproduce.
        </div>

        {showKeyForm ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Clave de ElevenLabs. Se registra una sola vez.</span>
            <input
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              placeholder="Pégala aquí. No se vuelve a mostrar."
              className="h-11 rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void storeKey()}
              disabled={keyDraft.trim().length < 16}
              className="h-11 rounded-xl bg-ink text-sm font-medium text-bg disabled:opacity-40"
            >
              Guardar clave
            </button>
          </div>
        ) : owner && configured ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Clave guardada. No se vuelve a pedir.</span>
            <button type="button" onClick={() => setReplacingKey(true)} className="h-11 text-sm text-primary">
              Reemplazar
            </button>
          </div>
        ) : configured === false ? (
          <p className="text-sm text-muted">La clave la registra el diario una sola vez. Todavía no está lista.</p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Voces</span>
            <select
              value={speakers}
              onChange={(event) => setSpeakers(Number(event.target.value))}
              className="h-11 rounded-xl border border-line bg-bg px-3 text-sm"
            >
              <option value={0}>Detectar solas</option>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  Forzar {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col justify-end rounded-xl bg-bg px-3 py-2">
            <span className="text-xs text-muted">Costo estimado</span>
            <span className="font-display text-2xl">{duration > 0 ? `US$${estimate.toFixed(2)}` : "—"}</span>
            <span className="text-xs text-muted">{duration > 0 ? formatClock(duration) : "según la duración"}</span>
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Nombres y lugares</span>
          <textarea
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            rows={3}
            className="rounded-xl border border-line bg-bg px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary"
          />
        </label>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) void takeFile(dropped);
          }}
          className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-center ${
            dragOver ? "border-primary bg-bg" : "border-line bg-bg"
          }`}
        >
          <Upload className="size-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-medium">{file ? file.name : "Suelta audio o video"}</span>
          <span className="text-xs text-muted">MP3, WAV, M4A, MP4, MOV, WEBM</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.mp4,.mov,.mkv"
          className="hidden"
          onChange={(event) => void takeFile(event.target.files?.[0] ?? null)}
        />

        {busy && (
          <div role="status" className="flex flex-col gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-primary"
                style={{ width: phase === "extracting" ? `${Math.round(progress * 100)}%` : "100%" }}
              />
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              {status}
            </p>
          </div>
        )}
        {!busy && status && <p className="text-sm text-muted">{status}</p>}
        {error && (
          <p className="rounded-xl bg-bg px-3 py-2 text-sm text-primary" role="alert">
            {error}
          </p>
        )}

        {speakerIds.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-xs text-muted">Cada color es una voz. El nombre va al lado.</p>
            {speakerIds.map((id, index) => (
              <div key={id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFocusSpeaker((current) => (current === id ? null : id))}
                  className={`h-11 max-w-[9.5rem] shrink-0 truncate rounded-full px-3 text-xs font-medium ${SPEAKER_COLORS[index % SPEAKER_COLORS.length]}`}
                >
                  {speakerLabel(id, names)}
                </button>
                <input
                  value={names[id] ?? ""}
                  onChange={(event) => rename(id, event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="Nombre"
                  aria-label={`Nombre de ${speakerLabel(id, {})}`}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary"
                />
              </div>
            ))}
          </div>
        )}

        <video
          ref={audioRef}
          playsInline
          preload="auto"
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration;
            if (Number.isFinite(next) && next > 0) setDuration(next);
          }}
          className="block h-12 w-full rounded-xl bg-bg"
        />

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void run()}
            className="h-11 flex-1 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-40"
          >
            {busy ? "Trabajando…" : "Transcribir"}
          </button>
          {busy && (
            <button type="button" onClick={cancelJob} className="h-11 rounded-xl border border-line px-4 text-sm">
              Cancelar
            </button>
          )}
        </div>

        {jobs.length > 0 && (
          <ul className="flex flex-col gap-1 border-t border-line pt-4">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openJob(job)}
                  className="flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2 text-left text-sm hover:bg-bg"
                >
                  <span className="truncate">{job.title}</span>
                  <span className="shrink-0 text-xs text-muted">{formatClock(job.durationSec)}</span>
                </button>
                <button
                  type="button"
                  aria-label="Borrar"
                  onClick={() => void removeJob(job.id)}
                  className="grid size-11 place-items-center text-muted"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-[32rem] flex-col rounded-2xl border border-line bg-surface">
        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!audioUrl && !file}
              aria-label={playing ? "Pausa" : "Reproducir"}
              className="grid size-11 place-items-center rounded-full bg-primary text-primary-fg disabled:opacity-40"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={Math.max(duration, audioRef.current?.duration || 0, 0.1)}
                step={0.1}
                value={Math.min(now, duration || now)}
                onChange={(event) => playFrom(Number(event.target.value))}
                disabled={!audioUrl && !file}
                className="w-full accent-primary"
                aria-label="Posición del audio"
              />
              <p className="text-xs text-muted">
                {formatClock(now)} {audioUrl ? "" : "· sin audio cargado"}
              </p>
            </div>
            {cues.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => saveExport("txt")} className="inline-flex h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm">
                    <Download className="size-4" aria-hidden="true" /> TXT
                  </button>
                  <button type="button" onClick={() => saveExport("doc")} className="inline-flex h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm">
                    <Download className="size-4" aria-hidden="true" /> Word
                  </button>
                  <button type="button" onClick={() => saveExport("srt")} className="inline-flex h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm">
                    SRT
                  </button>
                </div>
                {exportFile && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-ink">{exportFile.note}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const link = document.createElement("a");
                          link.href = exportFile.href;
                          link.download = exportFile.name;
                          document.body.appendChild(link);
                          link.click();
                          window.setTimeout(() => link.remove(), 60_000);
                        }}
                        className="inline-flex h-11 items-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-fg"
                      >
                        Guardar {exportFile.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ok = copyPlain(exportFile.text);
                          setStatus(ok ? "Texto copiado. Pégalo en Word." : "Selecciona el texto y cópialo a mano.");
                        }}
                        className="inline-flex h-11 items-center rounded-xl border border-line px-3 text-sm"
                      >
                        Copiar otra vez
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={exportFile.text}
                      rows={5}
                      className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm leading-relaxed"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {turns.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-4 p-6 text-sm leading-relaxed text-muted">
            <p className="flex items-start gap-3">
              <FileAudio className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden="true" />
              El audio queda a la izquierda del texto. Al reproducir, la frase actual se marca.
            </p>
            <p className="flex items-start gap-3">
              <Film className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden="true" />
              El video se convierte a audio antes de transcribirse.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col">
            {turns.map((turn) => {
              const hot = turn.cues.some((cue) => cues[activeIndex] === cue);
              const dim = focusSpeaker !== null && focusSpeaker !== turn.speaker;
              const colorIndex = Math.max(0, speakerIds.indexOf(turn.speaker));
              return (
                <li
                  key={`${turn.speaker}-${turn.start}`}
                  className={`border-t border-l-4 border-line px-4 py-3 ${hot ? "bg-bg" : ""} ${dim ? "opacity-45" : ""}`}
                  style={{ borderLeftColor: BAR_HEX[colorIndex % BAR_HEX.length] }}
                >
                  <button type="button" onClick={() => playFrom(turn.start)} className="text-left">
                    <span className="text-xs text-muted">
                      <span className={`rounded-full px-2 py-1 font-medium ${SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length]}`}>
                        {speakerLabel(turn.speaker, names)}
                      </span>
                      {" · "}
                      {formatClock(turn.start)}
                    </span>
                  </button>
                  <textarea
                    value={turn.text}
                    rows={Math.min(8, Math.max(2, Math.ceil(turn.text.length / 90)))}
                    onChange={(event) => editTurn(turn.speaker, turn.start, event.target.value)}
                    aria-label={`Texto de ${speakerLabel(turn.speaker, names)}`}
                    className="mt-2 w-full resize-y rounded-xl border border-transparent bg-transparent px-1 py-1 text-base leading-relaxed outline-none focus:border-line"
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
