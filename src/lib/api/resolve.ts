import type { SupabaseClient } from "@supabase/supabase-js";
import { FOLDER_COLORS } from "@/lib/constants";
import {
  ancestorsOf,
  buildFolderIndex,
  childrenOf,
  descendantIds,
  type FolderIndex,
} from "@/lib/folders";
import type { Account, Folder, Platform } from "@/lib/types";
import { ApiError, dbFail } from "./errors";
import { fetchAll } from "./http";
import { isUuid, parsePlatform } from "./validate";

/* =====================================================================
 * Dossiers
 * ===================================================================== */

export const PATH_SEP = " / ";

/** Comparaison de noms insensible à la casse, aux accents et aux espaces. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Projet/Sous-projet > Angle" → ["Projet", "Sous-projet", "Angle"].
 * Séparateurs : « / », « > » (que l'UI interdit dans les noms) et « › » (séparateur d'affichage de l'UI).
 */
export function splitFolderPath(p: string): string[] {
  if (/[\u0000-\u001f\u007f]/.test(p.replace(/[\t\r\n]/g, " "))) {
    throw new ApiError(400, "Chemin de dossier invalide : il contient des caractères de contrôle.");
  }
  return p
    .split(/[/>›]/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export class FolderCtx {
  folders: Folder[];
  index: FolderIndex;
  constructor(folders: Folder[]) {
    this.folders = folders;
    this.index = buildFolderIndex(folders);
  }
  add(f: Folder) {
    this.folders.push(f);
    this.index = buildFolderIndex(this.folders);
  }
  replace(f: Folder) {
    this.folders = this.folders.map((x) => (x.id === f.id ? f : x));
    this.index = buildFolderIndex(this.folders);
  }
  remove(id: string) {
    this.folders = this.folders.filter((x) => x.id !== id);
    this.index = buildFolderIndex(this.folders);
  }
  get(id: string): Folder | undefined {
    return this.index.byId.get(id);
  }
  path(id: string | null | undefined): string {
    return ancestorsOf(this.index, id)
      .map((f) => f.name)
      .join(PATH_SEP);
  }
  depth(id: string): number {
    return ancestorsOf(this.index, id).length - 1;
  }
  /** Le dossier et tous ses sous-dossiers. */
  subtree(id: string): Set<string> {
    return descendantIds(this.index, id);
  }
  /** Du dossier racine jusqu'au dossier lui-même. */
  chain(id: string): Folder[] {
    return ancestorsOf(this.index, id);
  }
}

export async function loadFolderCtx(sb: SupabaseClient): Promise<FolderCtx> {
  const rows = await fetchAll<Folder>(
    (from, to) => sb.from("folders").select("*").order("created_at").order("id").range(from, to),
    "lecture des dossiers",
  );
  return new FolderCtx(rows);
}

export interface ResolvedFolder {
  folder: Folder;
  /** Dossiers créés pendant la résolution (create_folders / mkdir -p). */
  created: Folder[];
}

/**
 * Résout un dossier par uuid ou par chemin. Avec `create`, crée les segments
 * manquants (comme mkdir -p).
 */
export async function resolveFolder(
  sb: SupabaseClient,
  ctx: FolderCtx,
  ref: unknown,
  opts: { create?: boolean; label?: string } = {},
): Promise<ResolvedFolder> {
  const label = opts.label ?? "folder";
  if (typeof ref !== "string" || !ref.trim()) {
    throw new ApiError(400, `Le champ « ${label} » est obligatoire (uuid ou chemin « Projet/Sous-projet/Angle »).`);
  }
  const raw = ref.trim();

  if (isUuid(raw)) {
    const f = ctx.get(raw.toLowerCase());
    if (!f) throw new ApiError(404, `Aucun dossier avec l'id ${raw}.`);
    return { folder: f, created: [] };
  }

  const segments = splitFolderPath(raw);
  if (segments.length === 0) throw new ApiError(400, `Chemin de dossier vide : « ${raw} ».`);

  let parent: Folder | null = null;
  const created: Folder[] = [];
  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const siblings = childrenOf(ctx.index, parent?.id ?? null);
      const matches = siblings.filter((f) => normName(f.name) === normName(seg));
      if (matches.length > 1) {
        throw new ApiError(409, `Plusieurs dossiers s'appellent « ${seg} » dans « ${parent ? ctx.path(parent.id) : "(racine)"} » : utilise l'id.`, {
          choices: matches.map((f) => ({ id: f.id, path: ctx.path(f.id) })),
        });
      }
      if (matches.length === 1) {
        parent = matches[0];
        continue;
      }
      if (!opts.create) {
        const where = parent ? `dans « ${ctx.path(parent.id)} »` : "à la racine";
        const existing = siblings.map((f) => f.name);
        throw new ApiError(
          404,
          `Dossier « ${seg} » introuvable ${where}. ` +
            (existing.length ? `Dossiers existants : ${existing.join(", ")}. ` : "") +
            `Ajoute « create_folders: true » pour le créer.`,
          { missing: segments.slice(0, i + 1).join(PATH_SEP) },
        );
      }
      const position = siblings.reduce((m, f) => Math.max(m, f.position + 1), 0);
      const roots = childrenOf(ctx.index, null).length;
      const color = parent ? parent.color : FOLDER_COLORS[roots % FOLDER_COLORS.length];
      const { data, error } = await sb
        .from("folders")
        .insert({ parent_id: parent?.id ?? null, name: seg, position, color })
        .select("*")
        .single();
      if (error?.code === "23505") {
        // Course : un autre envoi vient de créer ce dossier. On le relit et on le réutilise.
        const existing = await findSibling(sb, parent?.id ?? null, seg);
        if (!existing) throw dbFail(error, `création du dossier « ${seg} »`);
        if (!ctx.get(existing.id)) ctx.add(existing);
        parent = existing;
        continue;
      }
      if (error) throw dbFail(error, `création du dossier « ${seg} »`);
      const f = data as Folder;
      ctx.add(f);
      created.push(f);
      parent = f;
    }
  } catch (err) {
    // Rien de partiel : on retire les dossiers créés par cet appel (du plus profond au plus haut).
    await deleteFolders(sb, created);
    for (const f of created) ctx.remove(f.id);
    throw err;
  }
  return { folder: parent!, created };
}

export interface FolderPreview {
  /** Dossier existant le plus profond du chemin (null si même la racine manque). */
  existing: Folder | null;
  /** Segments qui seraient créés (create_folders). */
  missing: string[];
  /** Chemin complet tel qu'il serait après création. */
  path: string;
}

/** Comme resolveFolder, sans rien écrire : pour valider une requête avant de la jouer (dry_run). */
export function previewFolder(ctx: FolderCtx, ref: unknown, opts: { create?: boolean; label?: string } = {}): FolderPreview {
  const label = opts.label ?? "folder";
  if (typeof ref !== "string" || !ref.trim()) {
    throw new ApiError(400, `Le champ « ${label} » est obligatoire (uuid ou chemin « Projet/Sous-projet/Angle »).`);
  }
  const raw = ref.trim();
  if (isUuid(raw)) {
    const f = ctx.get(raw.toLowerCase());
    if (!f) throw new ApiError(404, `Aucun dossier avec l'id ${raw}.`);
    return { existing: f, missing: [], path: ctx.path(f.id) };
  }
  const segments = splitFolderPath(raw);
  if (segments.length === 0) throw new ApiError(400, `Chemin de dossier vide : « ${raw} ».`);
  let parent: Folder | null = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const siblings = childrenOf(ctx.index, parent?.id ?? null);
    const matches = siblings.filter((f) => normName(f.name) === normName(seg));
    if (matches.length > 1) {
      throw new ApiError(409, `Plusieurs dossiers s'appellent « ${seg} » dans « ${parent ? ctx.path(parent.id) : "(racine)"} » : utilise l'id.`, {
        choices: matches.map((f) => ({ id: f.id, path: ctx.path(f.id) })),
      });
    }
    if (matches.length === 1) {
      parent = matches[0];
      continue;
    }
    if (!opts.create) {
      const where = parent ? `dans « ${ctx.path(parent.id)} »` : "à la racine";
      const existing = siblings.map((f) => f.name);
      throw new ApiError(
        404,
        `Dossier « ${seg} » introuvable ${where}. ` +
          (existing.length ? `Dossiers existants : ${existing.join(", ")}. ` : "") +
          `Ajoute « create_folders: true » pour le créer.`,
        { missing: segments.slice(0, i + 1).join(PATH_SEP) },
      );
    }
    const missing = segments.slice(i);
    return { existing: parent, missing, path: [...(parent ? [ctx.path(parent.id)] : []), ...missing].join(PATH_SEP) };
  }
  return { existing: parent, missing: [], path: ctx.path(parent!.id) };
}

/** Paramètre d'URL `:id` (uuid ou chemin encodé en un seul segment), décodé sans planter sur un « % » littéral. */
export function decodeRefParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Relit en base le dossier `name` sous `parentId` (même règle que l'index unique : casse et espaces ignorés). */
async function findSibling(sb: SupabaseClient, parentId: string | null, name: string): Promise<Folder | null> {
  const q = sb.from("folders").select("*");
  const { data, error } = await (parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null));
  if (error) throw dbFail(error, "lecture des dossiers");
  const rows = (data ?? []) as Folder[];
  const key = name.trim().toLowerCase();
  return rows.find((f) => f.name.trim().toLowerCase() === key) ?? rows.find((f) => normName(f.name) === normName(name)) ?? null;
}

/** Supprime des dossiers créés pour l'occasion (ordre inverse de création). */
export async function deleteFolders(sb: SupabaseClient, created: Folder[]): Promise<void> {
  for (const f of [...created].reverse()) {
    await sb.from("folders").delete().eq("id", f.id);
  }
}

/* =====================================================================
 * Comptes
 * ===================================================================== */

export async function loadAccounts(sb: SupabaseClient): Promise<Account[]> {
  return fetchAll<Account>(
    (from, to) => sb.from("accounts").select("*").order("created_at").order("id").range(from, to),
    "lecture des comptes",
  );
}

export interface AccountCandidate {
  account: Account;
  /** Profondeur du dossier du compte (0 = projet racine) ; -1 = hors arborescence. */
  depth: number;
}

/** Comptes utilisables pour un dossier : le dossier et tous ses parents. */
export function candidatesForFolder(ctx: FolderCtx, accounts: Account[], folderId: string): AccountCandidate[] {
  const depthById = new Map(ctx.chain(folderId).map((f, i) => [f.id, i]));
  return accounts
    .filter((a) => depthById.has(a.folder_id))
    .map((a) => ({ account: a, depth: depthById.get(a.folder_id)! }))
    .sort((a, b) => a.depth - b.depth || a.account.position - b.account.position);
}

export function normHandle(h: string): string {
  return h.trim().replace(/^@+/, "").trim().toLowerCase();
}

export function accountLabel(a: Pick<Account, "platform" | "handle">): string {
  const h = a.handle.trim();
  if (!h) return a.platform;
  return `${a.platform}:${h.startsWith("@") || /\s/.test(h) ? h : "@" + h}`;
}

/**
 * Résout un compte parmi des candidats : uuid, « plateforme », « @handle »
 * ou « plateforme:handle ». En cas de plusieurs comptes, le plus proche du
 * dossier (le plus profond) gagne ; égalité → 409 avec la liste des choix.
 */
export function resolveAccountRef(
  ctx: FolderCtx,
  candidates: AccountCandidate[],
  ref: unknown,
  scope: string,
): Account {
  if (typeof ref !== "string" || !ref.trim()) {
    throw new ApiError(400, "Le champ « account » est obligatoire (uuid, plateforme, @handle ou plateforme:handle).");
  }
  const raw = ref.trim();
  const describe = (list: AccountCandidate[]) =>
    list.map((c) => ({
      id: c.account.id,
      platform: c.account.platform,
      handle: c.account.handle,
      ref: accountLabel(c.account),
      folder_path: ctx.path(c.account.folder_id),
    }));
  const available = () =>
    candidates.length
      ? `Comptes disponibles : ${candidates.map((c) => `${accountLabel(c.account)} (${ctx.path(c.account.folder_id)})`).join(", ")}.`
      : "Aucun compte n'est rattaché à ce dossier ni à ses parents : ajoute-en un (POST /api/v1/accounts).";

  let matches: AccountCandidate[];
  if (isUuid(raw)) {
    matches = candidates.filter((c) => c.account.id === raw.toLowerCase());
    if (!matches.length) {
      throw new ApiError(404, `Le compte ${raw} n'est pas utilisable ici (${scope}). ${available()}`, {
        available_accounts: describe(candidates),
      });
    }
    return matches[0].account;
  }

  let platform: Platform | undefined;
  let handle: string | undefined;
  const colon = raw.indexOf(":");
  if (colon > 0 && parsePlatform(raw.slice(0, colon))) {
    platform = parsePlatform(raw.slice(0, colon));
    handle = normHandle(raw.slice(colon + 1));
  } else if (!raw.startsWith("@") && parsePlatform(raw)) {
    platform = parsePlatform(raw);
  } else {
    handle = normHandle(raw);
  }

  matches = candidates.filter(
    (c) =>
      (!platform || c.account.platform === platform) &&
      (handle === undefined || handle === "" || normHandle(c.account.handle) === handle),
  );
  // « instagram » peut aussi être un handle : on retente comme handle.
  if (!matches.length && platform && handle === undefined) {
    const h = normHandle(raw);
    matches = candidates.filter((c) => normHandle(c.account.handle) === h);
  }
  if (!matches.length) {
    throw new ApiError(404, `Aucun compte ne correspond à « ${raw} » (${scope}). ${available()}`, {
      available_accounts: describe(candidates),
    });
  }
  if (matches.length === 1) return matches[0].account;

  const maxDepth = Math.max(...matches.map((c) => c.depth));
  const closest = matches.filter((c) => c.depth === maxDepth);
  if (closest.length === 1) return closest[0].account;

  throw new ApiError(
    409,
    `Compte ambigu : « ${raw} » correspond à plusieurs comptes au même niveau (${closest
      .map((c) => accountLabel(c.account))
      .join(", ")}). Précise avec « plateforme:handle » ou l'id du compte.`,
    { choices: describe(closest) },
  );
}
