"use client";

import { useEffect, useState } from "react";
import { STORAGE_BUCKET } from "./constants";
import { supabase } from "./supabase/browser";

/**
 * URLs signées pour lire les fichiers du bucket privé.
 * Les demandes sont regroupées (un seul appel pour toute une grille) et mises en cache ~50 min.
 */

const TTL = 3600;
const cache = new Map<string, { url: string; exp: number }>();
let queue = new Map<string, ((url: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function cached(path: string | null | undefined): string | null {
  if (!path) return null;
  const hit = cache.get(path);
  return hit && hit.exp > Date.now() ? hit.url : null;
}

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;
  const paths = [...batch.keys()];
  if (!paths.length) return;
  const { data } = await supabase().storage.from(STORAGE_BUCKET).createSignedUrls(paths, TTL);
  const byPath = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
  }
  for (const [path, cbs] of batch) {
    const url = byPath.get(path) ?? null;
    if (url) cache.set(path, { url, exp: Date.now() + (TTL - 600) * 1000 });
    cbs.forEach((cb) => cb(url));
  }
}

export function getSignedUrl(path: string): Promise<string | null> {
  const hit = cached(path);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = queue.get(path) ?? [];
    list.push(resolve);
    queue.set(path, list);
    if (!timer) timer = setTimeout(flush, 15);
  });
}

export function useSignedUrl(path: string | null | undefined): string | null {
  const [state, setState] = useState<{ path: string | null | undefined; url: string | null }>(() => ({
    path,
    url: cached(path),
  }));
  useEffect(() => {
    if (!path) return;
    let alive = true;
    getSignedUrl(path).then((url) => alive && setState({ path, url }));
    return () => {
      alive = false;
    };
  }, [path]);
  return state.path === path ? state.url ?? cached(path) : cached(path);
}

/**
 * Nom de téléchargement sans accents : Supabase encode deux fois les caractères non ASCII
 * (« Vidéo.mp4 » arriverait en « Vid%C3%A9o.mp4 »).
 */
export function downloadName(fileName: string): string {
  return fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "_");
}

/** URL qui force le téléchargement avec le bon nom de fichier. */
export async function getDownloadUrl(path: string, fileName: string): Promise<string | null> {
  const { data } = await supabase()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(path, 600, { download: downloadName(fileName) });
  return data?.signedUrl ?? null;
}

export function forgetSignedUrl(path: string) {
  cache.delete(path);
}
