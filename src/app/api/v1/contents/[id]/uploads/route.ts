import type { NextRequest } from "next/server";
import { MAX_FILE_MB, STORAGE_BUCKET } from "@/lib/constants";
import { buildStoragePath, guessMime, inferKind } from "@/lib/storage-path";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, handle, json, readJson } from "@/lib/api/http";
import { getContentRow } from "@/lib/api/serialize";
import { MAX_FILE_BYTES, tooBigMessage } from "@/lib/api/storage";
import { listOf, optInt, optText, parseKind, requireUuid } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]/uploads">;

/**
 * POST /api/v1/contents/:id/uploads { files: [{ name, kind?, content_type?, size? }] }
 * Renvoie une URL d'envoi signée par fichier (PUT direct vers Supabase Storage, valable 2 h).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const files = listOf(await readJson(req), "files");
    if (files.length > 100) throw new ApiError(400, "100 fichiers maximum par requête.");

    const specs = files.map((f, i) => {
      const name = optText(f, "name", { max: 300 }) ?? optText(f, "file_name", { max: 300 });
      if (!name) throw new ApiError(400, `Fichier n°${i + 1} : le champ « name » est obligatoire.`);
      const contentType = optText(f, "content_type", { max: 200 }) || guessMime(name);
      const kind = f.kind !== undefined && f.kind !== null && f.kind !== "" ? parseKind(f.kind) : inferKind(contentType, name);
      const size = optInt(f, "size", 0, Number.MAX_SAFE_INTEGER);
      if (size !== undefined && size > MAX_FILE_BYTES) {
        throw new ApiError(413, tooBigMessage(name, size), { file: name, size, max_file_mb: MAX_FILE_MB });
      }
      return { name, kind, contentType, size };
    });

    const sb = getAdminClient();
    await getContentRow(sb, id);
    const bucket = sb.storage.from(STORAGE_BUCKET);

    const uploads = await Promise.all(
      specs.map(async (s) => {
        const path = buildStoragePath(id, s.kind, s.name);
        const { data, error } = await bucket.createSignedUploadUrl(path);
        if (error || !data) {
          throw new ApiError(502, `Stockage : impossible de préparer l'envoi de « ${s.name} » (${error?.message ?? "réponse vide"}).`);
        }
        return {
          name: s.name,
          file_name: s.name,
          path: data.path,
          kind: s.kind,
          content_type: s.contentType,
          size: s.size ?? null,
          signed_url: data.signedUrl,
          token: data.token,
        };
      }),
    );

    return json({
      uploads,
      max_file_mb: MAX_FILE_MB,
      how_to:
        "Pour chaque fichier : PUT signed_url avec les en-têtes content-type et x-upsert: false (corps = octets du fichier), " +
        "puis POST /api/v1/contents/:id/assets avec { path, kind, file_name, content_type, size }.",
    });
  });
}
