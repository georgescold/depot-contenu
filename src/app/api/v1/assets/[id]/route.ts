import type { NextRequest } from "next/server";
import type { Asset } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { serializeAssets } from "@/lib/api/serialize";
import { purgeObjects } from "@/lib/api/storage";
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
    const current = await getAsset(sb, id);
    // Changement de type sans position : le fichier passe à la fin de son nouveau type.
    if (patch.kind && patch.kind !== current.kind && patch.position === undefined) {
      const { data: same, error: se } = await sb
        .from("assets")
        .select("position")
        .eq("content_id", current.content_id)
        .eq("kind", patch.kind as string);
      if (se) throw dbFail(se, "lecture des fichiers");
      patch.position = ((same ?? []) as { position: number }[]).reduce((m, a) => Math.max(m, a.position + 1), 0);
    }
    const { data, error } = await sb.from("assets").update(patch).eq("id", id).select("*").single();
    if (error) throw dbFail(error, "mise à jour du fichier");
    const [asset] = await serializeAssets([data as Asset]);
    return json({ asset });
  });
}

/** DELETE /api/v1/assets/:id : supprime la ligne, puis l'objet du stockage (au mieux). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du fichier");
    const sb = getAdminClient();
    const asset = await getAsset(sb, id);
    const { error } = await sb.from("assets").delete().eq("id", id);
    if (error) throw dbFail(error, "suppression du fichier");
    const { warnings } = await purgeObjects([asset.storage_path]);
    return json({ deleted: true, id, content_id: asset.content_id, file_name: asset.file_name, warnings });
  });
}
