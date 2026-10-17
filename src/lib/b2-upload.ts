"use client";

import { authedFetch } from "./client-fetch";
import { guessMime } from "./storage-path";
import type { Asset, AssetKind } from "./types";

type UploadPlan =
  | { mode: "single"; path: string; url: string; content_type: string }
  | { mode: "multipart"; path: string; upload_id: string; part_size: number; urls: string[]; content_type: string };

/** Au-delà de ce délai sans aucun octet envoyé, on considère l'envoi bloqué (changement de réseau…). */
const STALL_MS = 60_000;

/** PUT avec suivi de progression ; renvoie l'ETag. */
function xhrPut(url: string, body: Blob, contentType: string | null, onProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout>;
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => xhr.abort(), STALL_MS);
    };
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      watch();
      onProgress(e.loaded);
    };
    xhr.onload = () => {
      clearTimeout(stall);
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader("ETag") ?? "");
      else reject(new Error(`HTTP ${xhr.status} ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => {
      clearTimeout(stall);
      reject(new Error("Connexion interrompue"));
    };
    xhr.onabort = () => reject(new Error("Connexion interrompue (envoi bloqué)"));
    watch();
    xhr.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // une erreur 4xx de B2 (URL expirée, refus) ne se règle pas en réessayant
      if (i >= attempts || /HTTP 4\d\d/.test(String(e))) throw e;
      await sleep(1500 * i);
    }
  }
}

/**
 * Envoie un fichier directement chez Backblaze B2 (sans passer par Vercel) et renvoie son chemin.
 * Au-delà de 100 Mo : parties de 16 Mo, 3 en parallèle, chaque part relancée en cas d'échec.
 * Le fichier doit ensuite être rattaché au contenu avec `registerUpload`.
 */
export async function uploadToStorage(
  file: File,
  contentId: string,
  kind: AssetKind,
  onProgress: (ratio: number) => void,
): Promise<{ path: string; contentType: string }> {
  if (file.size === 0) throw new Error("Fichier vide (0 octet).");
  const contentType = file.type || guessMime(file.name);
  const plan = await authedFetch<UploadPlan>("/api/storage/upload", {
    method: "POST",
    body: JSON.stringify({ content_id: contentId, kind, file_name: file.name, content_type: contentType, size: file.size }),
  });

  if (plan.mode === "single") {
    await withRetry(() => xhrPut(plan.url, file, plan.content_type, (l) => onProgress(l / file.size)));
    return { path: plan.path, contentType: plan.content_type };
  }

  const loaded = new Array<number>(plan.urls.length).fill(0);
  const etags = new Array<string>(plan.urls.length);
  const report = () => onProgress(loaded.reduce((s, n) => s + n, 0) / file.size);
  let next = 0;
  const worker = async () => {
    while (next < plan.urls.length) {
      const i = next++;
      const start = i * plan.part_size;
      const blob = file.slice(start, Math.min(file.size, start + plan.part_size));
      etags[i] = await withRetry(() =>
        xhrPut(plan.urls[i], blob, null, (l) => {
          loaded[i] = l;
          report();
        }),
      );
      if (!etags[i]) throw new Error("ETag manquant (vérifier le CORS du bucket)");
    }
  };

  try {
    await Promise.all([worker(), worker(), worker()]);
    await authedFetch("/api/storage/complete", {
      method: "POST",
      body: JSON.stringify({
        path: plan.path,
        upload_id: plan.upload_id,
        parts: etags.map((etag, i) => ({ part: i + 1, etag })),
      }),
    });
  } catch (e) {
    authedFetch("/api/storage/complete", {
      method: "POST",
      body: JSON.stringify({ path: plan.path, upload_id: plan.upload_id, abort: true }),
    }).catch(() => {});
    throw e;
  }
  return { path: plan.path, contentType: plan.content_type };
}

/** Rattache un fichier envoyé à son contenu (le serveur vérifie sa taille réelle et calcule sa position). */
export async function registerUpload(input: {
  contentId: string;
  path: string;
  kind: AssetKind;
  fileName: string;
  contentType: string;
}): Promise<Asset> {
  const res = await authedFetch<{ asset: Asset }>("/api/storage/register", {
    method: "POST",
    body: JSON.stringify({
      content_id: input.contentId,
      path: input.path,
      kind: input.kind,
      file_name: input.fileName,
      content_type: input.contentType,
    }),
  });
  return res.asset;
}
