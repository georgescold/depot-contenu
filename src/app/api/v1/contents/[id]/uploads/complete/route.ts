import type { NextRequest } from "next/server";
import { abortMultipartUpload, completeMultipartUpload, contentIdOfPath, isStoragePath } from "@/lib/b2";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, handle, json, readObject } from "@/lib/api/http";
import { getContentRow } from "@/lib/api/serialize";
import { optText, requireUuid } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/contents/[id]/uploads/complete">) : ne dépend pas
// des types générés par le dernier `next build`, qui ne connaissent pas encore cette route.
type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/contents/:id/uploads/complete
 * { path, upload_id, parts: [{ part, etag }] } : termine un envoi multipart (parts 1..N contiguës) ;
 * { path, upload_id, abort: true } : l'annule (les parts déjà envoyées sont supprimées).
 * Le fichier doit ensuite être enregistré avec POST /api/v1/contents/:id/assets.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const body = await readObject(req);
    const path = body.path;
    if (!isStoragePath(path) || contentIdOfPath(path) !== id) {
      throw new ApiError(400, `Chemin « ${String(path ?? "")} » invalide pour ce contenu : utilise le path renvoyé par /uploads.`);
    }
    const uploadId = optText(body, "upload_id", { max: 1000 });
    if (!uploadId) throw new ApiError(400, "Le champ « upload_id » est obligatoire.");

    if (body.abort === true) {
      await abortMultipartUpload(path, uploadId);
      return json({ aborted: true, path });
    }

    if (!Array.isArray(body.parts) || body.parts.length === 0) {
      throw new ApiError(400, "« parts » doit être une liste non vide de { part, etag }.");
    }
    const parts = body.parts.map((p, i) => {
      const o = (p && typeof p === "object" ? p : {}) as { part?: unknown; etag?: unknown };
      const part = Number(o.part);
      const etag = typeof o.etag === "string" ? o.etag.trim() : "";
      if (!Number.isInteger(part) || part < 1 || !etag) {
        throw new ApiError(400, `Part n°${i + 1} invalide : il faut { part: entier ≥ 1, etag: texte } (ETag renvoyé par le PUT).`);
      }
      return { part, etag };
    });
    const sorted = [...parts].sort((a, b) => a.part - b.part);
    const gap = sorted.findIndex((p, i) => p.part !== i + 1);
    if (gap !== -1) {
      throw new ApiError(400, `Parts incomplètes : la part ${gap + 1} manque ou est en double (numéros attendus : 1 à ${sorted.length}, sans trou).`);
    }

    const sb = getAdminClient();
    try {
      await getContentRow(sb, id);
    } catch (e) {
      await abortMultipartUpload(path, uploadId);
      throw e;
    }

    try {
      await completeMultipartUpload(path, uploadId, sorted);
    } catch (e) {
      throw new ApiError(502, `Stockage : fin d'envoi impossible pour « ${path} » (${e instanceof Error ? e.message : e}).`);
    }
    return json({ completed: true, path, parts: sorted.length });
  });
}
