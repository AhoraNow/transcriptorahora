import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BAJAR_KEY, copyPlain, downloadText } from "@/lib/transcript";

export const Route = createFileRoute("/bajar")({ component: Bajar });

type SavedFile = { name: string; payload: string; plain: string; mime: string };

function Bajar() {
  const [file, setFile] = useState<SavedFile | null>(null);
  const [note, setNote] = useState("Preparando el archivo…");

  useEffect(() => {
    const raw = localStorage.getItem(BAJAR_KEY);
    if (!raw) {
      setNote("No hay un archivo listo. Vuelve a la sala y toca TXT, Word o SRT.");
      return;
    }
    let data: SavedFile;
    try {
      data = JSON.parse(raw) as SavedFile;
    } catch {
      setNote("No se pudo leer el archivo. Vuelve a pedirlo en la sala.");
      return;
    }
    if (!data?.payload || !data.name) {
      setNote("El archivo llegó vacío. Vuelve a pedirlo en la sala.");
      return;
    }
    setFile(data);
    downloadText(data.name, data.payload, data.mime || "text/plain;charset=utf-8");
    setNote(`${data.name} se está guardando en Descargas. Puedes cerrar esta pestaña.`);
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <p className="text-xs font-medium tracking-widest text-primary uppercase">Ahora · Huánuco</p>
      <h1 className="font-display text-4xl text-ink">{file?.name ?? "Archivo"}</h1>
      <p className="text-sm text-muted">{note}</p>
      {file && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadText(file.name, file.payload, file.mime)}
            className="h-11 rounded-xl bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            Guardar otra vez
          </button>
          <button
            type="button"
            onClick={() => {
              const ok = copyPlain(file.plain || file.payload);
              setNote(ok ? "Texto copiado. Pégalo en Word." : "Selecciona el texto de abajo y cópialo.");
            }}
            className="h-11 rounded-xl border border-line px-4 text-sm"
          >
            Copiar
          </button>
        </div>
      )}
      {file && (
        <pre className="overflow-auto rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {file.plain || file.payload}
        </pre>
      )}
    </main>
  );
}
