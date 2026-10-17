import { abortMultipartUpload, completeMultipartUpload, isStoragePath } from "@/lib/b2";
import { jsonError, readBody, str, withMember } from "@/lib/server-auth";

/** Termine (ou annule avec `abort: true`) un envoi en plusieurs parties. */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const path = body.path;
  const uploadId = str(body, "upload_id");
  if (!isStoragePath(path) || !uploadId) return jsonError("Envoi invalide.");
  if (body.abort === true) {
    await abortMultipartUpload(path, uploadId);
    return Response.json({ ok: true, aborted: true });
  }

  const raw = Array.isArray(body.parts) ? body.parts : [];
  const parts = raw
    .map((p) => (p && typeof p === "object" ? (p as { part?: unknown; etag?: unknown }) : {}))
    .map((p) => ({ part: Number(p.part), etag: typeof p.etag === "string" ? p.etag : "" }));
  // parts numérotées 1..N, sans trou ni doublon, chacune avec son ETag
  const valid =
    parts.length > 0 &&
    parts.every((p) => Number.isInteger(p.part) && p.etag) &&
    [...parts].sort((a, b) => a.part - b.part).every((p, i) => p.part === i + 1);
  if (!valid) return jsonError("Liste des parts incomplète ou invalide.");

  try {
    await completeMultipartUpload(path, uploadId, parts);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Fin d'envoi impossible.", 502);
  }
  return Response.json({ ok: true });
});
