import type { NextRequest } from "next/server";
import type { Account } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, fetchAll, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { accountLabel, loadAccounts, loadFolderCtx, normHandle } from "@/lib/api/resolve";
import { serializeAccount } from "@/lib/api/serialize";
import { optText, parseBool, requireUuid } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/accounts/[id]">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/accounts/:id { assignee?, handle?, url? } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du compte");
    const body = await readObject(req);
    const sb = getAdminClient();
    const [folders, accounts, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new ApiError(404, `Compte ${id} introuvable.`);

    const patch: Record<string, unknown> = {};
    const assigneeId = resolvePerson(peopleList, body.assignee);
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;
    const handleNew = optText(body, "handle", { max: 200 });
    if (handleNew !== undefined) {
      if (!handleNew) throw new ApiError(400, "Le handle ne peut pas être vide.");
      const clash = accounts.find(
        (a) => a.id !== id && a.folder_id === account.folder_id && a.platform === account.platform && normHandle(a.handle) === normHandle(handleNew),
      );
      if (clash) throw new ApiError(409, `Le compte ${accountLabel(clash)} existe déjà dans « ${folders.path(account.folder_id)} ».`);
      patch.handle = handleNew;
    }
    const url = optText(body, "url", { max: 2000 });
    if (url !== undefined) patch.url = url;
    if (!Object.keys(patch).length) throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi assignee, handle, url.");

    const { data, error } = await sb.from("accounts").update(patch).eq("id", id).select("*").single();
    if (error?.code === "23505") throw new ApiError(409, `Un compte ${account.platform} avec ce handle existe déjà dans ce dossier.`);
    if (error) throw dbFail(error, "mise à jour du compte");
    return json({ account: serializeAccount(data as Account, peopleMap(peopleList), folders) });
  });
}

/**
 * DELETE /api/v1/accounts/:id[?force=true][&dry_run=true]
 * Les publications du compte sont supprimées avec lui : s'il y en a de non postées, 409 sauf force=true.
 * dry_run=true : mêmes vérifications, rien n'est supprimé.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du compte");
    const sp = req.nextUrl.searchParams;
    const force = parseBool(sp.get("force") ?? "") === true;
    const dryRun = parseBool(sp.get("dry_run") ?? "") === true;
    const sb = getAdminClient();
    const [folders, accounts, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new ApiError(404, `Compte ${id} introuvable.`);

    const pubs = await fetchAll<{ content_id: string; posted: boolean }>(
      (from, to) => sb.from("publications").select("content_id, posted").eq("account_id", id).order("id").range(from, to),
      "lecture des publications",
    );
    const unposted = pubs.filter((p) => !p.posted);
    if (unposted.length && !force) {
      const contents = new Set(unposted.map((p) => p.content_id)).size;
      throw new ApiError(
        409,
        `Le compte ${accountLabel(account)} a ${unposted.length} publication(s) non postée(s) (sur ${contents} contenu(s)) : ` +
          `elles seraient supprimées avec lui. Ajoute force=true pour confirmer.`,
        { unposted_publications: unposted.length, contents },
      );
    }
    const summary = {
      account: serializeAccount(account, peopleMap(peopleList), folders),
      removed_publications: pubs.length,
      unposted_publications: unposted.length,
    };
    if (dryRun) return json({ dry_run: true, deleted: false, ...summary });

    const { error } = await sb.from("accounts").delete().eq("id", id);
    if (error) throw dbFail(error, "suppression du compte");
    return json({ deleted: true, ...summary });
  });
}
