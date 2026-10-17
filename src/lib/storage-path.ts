import type { AssetKind } from "./types";

/** Nom de fichier sûr pour une clé de stockage (ASCII, sans espaces). */
export function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  const b = clean(base).slice(0, 80) || "fichier";
  const e = clean(ext).slice(0, 10).toLowerCase();
  return e ? `${b}.${e}` : b;
}

/** <contentId>/<kind>/<horodatage>-<aléa>-<nom> */
export function buildStoragePath(contentId: string, kind: AssetKind, fileName: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${contentId}/${kind}/${stamp}-${rand}-${sanitizeFileName(fileName)}`;
}

export function inferKind(mime: string | undefined, fileName = ""): AssetKind {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "photo";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif"].includes(ext)) return "photo";
  return "other";
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  txt: "text/plain",
  pdf: "application/pdf",
  zip: "application/zip",
};

export function guessMime(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
