import type { NextRequest } from "next/server";
import type { Content, Folder, Publication } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { accountLabel, candidatesForFolder, deleteFolders, loadAccounts, loadFolderCtx, resolveFolder } from "@/lib/api/resolve";
import { appOrigin, getContentRow, loadContentFull } from "@/lib/api/serialize";
import { purgeObjects } from "@/lib/api/storage";
import { optBool, optFormat, optText, requireUuid } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]">;

/** GET /api/v1/contents/:id : contenu complet (fichiers avec liens signés 1 h). */
export async function GET(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const sb = getAdminClient();
    return json(await loadContentFull(sb, id, appOrigin(req)));
  });
}

/** PATCH /api/v1/contents/:id { title?, format?, notes?, folder?, create_folders?, assignee? } (assignee "none" = retirer) */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const body = await readObject(req);
    const sb = getAdminClient();
    const current = await getContentRow(sb, id);

    const patch: Record<string, unknown> = {};
    const title = optText(body, "title", { max: 500 });
    if (title !== undefined) {
      if (!title) throw new ApiError(400, "Le titre ne peut pas être vide.");
      patch.title = title;
    }
    const format = optFormat(body);
    if (format) patch.format = format;
    const notes = optText(body, "notes", { max: 100000, trim: false });
    if (notes !== undefined) patch.notes = notes.trim();

    const [folders, accounts, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const assigneeId = resolvePerson(peopleList, body.assignee);
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;
    const warnings: string[] = [];
    let createdFolders: string[] = [];
    let createdRows: Folder[] = [];
    if (body.folder !== undefined && body.folder !== null && body.folder !== "") {
      const { folder, created } = await resolveFolder(sb, folders, body.folder, {
        create: optBool(body, "create_folders"),
      });
      createdRows = created;
      createdFolders = created.map((f) => folders.path(f.id));
      if (folder.id !== current.folder_id) {
        patch.folder_id = folder.id;
        // Publications dont le compte n'est plus accessible depuis le nouveau dossier
        const allowed = new Set(candidatesForFolder(folders, accounts, folder.id).map((c) => c.account.id));
        const { data: pubs, error } = await sb.from("publications").select("account_id").eq("content_id", id);
        if (error) throw dbFail(error, "lecture des publications");
        const byId = new Map(accounts.map((a) => [a.id, a]));
        for (const p of (pubs ?? []) as Pick<Publication, "account_id">[]) {
          if (!allowed.has(p.account_id)) {
            const a = byId.get(p.account_id);
            warnings.push(
              `La publication sur ${a ? accountLabel(a) : p.account_id} est conservée, mais ce compte n'est pas rattaché au nouveau dossier ni à ses parents.`,
            );
          }
        }
      }
    }

    if (!Object.keys(patch).length && !createdFolders.length) {
      throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi title, format, notes, folder, assignee.");
    }

    let content: Content = current;
    if (Object.keys(patch).length) {
      const { data, error } = await sb.from("contents").update(patch).eq("id", id).select("*").single();
      if (error) {
        if (createdRows.length) await deleteFolders(sb, createdRows);
        throw dbFail(error, "mise à jour du contenu");
      }
      content = data as Content;
    }

    const full = await loadContentFull(sb, id, appOrigin(req), { ctx: folders, accounts, content, people: peopleMap(peopleList) });
    return json({ ...full, created_folders: createdFolders, warnings });
  });
}

/**
 * DELETE /api/v1/contents/:id : supprime d'abord la ligne (publications et fichiers en cascade),
 * puis, au mieux, les objets du stockage (ceux des fichiers + tout le préfixe <id>/).
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const sb = getAdminClient();
    const content = await getContentRow(sb, id);

    const { data: assets, error } = await sb.from("assets").select("storage_path").eq("content_id", id);
    if (error) throw dbFail(error, "lecture des fichiers");
    const paths = ((assets ?? []) as { storage_path: string }[]).map((a) => a.storage_path);

    const { error: de } = await sb.from("contents").delete().eq("id", id);
    if (de) throw dbFail(de, "suppression du contenu");

    const { removed, warnings } = await purgeObjects(paths, id);
    return json({ deleted: true, id, title: content.title, removed_files: removed, warnings });
  });
}
