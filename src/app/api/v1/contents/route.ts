import type { NextRequest } from "next/server";
import { ASSET_KIND_LIST } from "@/lib/constants";
import { contentStatus, isLate, type ContentStatus } from "@/lib/status";
import type { Account, AssetKind, Content, Format, Publication } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, fetchAll, handle, json, readObject } from "@/lib/api/http";
import { newPubRow, parsePubInput, pastDateWarning, type PubInput } from "@/lib/api/publications";
import {
  accountLabel,
  candidatesForFolder,
  deleteFolders,
  loadAccounts,
  loadFolderCtx,
  previewFolder,
  resolveAccountRef,
  resolveFolder,
  type FolderCtx,
} from "@/lib/api/resolve";
import { contentMatchesAssignee } from "@/lib/assignee";
import { loadPeople, peopleMap, personJson, resolvePerson, resolvePersonFilter, type PeopleMap } from "@/lib/api/people";
import { appOrigin, comparePubs, contentUrl, hhmm, loadContentFull, pubAssignee, publicationWarnings } from "@/lib/api/serialize";
import { optBool, optFormat, optText, parseFormat, reqText, todayParis } from "@/lib/api/validate";

const STATUSES: ContentStatus[] = ["draft", "scheduled", "late", "partial", "posted"];

type Row = Pick<Content, "id" | "folder_id" | "title" | "format" | "notes" | "assignee_id" | "created_at" | "updated_at"> & {
  assets: { kind: AssetKind }[] | null;
  publications: Pick<Publication, "id" | "account_id" | "scheduled_date" | "scheduled_time" | "posted">[] | null;
};

const LIST_SELECT =
  "id, folder_id, title, format, notes, assignee_id, created_at, updated_at, assets(kind), publications(id, account_id, scheduled_date, scheduled_time, posted)";

function summarize(r: Row, ctx: FolderCtx, accounts: Map<string, Account>, people: PeopleMap, origin: string, today: string) {
  const pubs = r.publications ?? [];
  const files = Object.fromEntries(ASSET_KIND_LIST.map((k) => [k, 0])) as Record<AssetKind, number>;
  for (const a of r.assets ?? []) files[a.kind] = (files[a.kind] ?? 0) + 1;
  return {
    id: r.id,
    title: r.title,
    format: r.format,
    folder_id: r.folder_id,
    folder_path: ctx.path(r.folder_id),
    status: contentStatus(pubs, today),
    assignee: personJson(people, r.assignee_id),
    effective_assignee: pubAssignee(ctx, people, r, null),
    files: { ...files, total: (r.assets ?? []).length },
    publications: pubs
      .map((p) => {
        const a = accounts.get(p.account_id);
        return {
          id: p.id,
          account_id: p.account_id,
          platform: a?.platform ?? null,
          handle: a?.handle ?? null,
          ref: a ? accountLabel(a) : null,
          date: p.scheduled_date,
          time: hhmm(p.scheduled_time),
          posted: p.posted,
          late: isLate(p, today),
          assignee: pubAssignee(ctx, people, r, a),
        };
      })
      .sort((a, b) => comparePubs({ ...a, platform: a.platform ?? "" }, { ...b, platform: b.platform ?? "" })),
    url: contentUrl(origin, r.id),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** GET /api/v1/contents?folder=&status=&format=&q=&assignee=&limit= */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status")?.trim().toLowerCase() || undefined;
    if (status && !STATUSES.includes(status as ContentStatus)) {
      throw new ApiError(400, `Statut « ${status} » inconnu. Valeurs possibles : ${STATUSES.join(", ")}.`);
    }
    const format: Format | undefined = sp.get("format")?.trim() ? parseFormat(sp.get("format")!) : undefined;
    const q = sp.get("q")?.trim() || undefined;
    const limitRaw = sp.get("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ApiError(400, "« limit » doit être un entier entre 1 et 200.");
    }

    const sb = getAdminClient();
    const [ctx, accountList, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const people = peopleMap(peopleList);
    // Personne : id, nom ou « none » (contenus attribués à personne).
    const assigneeRef = sp.get("assignee")?.trim();
    const assigneeFilter = assigneeRef ? resolvePersonFilter(peopleList, assigneeRef) : undefined;
    let folderIds: string[] | undefined;
    const folderRef = sp.get("folder")?.trim();
    if (folderRef) {
      const { folder } = await resolveFolder(sb, ctx, folderRef);
      folderIds = [...ctx.subtree(folder.id)];
    }

    const build = (count: boolean) => {
      let query = sb.from("contents").select(LIST_SELECT, count ? { count: "exact" } : undefined);
      if (folderIds) query = query.in("folder_id", folderIds);
      if (format) query = query.eq("format", format);
      if (q) query = query.ilike("title", `%${likeSafe(q)}%`);
      return query.order("created_at", { ascending: false }).order("id");
    };

    const today = todayParis();
    const origin = appOrigin(req);
    const accounts = new Map(accountList.map((a) => [a.id, a]));
    let rows: Row[];
    let total: number;
    if (status || assigneeFilter) {
      // Filtres calculés (statut, personne effective) : on lit tout puis on filtre.
      const all = await fetchAll<Row>((from, to) => build(false).range(from, to) as never, "liste des contenus");
      const filtered = all.filter(
        (r) =>
          (!status || contentStatus(r.publications ?? [], today) === status) &&
          (!assigneeFilter ||
            contentMatchesAssignee(ctx.index, { ...r, publications: r.publications ?? [] }, accounts, assigneeFilter)),
      );
      total = filtered.length;
      rows = filtered.slice(0, limit);
    } else {
      const { data, error, count } = await build(true).range(0, limit - 1);
      if (error) throw dbFail(error, "liste des contenus");
      rows = (data ?? []) as unknown as Row[];
      total = count ?? rows.length;
    }

    return json({
      contents: rows.map((r) => summarize(r, ctx, accounts, people, origin, today)),
      total,
      limit,
    });
  });
}

/**
 * Neutralise les caractères spéciaux de PostgREST et de LIKE (* % _ , ( ) \) en les remplaçant
 * par « _ » (= n'importe quel caractère, donc aussi le caractère lui-même) : ni joker ni filtre injecté.
 * (PostgREST transforme « * » en « % » avant l'échappement, d'où le remplacement plutôt qu'un « \ ».)
 */
function likeSafe(q: string): string {
  return q.replace(/[*%_,()\\]/g, "_");
}

/** Résout les comptes des publications, refuse les doublons et calcule les avertissements. */
function resolvePublications(ctx: FolderCtx, accounts: Account[], folderId: string | null, scopePath: string, inputs: PubInput[]) {
  const cands = folderId ? candidatesForFolder(ctx, accounts, folderId) : [];
  const scope = `dossier « ${scopePath} »`;
  const resolved = inputs.map((p) => ({ input: p, account: resolveAccountRef(ctx, cands, p.account, scope) }));
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const r of resolved) {
    if (seen.has(r.account.id)) {
      throw new ApiError(400, `Deux publications visent le même compte (${accountLabel(r.account)}) : une seule par compte.`);
    }
    seen.add(r.account.id);
    warnings.push(...publicationWarnings({ title: r.input.title ?? "", description: r.input.description ?? "" }, r.account));
    if (r.input.time && !r.input.date) warnings.push(`${accountLabel(r.account)} : heure sans date, la publication n'est pas programmée.`);
    const past = pastDateWarning(r.account, r.input);
    if (past) warnings.push(past);
  }
  return { resolved, warnings };
}

/**
 * POST /api/v1/contents { folder, create_folders?, title, format?, notes?, publications?, dry_run? }
 * `assignee` : nom ou id d'une personne existante (« none » = personne).
 * Avec dry_run: true, tout est validé (dossier, comptes, personne, dates) mais rien n'est écrit.
 */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const body = await readObject(req);
    const title = reqText(body, "title", { max: 500 });
    const format = optFormat(body) ?? "video";
    const notes = optText(body, "notes", { max: 100000, trim: false })?.trim() ?? "";
    const rawPubs = body.publications ?? [];
    if (!Array.isArray(rawPubs)) throw new ApiError(400, "« publications » doit être une liste.");
    const inputs = rawPubs.map((p, i) => parsePubInput(p, `publication (n°${i + 1})`));
    const create = optBool(body, "create_folders");

    const sb = getAdminClient();
    const [ctx, accounts, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const people = peopleMap(peopleList);
    // Personne inconnue → 404 avant toute écriture (jamais de création implicite).
    const assigneeId = resolvePerson(peopleList, body.assignee) ?? null;

    if (optBool(body, "dry_run")) {
      const preview = previewFolder(ctx, body.folder, { create });
      // Les dossiers à créer n'ont pas encore de comptes : seuls ceux des dossiers existants comptent.
      const { resolved, warnings } = resolvePublications(ctx, accounts, preview.existing?.id ?? null, preview.path, inputs);
      return json({
        dry_run: true,
        title,
        format,
        assignee: personJson(people, assigneeId),
        folder_id: preview.missing.length ? null : preview.existing!.id,
        folder_path: preview.path,
        missing_folders: preview.missing,
        publications: resolved.map((r) => ({
          account: { id: r.account.id, platform: r.account.platform, handle: r.account.handle, ref: accountLabel(r.account) },
          date: r.input.date ?? null,
          time: r.input.time ?? null,
        })),
        warnings,
      });
    }

    const { folder, created } = await resolveFolder(sb, ctx, body.folder, { create });

    let contentId: string | null = null;
    let content: Content;
    let warnings: string[] = [];
    try {
      const checked = resolvePublications(ctx, accounts, folder.id, ctx.path(folder.id), inputs);
      const resolved = checked.resolved;
      warnings = checked.warnings;

      const { data, error } = await sb
        .from("contents")
        .insert({ folder_id: folder.id, title, format, notes, assignee_id: assigneeId })
        .select("*")
        .single();
      if (error) throw dbFail(error, "création du contenu");
      content = data as Content;
      contentId = content.id;

      if (resolved.length) {
        const rows = resolved.map((r) => newPubRow(contentId!, r.account, r.input));
        const { error: pe } = await sb.from("publications").insert(rows);
        if (pe) throw dbFail(pe, "création des publications");
      }
    } catch (err) {
      // Rien de partiel : on annule le contenu et les dossiers créés pour l'occasion.
      if (contentId) await sb.from("contents").delete().eq("id", contentId);
      if (created.length) await deleteFolders(sb, created);
      throw err;
    }

    const full = await loadContentFull(sb, content.id, appOrigin(req), { ctx, accounts, content, people });
    return json({ ...full, created_folders: created.map((f) => ctx.path(f.id)), warnings }, 201);
  });
}
