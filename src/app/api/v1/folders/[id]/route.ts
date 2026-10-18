import type { NextRequest } from "next/server";
import { childrenOf } from "@/lib/folders";
import type { Account, Folder } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, fetchAll, handle, json, readObject } from "@/lib/api/http";
import { publicationsOutsideChain } from "@/lib/api/moves";
import { loadPeople, peopleMap, resolvePerson } from "@/lib/api/people";
import { accountLabel, decodeRefParam, loadAccounts, loadFolderCtx, normName, resolveFolder } from "@/lib/api/resolve";
import { serializeFolder } from "@/lib/api/serialize";
import { optColor, optText, parseBool } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/folders/[id]">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

const ROOT_WORDS = new Set(["", "root", "racine", "/"]);

/**
 * PATCH /api/v1/folders/:id { assignee?, name?, color?, description?, parent? }
 * `:id` = uuid du dossier, ou son chemin encodé (ex. Projet%2FAngle).
 * `parent` = id ou chemin du nouveau parent ; null, "" ou "root" = racine (déplacement).
 * Le nom ne peut pas contenir « / », « > » ni « › » (séparateurs de chemin) et doit être unique parmi ses voisins.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const ref = decodeRefParam((await ctx.params).id);
    const body = await readObject(req);
    const sb = getAdminClient();
    const [folders, peopleList, accounts] = await Promise.all([loadFolderCtx(sb), loadPeople(sb), loadAccounts(sb)]);
    const { folder } = await resolveFolder(sb, folders, ref, { label: "id" });

    const patch: Record<string, unknown> = {};
    const assigneeId = resolvePerson(peopleList, body.assignee);
    if (assigneeId !== undefined) patch.assignee_id = assigneeId;

    // Déplacement
    let parentId: string | null = folder.parent_id;
    let moved = false;
    if (Object.prototype.hasOwnProperty.call(body, "parent")) {
      const p = body.parent;
      if (p === null || (typeof p === "string" && ROOT_WORDS.has(p.trim().toLowerCase()))) parentId = null;
      else parentId = (await resolveFolder(sb, folders, p, { label: "parent" })).folder.id;
      if (parentId && folders.subtree(folder.id).has(parentId)) {
        throw new ApiError(
          400,
          parentId === folder.id
            ? `Impossible : « ${folders.path(folder.id)} » ne peut pas être rangé dans lui-même.`
            : `Impossible : « ${folders.path(parentId)} » est un sous-dossier de « ${folders.path(folder.id)} » (un dossier ne peut pas être rangé dans un de ses sous-dossiers).`,
        );
      }
      if (parentId !== folder.parent_id) {
        moved = true;
        patch.parent_id = parentId;
        patch.position = childrenOf(folders.index, parentId).reduce((m, f) => Math.max(m, f.position + 1), 0);
      }
    }

    let name: string | undefined = optText(body, "name", { max: 200 })?.replace(/\s+/g, " ");
    if (name !== undefined) {
      if (!name) throw new ApiError(400, "Le nom du dossier ne peut pas être vide.");
      if (/[/>›]/.test(name)) throw new ApiError(400, `Nom « ${name} » refusé : « / », « > » et « › » servent de séparateurs de chemin (utilise « - »).`);
      if (/[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, "Le nom contient des caractères de contrôle.");
      patch.name = name;
    }
    // Unicité du nom chez les (nouveaux) voisins, pour un renommage comme pour un déplacement.
    if (name !== undefined || moved) {
      const finalName = name ?? folder.name;
      const clash = childrenOf(folders.index, parentId).find((f) => f.id !== folder.id && normName(f.name) === normName(finalName));
      if (clash) {
        throw new ApiError(409, `Un dossier « ${clash.name} » existe déjà dans ${parentId ? `« ${folders.path(parentId)} »` : "la racine"}.`);
      }
      name = finalName;
    }
    const color = optColor(body);
    if (color !== undefined) patch.color = color;
    const description = optText(body, "description", { max: 5000 });
    if (description !== undefined) patch.description = description;

    if (!Object.keys(patch).length) {
      // Déplacement vers l'endroit où il est déjà : rien à faire, ce n'est pas une erreur.
      if (Object.prototype.hasOwnProperty.call(body, "parent")) {
        return json({ folder: serializeFolder(folder, folders, peopleMap(peopleList)), moved: false, warnings: [] });
      }
      throw new ApiError(400, "Rien à modifier : fournis au moins un champ parmi assignee, name, color, description, parent.");
    }
    const { data, error } = await sb.from("folders").update(patch).eq("id", folder.id).select("*").single();
    if (error?.code === "23505") throw new ApiError(409, `Un dossier « ${name} » existe déjà au même niveau.`);
    // Trigger folders_prevent_cycle (course avec un autre déplacement)
    if (error?.code === "P0001") throw new ApiError(400, `Déplacement refusé : ${error.message}`);
    if (error) throw dbFail(error, "mise à jour du dossier");
    folders.replace(data as Folder);

    const warnings = moved ? await publicationsOutsideChain(sb, folders, accounts, [...folders.subtree(folder.id)]) : [];
    return json({ folder: serializeFolder(data as Folder, folders, peopleMap(peopleList)), moved, warnings });
  });
}

/**
 * DELETE /api/v1/folders/:id[?force=true][&dry_run=true]
 * Refusé (409) si le dossier contient des sous-dossiers ou des contenus (pas de suppression récursive).
 * Ses comptes sont supprimés avec lui, et leurs publications aussi : s'il y en a de non postées, 409 sauf force=true.
 * dry_run=true : mêmes vérifications, rien n'est supprimé.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const ref = decodeRefParam((await ctx.params).id);
    const sp = req.nextUrl.searchParams;
    const force = parseBool(sp.get("force") ?? "") === true;
    const dryRun = parseBool(sp.get("dry_run") ?? "") === true;
    const sb = getAdminClient();
    const [folders, accounts] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb)]);
    const { folder } = await resolveFolder(sb, folders, ref, { label: "id" });
    const path = folders.path(folder.id);

    const subfolders = childrenOf(folders.index, folder.id).length;
    const { count: contents, error: ce } = await sb.from("contents").select("id", { count: "exact", head: true }).eq("folder_id", folder.id);
    if (ce) throw dbFail(ce, "comptage des contenus");
    if (subfolders || contents) {
      throw new ApiError(
        409,
        `Le dossier « ${path} » n'est pas vide : ${subfolders} sous-dossier(s) et ${contents ?? 0} contenu(s). ` +
          `Vide-le d'abord (déplace ou supprime ce qu'il contient) : la suppression n'est jamais récursive.`,
        { subfolders, contents: contents ?? 0 },
      );
    }

    const own: Account[] = accounts.filter((a) => a.folder_id === folder.id);
    const pubs = own.length
      ? await fetchAll<{ account_id: string; posted: boolean }>(
          (from, to) =>
            sb.from("publications").select("account_id, posted").in("account_id", own.map((a) => a.id)).order("id").range(from, to),
          "lecture des publications",
        )
      : [];
    const unposted = own
      .map((a) => ({ account: a, n: pubs.filter((p) => p.account_id === a.id && !p.posted).length }))
      .filter((x) => x.n > 0);
    const unpostedTotal = unposted.reduce((n, x) => n + x.n, 0);
    if (unpostedTotal && !force) {
      throw new ApiError(
        409,
        `Le dossier « ${path} » porte des comptes avec des publications non postées : ` +
          `${unposted.map((x) => `${accountLabel(x.account)} (${x.n})`).join(", ")}. ` +
          `Supprimer le dossier supprimerait ces comptes et ${unpostedTotal} publication(s) non postée(s). Ajoute force=true pour confirmer.`,
        { unposted_publications: unpostedTotal, accounts: unposted.map((x) => ({ id: x.account.id, ref: accountLabel(x.account), unposted: x.n })) },
      );
    }

    const summary = {
      path,
      removed_accounts: own.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, ref: accountLabel(a) })),
      removed_publications: pubs.length,
      unposted_publications: unpostedTotal,
    };
    if (dryRun) return json({ dry_run: true, deleted: false, ...summary });

    const { error } = await sb.from("folders").delete().eq("id", folder.id);
    if (error?.code === "23503") {
      throw new ApiError(409, `Le dossier « ${path} » n'est plus vide (un contenu ou un sous-dossier vient d'y être ajouté).`);
    }
    if (error) throw dbFail(error, "suppression du dossier");
    return json({ deleted: true, ...summary });
  });
}
