import type { NextRequest } from "next/server";
import type { Account } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { accountLabel, deleteFolders, loadAccounts, loadFolderCtx, normHandle, resolveFolder } from "@/lib/api/resolve";
import { serializeAccount } from "@/lib/api/serialize";
import { optBool, optText, requirePlatform } from "@/lib/api/validate";

/** POST /api/v1/accounts { folder, platform, handle, url?, assignee?, create_folders? } */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const body = await readObject(req);
    const platform = requirePlatform(body.platform);
    const handleRaw = optText(body, "handle", { max: 200 }) ?? "";
    const url = optText(body, "url", { max: 2000 }) ?? "";
    if (!handleRaw && !url) {
      throw new ApiError(400, "Le champ « handle » est obligatoire (ex. « @didier.immo »).");
    }

    const sb = getAdminClient();
    const [ctx, accounts, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const people = peopleMap(peopleList);
    const assigneeId = resolvePerson(peopleList, body.assignee);
    const { folder, created } = await resolveFolder(sb, ctx, body.folder, { create: optBool(body, "create_folders") });

    try {
      const siblings = accounts.filter((a) => a.folder_id === folder.id);
      const dup = siblings.find((a) => a.platform === platform && normHandle(a.handle) === normHandle(handleRaw));
      if (dup) {
        throw new ApiError(409, `Le compte ${accountLabel(dup)} existe déjà dans « ${ctx.path(folder.id)} ».`, {
          account: serializeAccount(dup, people, ctx),
        });
      }

      const position = siblings.reduce((m, a) => Math.max(m, a.position + 1), 0);
      const { data, error } = await sb
        .from("accounts")
        .insert({ folder_id: folder.id, platform, handle: handleRaw, url, position, assignee_id: assigneeId ?? null })
        .select("*")
        .single();
      if (error?.code === "23505") {
        throw new ApiError(
          409,
          `Le compte ${accountLabel({ platform, handle: handleRaw })} existe déjà dans « ${ctx.path(folder.id)} » (même plateforme et même handle).`,
        );
      }
      if (error) throw dbFail(error, "création du compte");
      return json({ account: serializeAccount(data as Account, people, ctx) }, 201);
    } catch (err) {
      if (created.length) await deleteFolders(sb, created);
      throw err;
    }
  });
}
