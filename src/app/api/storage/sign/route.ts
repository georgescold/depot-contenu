import { isStoragePath, presignGet } from "@/lib/b2";
import { jsonError, readBody, str, withMember } from "@/lib/server-auth";

/** URLs de lecture signées (1 h) pour une liste de fichiers ; `download` force le téléchargement. */
export const POST = withMember(async (req) => {
  const body = await readBody(req);
  const paths = Array.isArray(body.paths) ? [...new Set(body.paths.filter(isStoragePath))].slice(0, 200) : [];
  if (!paths.length) return jsonError("Aucun fichier valide.");
  const download = str(body, "download") || undefined;
  if (download && paths.length > 1) return jsonError("Un seul fichier à la fois en téléchargement.");

  const urls: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      urls[p] = await presignGet(p, { download, expires: download ? 600 : 3600 });
    }),
  );
  return Response.json({ urls });
});
