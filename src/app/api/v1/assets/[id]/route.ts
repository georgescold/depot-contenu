import type { NextRequest } from "next/server";
import type { Asset } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { serializeAssets } from "@/lib/api/serialize";
import { removeObjects } from "@/lib/api/storage";
import { optInt, parseKind, requireUuid } from "@/lib/api/validate";
import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = RouteContext<"/api/v1/assets/[id]">;

async function getAsset(sb: SupabaseClient, id: string): Promise<Asset> {
  const { data, error } = await sb.from("assets").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFail(error, "lecture du fichier");
  if (!data) throw new ApiError(404, `Fichier ${id} introuvable.`);
  return data as Asset;
}

/** PATCH /api/v1/assets/:id { kind?, position? } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du fichier");
    const body = await readObject(req);
    const patch: Record<string, unknown> = {};
    if (body.kind !== undefined && body.kind !== null) patch.kind = parseKind(body.kind);
    const position = optInt(body, "position", 0, 100000);
    if (position !== undefined) patch.position = position;
    if (!Object.keys(patch).length) throw new ApiError(400, "Rien à modifier : fournis kind et/ou position.");

    const sb = getAdminClient();
    await getAsset(sb, id);
    const { data, error } = await sb.from("assets").update(patch).eq("id", id).select("*").single();
    if (error) throw dbFail(error, "mise à jour du fichier");
    const [asset] = await serializeAssets(sb, [data as Asset]);
    return json({ asset });
  });
}

/** DELETE /api/v1/assets/:id : supprime l'objet du bucket puis la ligne. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du fichier");
    const sb = getAdminClient();
    const asset = await getAsset(sb, id);
    await removeObjects(sb, [asset.storage_path]);
    const { error } = await sb.from("assets").delete().eq("id", id);
    if (error) throw dbFail(error, "suppression du fichier");
    return json({ deleted: true, id, content_id: asset.content_id, file_name: asset.file_name });
  });
}
