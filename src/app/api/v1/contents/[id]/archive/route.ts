import type { NextRequest } from "next/server";
import { ARCHIVE_SELECT, archiveContentFiles, filesToArchive, isFullyPosted, type ArchivableContent } from "@/lib/archive";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { appOrigin, contentUrl } from "@/lib/api/serialize";
import { optBool, requireUuid } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/contents/[id]/archive">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/contents/:id/archive [{ dry_run?: true }]
 * Libère le stockage tout de suite (comme « Supprimer maintenant » dans l'app) : fichiers lourds retirés de B2,
 * fiche, légendes, dates, lignes `assets` (archived_at) et une miniature ≤ 2 Mo gardées.
 * 409 si le contenu n'est pas posté sur tous ses comptes. Un nouvel appel ne fait rien (déjà archivé).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const body = await readObject(req);
    const dryRun = optBool(body, "dry_run") === true || req.nextUrl.searchParams.get("dry_run") === "true";
    const sb = getAdminClient();
    const { data, error } = await sb.from("contents").select(`${ARCHIVE_SELECT}, title`).eq("id", id).maybeSingle();
    if (error) throw dbFail(error, "lecture du contenu");
    if (!data) throw new ApiError(404, `Contenu ${id} introuvable.`);
    const content = data as unknown as ArchivableContent & { title: string; assets: { id: string; size_bytes: number }[] };

    if (!isFullyPosted(content.publications)) {
      const posted = content.publications.filter((p) => p.posted).length;
      throw new ApiError(
        409,
        `« ${content.title} » n'est pas encore posté sur tous ses comptes (${posted}/${content.publications.length} publication(s) postée(s)) : ` +
          `ses fichiers ne peuvent pas encore être retirés. Marque d'abord les publications comme postées.`,
        { posted, publications: content.publications.length },
      );
    }

    const targets = filesToArchive(content.assets);
    const kept = content.assets.filter((a) => !a.archived_at && !targets.some((t) => t.id === a.id)).map((a) => a.id);
    const url = contentUrl(appOrigin(req), id);
    if (dryRun) {
      return json({
        dry_run: true,
        archived: false,
        would_archive_ids: targets.map((a) => a.id),
        freed_bytes: targets.reduce((n, a) => n + (a.size_bytes || 0), 0),
        kept_ids: kept,
        keep_files: content.keep_files,
        content: { id, title: content.title, url },
      });
    }

    let res: Awaited<ReturnType<typeof archiveContentFiles>>;
    try {
      res = await archiveContentFiles(sb, content);
    } catch (e) {
      throw new ApiError(502, `Stockage : suppression des fichiers impossible (${e instanceof Error ? e.message : String(e)}). Rien n'a été marqué archivé.`);
    }
    return json({
      archived_ids: res.archivedIds,
      freed_bytes: res.freedBytes,
      archived_at: res.archivedAt,
      kept_ids: kept,
      already_archived: res.archivedIds.length === 0,
      content: { id, title: content.title, url },
    });
  });
}
