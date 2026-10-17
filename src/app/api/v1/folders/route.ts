import type { NextRequest } from "next/server";
import { flattenTree } from "@/lib/folders";
import type { Folder } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, fetchAll, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { loadAccounts, loadFolderCtx, resolveFolder } from "@/lib/api/resolve";
import { serializeAccount, serializeFolder } from "@/lib/api/serialize";
import { optColor, optText } from "@/lib/api/validate";

/** GET /api/v1/folders : arborescence à plat (ordre de parcours en profondeur). */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const sb = getAdminClient();
    const [ctx, accounts, contentRows, peopleList] = await Promise.all([
      loadFolderCtx(sb),
      loadAccounts(sb),
      fetchAll<{ folder_id: string }>(
        (from, to) => sb.from("contents").select("folder_id").order("id").range(from, to),
        "comptage des contenus",
      ),
      loadPeople(sb),
    ]);
    const people = peopleMap(peopleList);

    const own = new Map<string, number>();
    for (const r of contentRows) own.set(r.folder_id, (own.get(r.folder_id) ?? 0) + 1);

    const folders = flattenTree(ctx.index).map(({ folder }) => {
      let total = 0;
      for (const id of ctx.subtree(folder.id)) total += own.get(id) ?? 0;
      return {
        ...serializeFolder(folder, ctx, people),
        contents_count: own.get(folder.id) ?? 0,
        total_contents: total,
        accounts: accounts
          .filter((a) => a.folder_id === folder.id)
          .sort((a, b) => a.position - b.position || a.platform.localeCompare(b.platform))
          .map((a) => serializeAccount(a, people)),
      };
    });

    return json({ folders });
  });
}

/** POST /api/v1/folders { path, color?, description?, assignee? } : crée le chemin (mkdir -p). */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const body = await readObject(req);
    const path = optText(body, "path") ?? optText(body, "folder") ?? optText(body, "name");
    if (!path) throw new ApiError(400, "Le champ « path » est obligatoire (ex. « Projet/Sous-projet/Angle »).");
    const color = optColor(body);
    const description = optText(body, "description", { max: 5000 });

    const sb = getAdminClient();
    const [ctx, peopleList] = await Promise.all([loadFolderCtx(sb), loadPeople(sb)]);
    // Avant toute création : une personne inconnue ne doit pas laisser de dossiers derrière elle.
    const assigneeId = resolvePerson(peopleList, body.assignee);
    const { folder, created } = await resolveFolder(sb, ctx, path, { create: true, label: "path" });

    let final: Folder = folder;
    const patch: Record<string, unknown> = {};
    if (color !== undefined) patch.color = color;
    if (description !== undefined) patch.description = description;
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;
    if (Object.keys(patch).length) {
      const { data, error } = await sb.from("folders").update(patch).eq("id", folder.id).select("*").single();
      if (error) throw dbFail(error, "mise à jour du dossier");
      final = data as Folder;
      ctx.replace(final);
    }
    // Nouveau projet créé d'un coup : toute la branche prend la couleur demandée.
    if (color && created.length > 1 && created[0].parent_id === null) {
      const ids = created.filter((f) => f.id !== final.id).map((f) => f.id);
      const { data, error } = await sb.from("folders").update({ color }).in("id", ids).select("*");
      if (error) throw dbFail(error, "couleur des dossiers");
      for (const f of (data ?? []) as Folder[]) ctx.replace(f);
    }

    return json(
      {
        folder: serializeFolder(final, ctx, peopleMap(peopleList)),
        created: created.map((f) => ctx.path(f.id)),
        existed: created.length === 0,
      },
      created.length ? 201 : 200,
    );
  });
}
