import type { NextRequest } from "next/server";
import type { Account } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { accountLabel, loadAccounts, loadFolderCtx, normHandle } from "@/lib/api/resolve";
import { serializeAccount } from "@/lib/api/serialize";
import { optText, requireUuid } from "@/lib/api/validate";

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
