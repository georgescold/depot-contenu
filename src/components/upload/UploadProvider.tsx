"use client";

import { CircleCheck, RotateCw, TriangleAlert, Upload as UploadIcon, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { registerUpload, uploadToStorage } from "@/lib/b2-upload";
import { MAX_FILE_MB } from "@/lib/constants";
import { formatBytes, naturalCompare } from "@/lib/format";
import { inferKind } from "@/lib/storage-path";
import type { AssetKind } from "@/lib/types";
import { useData } from "../data/DataProvider";
import { useToast } from "../Toast";
import { cn, IconButton } from "../ui";

interface UploadItem {
  id: string;
  contentId: string;
  fileName: string;
  size: number;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  /** le fichier est encore en mémoire : on peut relancer l'envoi */
  retryable?: boolean;
}

interface UploadApi {
  items: UploadItem[];
  /** Envoie des fichiers vers un contenu. kind = deviné depuis le type si absent. */
  upload: (contentId: string, files: File[], kind?: AssetKind) => void;
  /** Nombre d'envois en cours pour un contenu (pour prévenir avant de le supprimer). */
  activeFor: (contentId: string) => number;
}

const Ctx = createContext<UploadApi | null>(null);

export function useUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploads doit être utilisé dans <UploadProvider>");
  return ctx;
}

function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Connexion interrompue|Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Connexion coupée : réessaie";
  if (/HTTP 403/.test(msg)) return "Lien d'envoi expiré : réessaie";
  if (/HTTP \d{3}/.test(msg)) return "Le stockage a refusé le fichier : réessaie";
  // messages en français renvoyés par nos routes (trop lourd, contenu supprimé…)
  return msg || "Échec de l'envoi : réessaie";
}

interface Job {
  item: UploadItem;
  file: File;
  kind: AssetKind;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const { addAsset } = useData();
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [hidden, setHidden] = useState(false);
  // dernier enregistrement par contenu : les fichiers sont rattachés dans l'ordre choisi (ordre des slides)
  const chains = useRef(new Map<string, Promise<unknown>>());
  const jobs = useRef(new Map<string, Job>());

  const patch = useCallback(
    (id: string, p: Partial<UploadItem>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it))),
    [],
  );

  const run = useCallback(
    (job: Job) => {
      const { item, file, kind } = job;
      patch(item.id, { status: "uploading", progress: 0, error: undefined });
      const uploaded = uploadToStorage(file, item.contentId, kind, (p) => patch(item.id, { progress: p }));
      const prev = chains.current.get(item.contentId) ?? Promise.resolve();
      const registered = uploaded
        .then(async (res) => {
          await prev.catch(() => {});
          return registerUpload({ contentId: item.contentId, path: res.path, kind, fileName: file.name, contentType: res.contentType });
        })
        .then((asset) => {
          addAsset(asset);
          jobs.current.delete(item.id);
          patch(item.id, { status: "done", progress: 1 });
        })
        .catch((e) => {
          console.error(e);
          patch(item.id, { status: "error", error: readableError(e), retryable: true });
        });
      chains.current.set(item.contentId, registered);
      return registered;
    },
    [addAsset, patch],
  );

  const upload: UploadApi["upload"] = useCallback(
    (contentId, rawFiles, forcedKind) => {
      const files = [...rawFiles].sort((a, b) => naturalCompare(a.name, b.name));
      const rejected = files.filter((f) => f.size === 0 || f.size > MAX_FILE_MB * 1024 * 1024);
      if (rejected.length) {
        toast(
          rejected
            .map((f) => (f.size === 0 ? `${f.name} : fichier vide` : `${f.name} : trop lourd (max ${MAX_FILE_MB} Mo)`))
            .join(" · "),
          "error",
        );
      }
      const ok = files.filter((f) => !rejected.includes(f));
      if (!ok.length) return;

      const newJobs: Job[] = ok.map((file) => ({
        item: { id: crypto.randomUUID(), contentId, fileName: file.name, size: file.size, progress: 0, status: "queued" },
        file,
        kind: forcedKind ?? inferKind(file.type, file.name),
      }));
      newJobs.forEach((j) => jobs.current.set(j.item.id, j));
      setHidden(false);
      setItems((list) => [...list.filter((i) => i.status !== "done"), ...newJobs.map((j) => j.item)]);

      // 2 envois en parallèle maximum ; l'ordre de rattachement reste celui de la sélection
      (async () => {
        let cursor = 0;
        const worker = async () => {
          while (cursor < newJobs.length) await run(newJobs[cursor++]);
        };
        await Promise.all([worker(), worker()]);
      })();
    },
    [run, toast],
  );

  const retry = (id: string) => {
    const job = jobs.current.get(id);
    if (job) run(job);
  };

  const active = items.filter((i) => i.status === "queued" || i.status === "uploading");
  const activeFor = useCallback(
    (contentId: string) => items.filter((i) => i.contentId === contentId && (i.status === "queued" || i.status === "uploading")).length,
    [items],
  );

  // prévient avant de fermer l'onglet pendant un envoi
  useEffect(() => {
    if (!active.length) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active.length]);

  const overall = active.length
    ? active.reduce((s, i) => s + i.progress * i.size, 0) / Math.max(1, active.reduce((s, i) => s + i.size, 0))
    : 1;

  return (
    <Ctx value={{ items, upload, activeFor }}>
      {children}
      {items.length > 0 && hidden && active.length > 0 && (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="fixed right-3 bottom-24 z-40 flex items-center gap-2 rounded-full bg-ink px-3 py-2 text-xs font-semibold text-bg shadow-lg md:bottom-6"
        >
          <UploadIcon className="size-3.5" />
          Envoi {Math.round(overall * 100)} %
        </button>
      )}
      {items.length > 0 && !hidden && (
        <div className="fixed right-3 bottom-24 left-3 z-40 md:left-auto md:bottom-6 md:w-96">
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <UploadIcon className="size-4 text-accent" />
                {active.length
                  ? `Envoi de ${active.length} fichier${active.length > 1 ? "s" : ""}… ${Math.round(overall * 100)} %`
                  : "Envois terminés"}
              </p>
              <IconButton
                label={active.length ? "Réduire" : "Fermer"}
                onClick={() => {
                  setHidden(true);
                  setItems((list) => list.filter((i) => i.status === "queued" || i.status === "uploading"));
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            {active.length > 0 && (
              <p className="mb-2 text-xs text-muted">Garde l&apos;app ouverte jusqu&apos;à la fin de l&apos;envoi.</p>
            )}
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{it.fileName}</span>
                    <span className="flex shrink-0 items-center gap-1 text-muted">
                      {it.status === "done" ? (
                        <CircleCheck className="size-4 text-success" />
                      ) : it.status === "error" ? (
                        <>
                          <TriangleAlert className="size-4 text-danger" />
                          {it.retryable && (
                            <IconButton label="Réessayer" className="size-7" onClick={() => retry(it.id)}>
                              <RotateCw className="size-3.5" />
                            </IconButton>
                          )}
                        </>
                      ) : it.status === "queued" ? (
                        `En attente · ${formatBytes(it.size)}`
                      ) : (
                        `${Math.round(it.progress * 100)} % · ${formatBytes(it.size)}`
                      )}
                    </span>
                  </div>
                  {it.status === "error" ? (
                    <p className="text-xs text-danger">{it.error}</p>
                  ) : (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn("h-full rounded-full transition-all", it.status === "done" ? "bg-success" : "bg-accent")}
                        style={{ width: `${Math.max(3, it.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Ctx>
  );
}
