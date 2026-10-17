import type { NextRequest } from "next/server";
import type { Account } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { accountLabel, loadAccounts, loadFolderCtx, normHandle, resolveFolder } from "@/lib/api/resolve";
import { serializeAccount } from "@/lib/api/serialize";
import { optBool, optText, requirePlatform } from "@/lib/api/validate";

/** POST /api/v1/accounts { folder, platform, handle, url?, create_folders? } */
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
    const [ctx, accounts] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb)]);
    const { folder } = await resolveFolder(sb, ctx, body.folder, { create: optBool(body, "create_folders") });

    const siblings = accounts.filter((a) => a.folder_id === folder.id);
    const dup = siblings.find((a) => a.platform === platform && normHandle(a.handle) === normHandle(handleRaw));
    if (dup) {
      throw new ApiError(409, `Le compte ${accountLabel(dup)} existe déjà dans « ${ctx.path(folder.id)} ».`, {
        account: serializeAccount(dup, ctx),
      });
    }

    const position = siblings.reduce((m, a) => Math.max(m, a.position + 1), 0);
    const { data, error } = await sb
      .from("accounts")
      .insert({ folder_id: folder.id, platform, handle: handleRaw, url, position })
      .select("*")
      .single();
    if (error) throw dbFail(error, "création du compte");

    return json({ account: serializeAccount(data as Account, ctx) }, 201);
  });
}
