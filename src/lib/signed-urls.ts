"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "./client-fetch";

/**
 * URLs signées pour lire les fichiers (Backblaze B2, bucket privé).
 * Les demandes sont regroupées (un seul appel pour toute une grille) et mises en cache ~50 min.
 */

const TTL_MS = 50 * 60 * 1000;
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
  const urls: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 200) {
    try {
      const res = await authedFetch<{ urls: Record<string, string> }>("/api/storage/sign", {
        method: "POST",
        body: JSON.stringify({ paths: paths.slice(i, i + 200) }),
      });
      Object.assign(urls, res.urls);
    } catch (e) {
      console.error(e);
    }
  }
  for (const [path, cbs] of batch) {
    const url = urls[path] ?? null;
    if (url) cache.set(path, { url, exp: Date.now() + TTL_MS });
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

/** Abonnés par chemin : prévenus quand une URL est oubliée (erreur de lecture) pour la redemander. */
const listeners = new Map<string, Set<() => void>>();

/** URL signée d'un fichier, renouvelée avant expiration et après une erreur de lecture. */
export function useSignedUrl(path: string | null | undefined): string | null {
  const [state, setState] = useState<{ path: string | null | undefined; url: string | null }>(() => ({
    path,
    url: cached(path),
  }));
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      getSignedUrl(path).then((url) => {
        if (!alive) return;
        setState({ path, url });
        const exp = cache.get(path)?.exp;
        if (timer) clearTimeout(timer);
        if (exp) timer = setTimeout(load, Math.max(5_000, exp - Date.now() + 1_000));
      });
    };
    load();
    const set = listeners.get(path) ?? new Set();
    set.add(load);
    listeners.set(path, set);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      set.delete(load);
    };
  }, [path]);
  return state.path === path ? state.url ?? cached(path) : cached(path);
}

/** URL qui force le téléchargement avec le bon nom de fichier (accents compris). */
export async function getDownloadUrl(path: string, fileName: string): Promise<string | null> {
  try {
    const res = await authedFetch<{ urls: Record<string, string> }>("/api/storage/sign", {
      method: "POST",
      body: JSON.stringify({ paths: [path], download: fileName }),
    });
    return res.urls[path] ?? null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Oublie l'URL d'un fichier (expirée, supprimée) ; les écrans qui l'affichent en redemandent une. */
const lastForget = new Map<string, number>();
export function forgetSignedUrl(path: string) {
  const had = cache.delete(path);
  // au plus une nouvelle demande toutes les 30 s par fichier (fichier réellement absent → pas de boucle)
  const recent = Date.now() - (lastForget.get(path) ?? 0) < 30_000;
  lastForget.set(path, Date.now());
  if (had && !recent) listeners.get(path)?.forEach((reload) => reload());
}
