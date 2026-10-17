"use client";

import { CircleCheck, TriangleAlert, Upload as UploadIcon, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as tus from "tus-js-client";
import { MAX_FILE_MB, STORAGE_BUCKET } from "@/lib/constants";
import { formatBytes, naturalCompare } from "@/lib/format";
import { buildStoragePath, guessMime, inferKind } from "@/lib/storage-path";
import { supabase } from "@/lib/supabase/browser";
import type { Asset, AssetKind } from "@/lib/types";
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
}

interface UploadApi {
  items: UploadItem[];
  /** Envoie des fichiers vers un contenu. kind = deviné depuis le type si absent. */
  upload: (contentId: string, files: File[], kind?: AssetKind) => void;
}

const Ctx = createContext<UploadApi | null>(null);

export function useUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploads doit être utilisé dans <UploadProvider>");
  return ctx;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Point d'entrée « resumable » direct du stockage (plus rapide pour les gros fichiers). */
function tusEndpoint() {
  const host = new URL(SUPABASE_URL).hostname;
  const m = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  return m
    ? `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable`
    : `${SUPABASE_URL}/storage/v1/upload/resumable`;
}

async function accessToken() {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? "";
}

function tusUpload(file: File, path: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    accessToken().then((token) => {
      const upload = new tus.Upload(file, {
        endpoint: tusEndpoint(),
        retryDelays: [0, 2000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${token}`, apikey: ANON_KEY, "x-upsert": "false" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: STORAGE_BUCKET,
          objectName: path,
          contentType: file.type || guessMime(file.name),
          cacheControl: "3600",
        },
        onBeforeRequest: async (req) => {
          req.setHeader("authorization", `Bearer ${await accessToken()}`);
        },
        onProgress: (sent, total) => onProgress(total ? sent / total : 0),
        onError: (err) => reject(err),
        onSuccess: () => resolve(),
      });
      upload.start();
    }, reject);
  });
}

function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/413|too large|Payload too large|exceeded the maximum/i.test(msg)) {
    return `Fichier trop lourd (max ${MAX_FILE_MB} Mo par fichier sur le plan actuel)`;
  }
  if (/403|row-level security|Unauthorized/i.test(msg)) return "Accès refusé";
  return "Échec de l'envoi, réessaie";
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const { addAsset, contentById } = useData();
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [hidden, setHidden] = useState(false);

  const patch = (id: string, p: Partial<UploadItem>) =>
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const upload: UploadApi["upload"] = useCallback(
    (contentId, rawFiles, forcedKind) => {
      const content = contentById.get(contentId);
      const files = [...rawFiles].sort((a, b) => naturalCompare(a.name, b.name));
      const tooBig = files.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
      if (tooBig.length) {
        toast(
          `${tooBig.map((f) => f.name).join(", ")} : trop lourd (max ${MAX_FILE_MB} Mo par fichier sur le plan gratuit Supabase).`,
          "error",
        );
      }
      const ok = files.filter((f) => !tooBig.includes(f));
      if (!ok.length) return;

      // positions : à la suite des fichiers déjà présents, par type
      const nextPos = new Map<AssetKind, number>();
      for (const a of content?.assets ?? []) {
        nextPos.set(a.kind, Math.max(nextPos.get(a.kind) ?? 0, a.position + 1));
      }

      const jobs = ok.map((file) => {
        const kind = forcedKind ?? inferKind(file.type, file.name);
        const position = nextPos.get(kind) ?? 0;
        nextPos.set(kind, position + 1);
        return {
          item: {
            id: crypto.randomUUID(),
            contentId,
            fileName: file.name,
            size: file.size,
            progress: 0,
            status: "queued" as const,
          },
          file,
          kind,
          position,
        };
      });

      setHidden(false);
      setItems((list) => [...list.filter((i) => i.status !== "done"), ...jobs.map((j) => j.item)]);

      (async () => {
        // 2 envois en parallèle maximum
        let cursor = 0;
        const worker = async () => {
          while (cursor < jobs.length) {
            const job = jobs[cursor++];
            const path = buildStoragePath(contentId, job.kind, job.file.name);
            patch(job.item.id, { status: "uploading" });
            try {
              await tusUpload(job.file, path, (p) => patch(job.item.id, { progress: p }));
              const { data, error } = await supabase()
                .from("assets")
                .insert({
                  content_id: contentId,
                  kind: job.kind,
                  position: job.position,
                  storage_path: path,
                  file_name: job.file.name,
                  mime_type: job.file.type || guessMime(job.file.name),
                  size_bytes: job.file.size,
                })
                .select()
                .single();
              if (error) throw error;
              addAsset(data as Asset);
              patch(job.item.id, { status: "done", progress: 1 });
            } catch (e) {
              console.error(e);
              patch(job.item.id, { status: "error", error: readableError(e) });
            }
          }
        };
        await Promise.all([worker(), worker()]);
      })();
    },
    [addAsset, contentById, toast],
  );

  const active = items.filter((i) => i.status === "queued" || i.status === "uploading");
  const visible = !hidden && items.length > 0;

  return (
    <Ctx value={{ items, upload }}>
      {children}
      {visible && (
        <div className="fixed right-3 bottom-24 left-3 z-40 md:left-auto md:bottom-6 md:w-96">
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <UploadIcon className="size-4 text-accent" />
                {active.length ? `Envoi de ${active.length} fichier${active.length > 1 ? "s" : ""}…` : "Envois terminés"}
              </p>
              <IconButton
                label="Masquer"
                onClick={() => {
                  setHidden(true);
                  setItems((list) => list.filter((i) => i.status === "queued" || i.status === "uploading"));
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>
            <ul className="max-h-56 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{it.fileName}</span>
                    <span className="shrink-0 text-muted">
                      {it.status === "done" ? (
                        <CircleCheck className="size-4 text-success" />
                      ) : it.status === "error" ? (
                        <TriangleAlert className="size-4 text-danger" />
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
