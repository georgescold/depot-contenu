import type { NextRequest } from "next/server";
import { childrenOf } from "@/lib/folders";
import type { Folder } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { loadFolderCtx, normName, resolveFolder } from "@/lib/api/resolve";
import { serializeFolder } from "@/lib/api/serialize";
import { optColor, optText } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/folders/[id]">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/folders/:id { assignee?, name?, color?, description? }
 * `:id` = uuid du dossier, ou son chemin encodé (ex. Projet%2FAngle).
 * Le nom ne peut pas contenir « / », « > » ni « › » (séparateurs de chemin) et doit être unique parmi ses voisins.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const raw = (await ctx.params).id;
    let ref = raw;
    try {
      ref = decodeURIComponent(raw);
    } catch {
      // déjà décodé (contient un « % » littéral)
    }
    const body = await readObject(req);
    const sb = getAdminClient();
    const [folders, peopleList] = await Promise.all([loadFolderCtx(sb), loadPeople(sb)]);
    const { folder } = await resolveFolder(sb, folders, ref, { label: "id" });

    const patch: Record<string, unknown> = {};
    const assigneeId = resolvePerson(peopleList, body.assignee);
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;

    const name = optText(body, "name", { max: 200 })?.replace(/\s+/g, " ");
    if (name !== undefined) {
      if (!name) throw new ApiError(400, "Le nom du dossier ne peut pas être vide.");
      if (/[/>›]/.test(name)) throw new ApiError(400, `Nom « ${name} » refusé : « / », « > » et « › » servent de séparateurs de chemin (utilise « - »).`);
      if (/[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, "Le nom contient des caractères de contrôle.");
      const clash = childrenOf(folders.index, folder.parent_id).find((f) => f.id !== folder.id && normName(f.name) === normName(name));
      if (clash) throw new ApiError(409, `Un dossier « ${clash.name} » existe déjà au même niveau (${folders.path(clash.id)}).`);
      patch.name = name;
    }
    const color = optColor(body);
    if (color !== undefined) patch.color = color;
    const description = optText(body, "description", { max: 5000 });
    if (description !== undefined) patch.description = description;

    if (!Object.keys(patch).length) {
      throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi assignee, name, color, description.");
    }
    const { data, error } = await sb.from("folders").update(patch).eq("id", folder.id).select("*").single();
    if (error?.code === "23505") throw new ApiError(409, `Un dossier « ${name} » existe déjà au même niveau.`);
    if (error) throw dbFail(error, "mise à jour du dossier");
    folders.replace(data as Folder);
    return json({ folder: serializeFolder(data as Folder, folders, peopleMap(peopleList)) });
  });
}
