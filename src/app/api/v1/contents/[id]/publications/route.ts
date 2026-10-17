import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentStatus } from "@/lib/status";
import type { Account, Content, Publication } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { newPubRow, parsePubInput, pastDateWarning, pubColumns } from "@/lib/api/publications";
import {
  accountLabel,
  candidatesForFolder,
  loadAccounts,
  loadFolderCtx,
  resolveAccountRef,
  type AccountCandidate,
  type FolderCtx,
} from "@/lib/api/resolve";
import { loadPeople, peopleMap } from "@/lib/api/people";
import { appOrigin, contentUrl, getContentRow, pubAssignee, publicationWarnings, serializePublication } from "@/lib/api/serialize";
import { requireUuid, todayParis } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]/publications">;

/** Contexte commun : contenu, publications existantes et comptes utilisables. */
async function loadPubContext(sb: SupabaseClient, id: string) {
  const [content, pubsRes, folders, accounts, people] = await Promise.all([
    getContentRow(sb, id),
    sb.from("publications").select("*").eq("content_id", id),
    loadFolderCtx(sb),
    loadAccounts(sb),
    loadPeople(sb).then(peopleMap),
  ]);
  if (pubsRes.error) throw dbFail(pubsRes.error, "lecture des publications");
  const pubs = (pubsRes.data ?? []) as Publication[];
  const candidates: AccountCandidate[] = candidatesForFolder(folders, accounts, content.folder_id);
  // Comptes déjà utilisés par ce contenu mais hors arborescence (contenu déplacé)
  const known = new Set(candidates.map((c) => c.account.id));
  for (const p of pubs) {
    const a = accounts.find((x) => x.id === p.account_id);
    if (a && !known.has(a.id)) {
      candidates.push({ account: a, depth: -1 });
      known.add(a.id);
    }
  }
  return { content, pubs, folders, candidates, people };
}

function contentSummary(content: Content, pubs: Publication[], origin: string) {
  return {
    id: content.id,
    title: content.title,
    status: contentStatus(pubs, todayParis()),
    url: contentUrl(origin, content.id),
  };
}

const scopeOf = (folders: FolderCtx, content: Content) => `contenu « ${content.title} », dossier « ${folders.path(content.folder_id)} »`;

/**
 * PUT /api/v1/contents/:id/publications
 * { account, date?, time?, title?, description?, posted?, post_url? }
 * Upsert sur (contenu, compte) : seuls les champs fournis sont modifiés ; date: null déprogramme.
 */
export async function PUT(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const input = parsePubInput(await readObject(req));
    const sb = getAdminClient();
    const { content, pubs, folders, candidates, people } = await loadPubContext(sb, id);
    const account: Account = resolveAccountRef(folders, candidates, input.account, scopeOf(folders, content));

    let existing = pubs.find((p) => p.account_id === account.id);
    const cols = pubColumns(input);
    if (existing && !Object.keys(cols).length) {
      throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi date, time, title, description, posted, post_url.");
    }
    const update = async (pubId: string): Promise<Publication> => {
      if (!Object.keys(cols).length) {
        const { data, error } = await sb.from("publications").select("*").eq("id", pubId).single();
        if (error) throw dbFail(error, "lecture de la publication");
        return data as Publication;
      }
      const { data, error } = await sb.from("publications").update(cols).eq("id", pubId).select("*").single();
      if (error) throw dbFail(error, "mise à jour de la publication");
      return data as Publication;
    };

    let row: Publication;
    let created = false;
    if (existing) {
      row = await update(existing.id);
    } else {
      const { data, error } = await sb.from("publications").insert(newPubRow(id, account, input)).select("*").single();
      if (error?.code === "23505") {
        // Course : une autre requête vient de créer la publication (contenu, compte). On la relit et on la met à jour.
        const { data: again, error: re } = await sb
          .from("publications")
          .select("*")
          .eq("content_id", id)
          .eq("account_id", account.id)
          .maybeSingle();
        if (re) throw dbFail(re, "lecture de la publication");
        if (!again) throw dbFail(error, "création de la publication");
        existing = again as Publication;
        row = await update(existing.id);
      } else {
        if (error) throw dbFail(error, "création de la publication");
        row = data as Publication;
        created = true;
      }
    }

    const all = [...pubs.filter((p) => p.id !== row.id), row];
    const warnings = publicationWarnings(row, account);
    if (row.scheduled_time && !row.scheduled_date) {
      warnings.push(`${accountLabel(account)} : heure sans date, la publication n'est pas programmée.`);
    }
    if (input.date !== undefined || input.time !== undefined) {
      const past = pastDateWarning(account, { date: row.scheduled_date, time: row.scheduled_time, posted: row.posted });
      if (past) warnings.push(past);
    }
    return json(
      {
        publication: serializePublication(row, account, todayParis(), pubAssignee(folders, people, content, account)),
        created,
        content: contentSummary(content, all, appOrigin(req)),
        warnings,
      },
      created ? 201 : 200,
    );
  });
}

/** DELETE /api/v1/contents/:id/publications?account=… */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const ref = req.nextUrl.searchParams.get("account");
    if (!ref?.trim()) throw new ApiError(400, "Paramètre « account » obligatoire (ex. ?account=instagram).");
    const sb = getAdminClient();
    const { content, pubs, folders, candidates } = await loadPubContext(sb, id);
    const account = resolveAccountRef(folders, candidates, ref, scopeOf(folders, content));
    const existing = pubs.find((p) => p.account_id === account.id);
    if (!existing) {
      throw new ApiError(404, `Ce contenu n'a pas de publication sur ${accountLabel(account)}.`);
    }
    const { error } = await sb.from("publications").delete().eq("id", existing.id);
    if (error) throw dbFail(error, "suppression de la publication");
    return json({
      deleted: true,
      publication_id: existing.id,
      account: { id: account.id, platform: account.platform, handle: account.handle, ref: accountLabel(account) },
      content: contentSummary(content, pubs.filter((p) => p.id !== existing.id), appOrigin(req)),
    });
  });
}
