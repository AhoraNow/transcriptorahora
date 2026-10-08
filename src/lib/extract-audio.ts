const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mpeg|mpg|3gp|wmv)$/i;

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXT.test(file.name);
}

export type PreparedFile = {
  file: File;
  mode: "audio" | "extracted" | "video-direct";
  note: string;
};

export async function prepareForTranscription(
  file: File,
  onProgress: (ratio: number) => void,
  signal: { cancelled: boolean },
): Promise<PreparedFile> {
  if (!isVideoFile(file)) {
    return {
      file,
      mode: "audio",
      note: "Audio listo para enviar.",
    };
  }

  try {
    const audio = await extractAudio(file, onProgress, signal);
    return {
      file: audio,
      mode: "extracted",
      note: "Se extrajo el audio del video. La imagen no se envía.",
    };
  } catch (error) {
    if (signal.cancelled) throw new Error("Cancelado");
    const reason = error instanceof Error ? error.message : "formato no compatible";
    if (signal.cancelled || /cancel/i.test(reason)) throw new Error("Cancelado");
    return {
      file,
      mode: "video-direct",
      note: `No se pudo extraer el audio aquí (${reason}). Se envía el video: ElevenLabs transcribe su pista de audio.`,
    };
  }
}

async function extractAudio(
  file: File,
  onProgress: (ratio: number) => void,
  signal: { cancelled: boolean },
): Promise<File> {
  const { Input, ALL_FORMATS, BlobSource, Output, BufferTarget, Mp4OutputFormat, Conversion } =
    await import("mediabunny");

  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat(),
    target,
  });
  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      codec: "aac",
      numberOfChannels: 1,
      sampleRate: 16000,
    },
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((track) => track.reason).join(", ");
    throw new Error(why || "sin pista de audio");
  }

  conversion.onProgress = (ratio: number) => {
    if (!signal.cancelled) onProgress(ratio);
  };

  const watcher = window.setInterval(() => {
    if (signal.cancelled) void conversion.cancel();
  }, 200);

  try {
    await Promise.race([
      conversion.execute(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("la conversión tardó demasiado")), 20000);
      }),
    ]);
  } finally {
    window.clearInterval(watcher);
  }

  if (signal.cancelled) throw new Error("Cancelado");
  if (!target.buffer) throw new Error("conversión vacía");

  const blob = new Blob([target.buffer], { type: "audio/mp4" });
  const name = file.name.replace(/\.[^.]+$/, "") + ".m4a";
  return new File([blob], name, { type: "audio/mp4" });
}
