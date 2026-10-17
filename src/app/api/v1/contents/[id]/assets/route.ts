import type { NextRequest } from "next/server";
import { contentIdOfPath, isStoragePath } from "@/lib/b2";
import { MAX_FILE_MB } from "@/lib/constants";
import { guessMime } from "@/lib/storage-path";
import type { Asset, AssetKind } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readJson } from "@/lib/api/http";
import { appOrigin, contentUrl, getContentRow, serializeAssets } from "@/lib/api/serialize";
import { MAX_FILE_BYTES, objectInfo, purgeObjects, tooBigMessage } from "@/lib/api/storage";
import { listOf, optInt, optText, parseKind, requireUuid } from "@/lib/api/validate";

type Ctx = RouteContext<"/api/v1/contents/[id]/assets">;

const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** Type MIME : celui du stockage, sauf s'il est générique ; puis celui envoyé ; puis déduit de l'extension. */
function pickMime(stored: string | null, sent: string | undefined, fileName: string): string {
  const s = (stored ?? "").split(";")[0].trim().toLowerCase();
  if (!GENERIC_MIME.has(s)) return s;
  return sent || guessMime(fileName);
}

/**
 * POST /api/v1/contents/:id/assets { assets: [{ path, kind?, file_name, content_type?, size? }] }
 * (accepte aussi un objet seul). Enregistre des fichiers déjà envoyés dans le stockage :
 * vérifie le chemin, l'existence réelle de l'objet (HEAD B2) et sa taille réelle.
 * Taille et type MIME enregistrés : ceux du stockage priment sur ceux envoyés.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const id = requireUuid((await ctx.params).id, "id du contenu");
    const items = listOf(await readJson(req), "assets");
    if (items.length > 100) throw new ApiError(400, `100 fichiers maximum par requête (reçu : ${items.length}) : découpe en plusieurs appels.`);

    const specs = items.map((a, i) => {
      const path = optText(a, "path", { max: 1000 }) ?? optText(a, "storage_path", { max: 1000 });
      if (!path) throw new ApiError(400, `Fichier n°${i + 1} : le champ « path » est obligatoire.`);
      if (!isStoragePath(path) || contentIdOfPath(path) !== id) {
        throw new ApiError(400, `Chemin « ${path} » refusé : utilise le path renvoyé par /uploads pour ce contenu (${id}/<type>/<nom>).`);
      }
      const kind: AssetKind = a.kind !== undefined && a.kind !== null && a.kind !== "" ? parseKind(a.kind) : (path.split("/")[1] as AssetKind);
      const fileName = optText(a, "file_name", { max: 300 }) || optText(a, "name", { max: 300 }) || path.split("/").pop()!;
      const contentType = optText(a, "content_type", { max: 200 }) || undefined;
      const size = optInt(a, "size", 0, Number.MAX_SAFE_INTEGER);
      return { path, kind, fileName, contentType, size };
    });

    const dupPaths = specs.map((s) => s.path).filter((p, i, arr) => arr.indexOf(p) !== i);
    if (dupPaths.length) throw new ApiError(400, `Chemin en double dans la requête : ${dupPaths[0]}.`);

    const sb = getAdminClient();
    await getContentRow(sb, id);

    // Le fichier doit vraiment exister dans le stockage, et ne pas dépasser la limite.
    const infos = await Promise.all(specs.map((s) => objectInfo(s.path)));
    for (let i = 0; i < specs.length; i++) {
      const info = infos[i];
      if (!info) {
        throw new ApiError(400, `Le fichier « ${specs[i].path} » n'existe pas dans le stockage : envoie-le d'abord (PUT sur l'URL signée de /uploads, puis /uploads/complete en multipart).`);
      }
      if ((info.size ?? 0) > MAX_FILE_BYTES) {
        await purgeObjects([specs[i].path]);
        throw new ApiError(413, tooBigMessage(specs[i].fileName, info.size ?? 0) + " Le fichier a été supprimé du stockage.", {
          file: specs[i].fileName,
          size: info.size,
          max_file_mb: MAX_FILE_MB,
        });
      }
    }

    const { data: existing, error } = await sb.from("assets").select("kind, position, storage_path").eq("content_id", id);
    if (error) throw dbFail(error, "lecture des fichiers");
    const rows = (existing ?? []) as Pick<Asset, "kind" | "position" | "storage_path">[];
    const already = rows.find((r) => specs.some((s) => s.path === r.storage_path));
    if (already) throw new ApiError(409, `Le fichier « ${already.storage_path} » est déjà enregistré sur ce contenu.`);

    const next = new Map<AssetKind, number>();
    for (const r of rows) next.set(r.kind, Math.max(next.get(r.kind) ?? 0, r.position + 1));

    const inserts = specs.map((s, i) => {
      const position = next.get(s.kind) ?? 0;
      next.set(s.kind, position + 1);
      return {
        content_id: id,
        kind: s.kind,
        position,
        storage_path: s.path,
        file_name: s.fileName,
        mime_type: pickMime(infos[i]!.contentType, s.contentType, s.fileName),
        size_bytes: infos[i]!.size ?? s.size ?? 0,
      };
    });

    const { data, error: ie } = await sb.from("assets").insert(inserts).select("*");
    if (ie?.code === "23505") throw new ApiError(409, "Un de ces fichiers est déjà enregistré (envoi en double ?).");
    if (ie) throw dbFail(ie, "enregistrement des fichiers");
    // Le contenu remonte en « modifié récemment »
    await sb.from("contents").update({ updated_at: new Date().toISOString() }).eq("id", id);

    return json(
      {
        assets: await serializeAssets((data ?? []) as Asset[]),
        content: { id, url: contentUrl(appOrigin(req), id) },
      },
      201,
    );
  });
}
