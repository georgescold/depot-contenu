import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { presignGet } from "@/lib/b2";
import { ASSET_KIND_LIST, PLATFORMS } from "@/lib/constants";
import { contentStatus, isLate } from "@/lib/status";
import type { Account, Asset, AssetKind, Content, Folder, Publication } from "@/lib/types";
import { effectiveAssignee } from "@/lib/assignee";
import { ApiError, dbFail } from "./errors";
import { effectiveJson, loadPeople, peopleMap, personJson, type PeopleMap } from "./people";
import { statsForPublications } from "./stats";
import {
  accountLabel,
  candidatesForFolder,
  loadAccounts,
  loadFolderCtx,
  type FolderCtx,
} from "./resolve";
import { todayParis } from "./validate";

/** Durée de validité des liens de téléchargement signés. */
export const DOWNLOAD_TTL_SECONDS = 3600;

/** Origine publique de l'app (APP_URL si défini, sinon celle de la requête). */
export function appOrigin(req: NextRequest): string {
  const env = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }
  return req.nextUrl.origin;
}

export const contentUrl = (origin: string, id: string) => `${origin}/contenus/${id}`;

export const hhmm = (t: string | null | undefined): string | null => (t ? t.slice(0, 5) : null);

/* ---------- Dossiers & comptes ---------- */

export function serializeAccount(a: Account, people: PeopleMap, ctx?: FolderCtx) {
  return {
    id: a.id,
    folder_id: a.folder_id,
    ...(ctx ? { folder_path: ctx.path(a.folder_id) } : {}),
    platform: a.platform,
    platform_label: PLATFORMS[a.platform]?.label ?? a.platform,
    handle: a.handle,
    url: a.url,
    ref: accountLabel(a),
    assignee: personJson(people, a.assignee_id),
  };
}

/** Personne d'un dossier : la sienne, sinon celle du parent le plus proche (source « folder »). */
export function folderEffective(ctx: FolderCtx, people: PeopleMap, folderId: string) {
  const chain = ctx.chain(folderId);
  for (let i = chain.length - 1; i >= 0; i--) {
    const id = chain[i].assignee_id;
    if (id && people.has(id)) return { id, name: people.get(id)!.name, source: "folder" as const, folder_id: chain[i].id };
  }
  return null;
}

export function serializeFolder(f: Folder, ctx: FolderCtx, people: PeopleMap) {
  return {
    id: f.id,
    parent_id: f.parent_id,
    name: f.name,
    path: ctx.path(f.id),
    depth: ctx.depth(f.id),
    color: f.color,
    description: f.description,
    position: f.position,
    created_at: f.created_at,
    assignee: personJson(people, f.assignee_id),
    effective_assignee: folderEffective(ctx, people, f.id),
  };
}

/* ---------- Publications ---------- */

export function serializePublication(
  p: Publication,
  account: Account | undefined,
  today = todayParis(),
  assignee: ReturnType<typeof effectiveJson> = null,
) {
  return {
    id: p.id,
    account_id: p.account_id,
    account: account
      ? { id: account.id, platform: account.platform, handle: account.handle, url: account.url, ref: accountLabel(account) }
      : null,
    date: p.scheduled_date,
    time: hhmm(p.scheduled_time),
    title: p.title,
    description: p.description,
    posted: p.posted,
    posted_at: p.posted_at,
    post_url: p.post_url,
    late: isLate(p, today),
    /** Personne effective de la publication : contenu, sinon compte, sinon dossier. */
    assignee,
    updated_at: p.updated_at,
  };
}

/** Personne effective d'une publication (contenu → compte → dossier). */
export function pubAssignee(
  ctx: FolderCtx,
  people: PeopleMap,
  content: Pick<Content, "assignee_id" | "folder_id">,
  account: Pick<Account, "assignee_id"> | undefined | null,
) {
  return effectiveJson(people, effectiveAssignee(ctx.index, content, account));
}

/** Tri : date (non programmées à la fin), heure, plateforme. */
export function comparePubs(
  a: { date: string | null; time: string | null; platform?: string },
  b: { date: string | null; time: string | null; platform?: string },
): number {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }
  if (a.time !== b.time) {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return a.time < b.time ? -1 : 1;
  }
  return (a.platform ?? "").localeCompare(b.platform ?? "");
}

/** Avertissements non bloquants (longueurs indicatives par plateforme). */
export function publicationWarnings(p: { title: string; description: string }, account: Account): string[] {
  const info = PLATFORMS[account.platform];
  const out: string[] = [];
  const who = accountLabel(account);
  if ((account.platform === "youtube" || account.platform === "pinterest") && p.title.length > 100) {
    out.push(`${who} : titre ${info.label} de ${p.title.length} caractères (max 100).`);
  }
  if (!info.hasTitle && p.title) {
    out.push(`${who} : ${info.label} n'a pas de champ titre séparé, le titre ne sera pas publié tel quel.`);
  }
  if (p.description.length > info.limit) {
    out.push(`${who} : description de ${p.description.length} caractères (limite ${info.label} : ${info.limit}).`);
  }
  return out;
}

/* ---------- Fichiers ---------- */

const kindOrder = (k: AssetKind) => ASSET_KIND_LIST.indexOf(k);

export function sortAssets(list: Asset[]): Asset[] {
  return [...list].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.position - b.position || a.created_at.localeCompare(b.created_at));
}

export async function serializeAssets(assets: Asset[]) {
  return Promise.all(
    sortAssets(assets).map(async (a) => {
      let downloadUrl: string | null = null;
      let downloadError: string | undefined;
      // fichier retiré du stockage après publication : plus de lien (la ligne reste pour l'historique)
      if (!a.archived_at) {
        try {
          downloadUrl = await presignGet(a.storage_path, {
            download: a.file_name || a.storage_path.split("/").pop(),
            expires: DOWNLOAD_TTL_SECONDS,
          });
        } catch (e) {
          downloadError = e instanceof Error ? e.message : String(e);
        }
      }
      return {
        id: a.id,
        kind: a.kind,
        position: a.position,
        file_name: a.file_name,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        storage_path: a.storage_path,
        created_at: a.created_at,
        archived_at: a.archived_at ?? null,
        download_url: downloadUrl,
        ...(downloadError ? { download_error: downloadError } : {}),
      };
    }),
  );
}

/* ---------- Contenu complet ---------- */

export async function getContentRow(sb: SupabaseClient, id: string): Promise<Content> {
  const { data, error } = await sb.from("contents").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFail(error, "lecture du contenu");
  if (!data) throw new ApiError(404, `Contenu ${id} introuvable.`);
  return data as Content;
}

export async function loadContentFull(
  sb: SupabaseClient,
  id: string,
  origin: string,
  pre?: { ctx?: FolderCtx; accounts?: Account[]; content?: Content; people?: PeopleMap },
) {
  const [content, assetsRes, pubsRes, ctx, accounts, people] = await Promise.all([
    pre?.content ?? getContentRow(sb, id),
    sb.from("assets").select("*").eq("content_id", id),
    sb.from("publications").select("*").eq("content_id", id),
    pre?.ctx ?? loadFolderCtx(sb),
    pre?.accounts ?? loadAccounts(sb),
    pre?.people ?? loadPeople(sb).then(peopleMap),
  ]);
  if (assetsRes.error) throw dbFail(assetsRes.error, "lecture des fichiers");
  if (pubsRes.error) throw dbFail(pubsRes.error, "lecture des publications");

  const today = todayParis();
  const pubs = (pubsRes.data ?? []) as Publication[];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // Statistiques relevées du post publié (par le lien du post ou la publication reliée), sinon null.
  const stats = await statsForPublications(sb, pubs, byId);
  const publications = pubs
    .map((p) => {
      const account = byId.get(p.account_id);
      return { ...serializePublication(p, account, today, pubAssignee(ctx, people, content, account)), stats: stats.get(p.id) ?? null };
    })
    .sort((a, b) => comparePubs({ ...a, platform: a.account?.platform }, { ...b, platform: b.account?.platform }));

  return {
    id: content.id,
    title: content.title,
    format: content.format,
    notes: content.notes,
    keep_files: content.keep_files ?? false,
    files_archived_at: content.files_archived_at ?? null,
    /** Personne attribuée au contenu lui-même (null = pas d'attribution propre). */
    assignee: personJson(people, content.assignee_id),
    /** Personne effective du contenu : la sienne, sinon celle du dossier le plus proche. */
    effective_assignee: pubAssignee(ctx, people, content, null),
    folder_id: content.folder_id,
    folder_path: ctx.path(content.folder_id),
    status: contentStatus(pubs, today),
    created_at: content.created_at,
    updated_at: content.updated_at,
    url: contentUrl(origin, content.id),
    assets: await serializeAssets((assetsRes.data ?? []) as Asset[]),
    publications,
    available_accounts: candidatesForFolder(ctx, accounts, content.folder_id).map((c) => serializeAccount(c.account, people, ctx)),
  };
}

export type ContentFullJson = Awaited<ReturnType<typeof loadContentFull>>;
