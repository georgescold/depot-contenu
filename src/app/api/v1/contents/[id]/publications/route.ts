import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentStatus } from "@/lib/status";
import type { Account, Content, Publication } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { newPubRow, parsePubInput, pubColumns } from "@/lib/api/publications";
import {
  accountLabel,
  candidatesForFolder,
  loadAccounts,
  loadFolderCtx,
  resolveAccountRef,
  type AccountCandidate,
  type FolderCtx,
} from "@/lib/api/resolve";
import { appOrigin, contentUrl, getContentRow, publicationWarnings, serializePublication } from "@/lib/api/serialize";
import { requireUuid, todayParis } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]/publications">;

/** Contexte commun : contenu, publications existantes et comptes utilisables. */
async function loadPubContext(sb: SupabaseClient, id: string) {
  const [content, pubsRes, folders, accounts] = await Promise.all([
    getContentRow(sb, id),
    sb.from("publications").select("*").eq("content_id", id),
    loadFolderCtx(sb),
    loadAccounts(sb),
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
  return { content, pubs, folders, candidates };
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
    const { content, pubs, folders, candidates } = await loadPubContext(sb, id);
    const account: Account = resolveAccountRef(folders, candidates, input.account, scopeOf(folders, content));

    const existing = pubs.find((p) => p.account_id === account.id);
    const cols = pubColumns(input);
    let row: Publication;
    if (existing) {
      if (!Object.keys(cols).length) {
        throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi date, time, title, description, posted, post_url.");
      }
      const { data, error } = await sb.from("publications").update(cols).eq("id", existing.id).select("*").single();
      if (error) throw dbFail(error, "mise à jour de la publication");
      row = data as Publication;
    } else {
      const { data, error } = await sb.from("publications").insert(newPubRow(id, account, input)).select("*").single();
      if (error) throw dbFail(error, "création de la publication");
      row = data as Publication;
    }

    const all = [...pubs.filter((p) => p.id !== row.id), row];
    const warnings = publicationWarnings(row, account);
    if (row.scheduled_time && !row.scheduled_date) {
      warnings.push(`${accountLabel(account)} : heure sans date, la publication n'est pas programmée.`);
    }
    return json(
      {
        publication: serializePublication(row, account),
        created: !existing,
        content: contentSummary(content, all, appOrigin(req)),
        warnings,
      },
      existing ? 200 : 201,
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
