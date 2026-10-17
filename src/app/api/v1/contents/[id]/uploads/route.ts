import type { NextRequest } from "next/server";
import { abortMultipartUpload, createMultipartUpload, MIN_PART_SIZE, presignPart, presignPut } from "@/lib/b2";
import { MAX_FILE_MB, MULTIPART_THRESHOLD } from "@/lib/constants";
import { buildStoragePath, guessMime, inferKind } from "@/lib/storage-path";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, handle, json, readJson } from "@/lib/api/http";
import { getContentRow } from "@/lib/api/serialize";
import { MAX_FILE_BYTES, tooBigMessage } from "@/lib/api/storage";
import { listOf, optText, parseKind, requireUuid } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]/uploads">;

/** Taille d'une part en envoi multipart (16 Mo, plus si nécessaire pour rester sous 10 000 parts). */
const PART_SIZE = 16 * 1024 * 1024;
const MAX_PARTS = 10_000;
const MAX_FILES_PER_REQUEST = 100;

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * POST /api/v1/contents/:id/uploads { files: [{ name, size, kind?, content_type? }] }
 * Pour chaque fichier, prépare l'envoi direct vers Backblaze B2 :
 * - size ≤ 100 Mo : { mode: "single", signed_url } (PUT unique, valable 12 h) ;
 * - au-delà : { mode: "multipart", upload_id, part_size, part_count, part_urls } (valables 24 h),
 *   puis POST /api/v1/contents/:id/uploads/complete.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const files = listOf(await readJson(req), "files");
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new ApiError(400, `${MAX_FILES_PER_REQUEST} fichiers maximum par requête (reçu : ${files.length}) : découpe en plusieurs appels.`);
    }

    const specs = files.map((f, i) => {
      const name = optText(f, "name", { max: 300 }) ?? optText(f, "file_name", { max: 300 });
      if (!name) throw new ApiError(400, `Fichier n°${i + 1} : le champ « name » est obligatoire.`);
      const size = typeof f.size === "string" && f.size.trim() ? Number(f.size) : f.size;
      if (size === undefined || size === null) {
        throw new ApiError(400, `Fichier « ${name} » : le champ « size » (taille en octets) est obligatoire.`);
      }
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        throw new ApiError(400, `Fichier « ${name} » : « size » doit être un nombre entier d'octets.`);
      }
      if (size === 0) throw new ApiError(400, `Fichier « ${name} » vide (0 octet) : export pas terminé ?`);
      if (size > MAX_FILE_BYTES) {
        throw new ApiError(413, tooBigMessage(name, size), { file: name, size, max_file_mb: MAX_FILE_MB });
      }
      const contentType = optText(f, "content_type", { max: 200 }) || guessMime(name);
      const kind = f.kind !== undefined && f.kind !== null && f.kind !== "" ? parseKind(f.kind) : inferKind(contentType, name);
      return { name, kind, contentType, size };
    });

    const sb = getAdminClient();
    await getContentRow(sb, id);

    const started: { path: string; uploadId: string }[] = [];
    try {
      const uploads = await Promise.all(
        specs.map(async (s) => {
          const path = buildStoragePath(id, s.kind, s.name);
          const base = { name: s.name, file_name: s.name, path, kind: s.kind, content_type: s.contentType, size: s.size };
          try {
            if (s.size <= MULTIPART_THRESHOLD) {
              return { ...base, mode: "single" as const, signed_url: await presignPut(path) };
            }
            const partSize = Math.max(PART_SIZE, MIN_PART_SIZE, Math.ceil(s.size / MAX_PARTS));
            const count = Math.ceil(s.size / partSize);
            const uploadId = await createMultipartUpload(path, s.contentType);
            started.push({ path, uploadId });
            const partUrls = await Promise.all(Array.from({ length: count }, (_, i) => presignPart(path, uploadId, i + 1)));
            return { ...base, mode: "multipart" as const, upload_id: uploadId, part_size: partSize, part_count: count, part_urls: partUrls };
          } catch (e) {
            throw new ApiError(502, `Stockage : impossible de préparer l'envoi de « ${s.name} » (${reason(e)}).`);
          }
        }),
      );
      return json({
        uploads,
        max_file_mb: MAX_FILE_MB,
        multipart_threshold_bytes: MULTIPART_THRESHOLD,
        how_to:
          "mode single : PUT signed_url avec l'en-tête content-type (corps = octets du fichier). " +
          "mode multipart : PUT de chaque part (octets [i*part_size, (i+1)*part_size[) sur part_urls[i], garder l'en-tête ETag de chaque réponse, " +
          "puis POST /api/v1/contents/:id/uploads/complete { path, upload_id, parts: [{ part, etag }] }. " +
          "Enfin POST /api/v1/contents/:id/assets avec { path, kind, file_name, content_type, size }.",
      });
    } catch (e) {
      // Pas d'envoi multipart orphelin si une préparation échoue.
      await Promise.all(started.map((s) => abortMultipartUpload(s.path, s.uploadId)));
      throw e;
    }
  });
}
