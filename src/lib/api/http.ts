import { connection, NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import type { PostgrestError } from "@supabase/supabase-js";
import { authenticate, type ApiKeyInfo } from "./auth";
import { ApiError, dbFail } from "./errors";

export { ApiError, dbFail };

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return json({ error: err.message, ...(err.details ?? {}) }, err.status);
  }
  console.error("[api/v1]", err);
  const msg = err instanceof Error ? err.message : String(err);
  return json({ error: `Erreur interne du serveur : ${msg}` }, 500);
}

/**
 * Point d'entrée commun des route handlers : attend la vraie requête
 * (pas de prérendu), vérifie la clé API puis transforme les erreurs en JSON.
 */
export async function handle(
  req: Request,
  fn: (key: ApiKeyInfo) => Promise<Response>,
): Promise<Response> {
  await connection();
  try {
    const key = await authenticate(req);
    return await fn(key);
  } catch (err) {
    unstable_rethrow(err);
    return errorResponse(err);
  }
}

/** Lit le corps JSON (vide = {}). */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Le corps de la requête n'est pas du JSON valide.");
  }
}

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function readObject(req: Request): Promise<Obj> {
  const body = await readJson(req);
  if (!isObj(body)) throw new ApiError(400, "Le corps de la requête doit être un objet JSON.");
  return body;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;

/** Récupère toutes les lignes en paginant (PostgREST plafonne à 1000 par requête). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PageResult<T>,
  what: string,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw dbFail(error, what);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Découpe une liste (pour les filtres `in` sans URL géante). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
