import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

/**
 * Stockage des fichiers sur Backblaze B2 (API compatible S3), côté serveur uniquement.
 * Le navigateur et le CLI envoient/lisent directement chez B2 via des URLs pré-signées :
 * les fichiers ne transitent jamais par Vercel.
 */

interface B2Config {
  keyId: string;
  key: string;
  bucket: string;
  region: string;
  endpoint: string;
}

let config: B2Config | null = null;
let client: AwsClient | null = null;

function cfg(): B2Config {
  if (config) return config;
  const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION, B2_ENDPOINT } = process.env;
  if (!B2_KEY_ID || !B2_APPLICATION_KEY || !B2_BUCKET || !B2_REGION || !B2_ENDPOINT) {
    throw new Error("Variables Backblaze B2 manquantes (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_REGION, B2_ENDPOINT)");
  }
  config = { keyId: B2_KEY_ID, key: B2_APPLICATION_KEY, bucket: B2_BUCKET, region: B2_REGION, endpoint: B2_ENDPOINT.replace(/\/$/, "") };
  return config;
}

function aws(): AwsClient {
  if (client) return client;
  const c = cfg();
  // 3 tentatives max : au-delà, mieux vaut une erreur claire qu'une requête bloquée une minute
  client = new AwsClient({ accessKeyId: c.keyId, secretAccessKey: c.key, service: "s3", region: c.region, retries: 3 });
  return client;
}

/** Chemins produits par buildStoragePath : <uuid contenu>/<type>/<nom sûr> */
const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(video|thumbnail|photo|other)\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function isStoragePath(path: unknown): path is string {
  return typeof path === "string" && PATH_RE.test(path);
}

export function contentIdOfPath(path: string): string {
  return path.split("/")[0];
}

function objectUrl(key: string, query: Record<string, string> = {}): URL {
  const { endpoint, bucket } = cfg();
  const url = new URL(`${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

async function presign(url: URL, method: string, expiresSeconds: number): Promise<string> {
  url.searchParams.set("X-Amz-Expires", String(Math.min(expiresSeconds, 7 * 24 * 3600)));
  const signed = await aws().sign(url.toString(), { method, aws: { signQuery: true } });
  return signed.url;
}

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  const msg = text.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? text.slice(0, 200);
  throw new Error(`Stockage B2 : ${what} impossible (${res.status}${msg ? ` : ${msg}` : ""})`);
}

/** En-tête Content-Disposition : nom ASCII de secours + vrai nom UTF-8. */
export function attachmentDisposition(rawName: string): string {
  const fileName = rawName.toWellFormed().replace(/[\r\n]+/g, " ").slice(0, 250);
  const ascii = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "'");
  // RFC 8187 : encodeURIComponent laisse passer ' ( ) * qu'il faut aussi encoder
  const utf8 = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** URL de lecture (ou de téléchargement forcé si `download` est donné). */
export function presignGet(key: string, opts: { download?: string; expires?: number } = {}): Promise<string> {
  const query: Record<string, string> = opts.download
    ? { "response-content-disposition": attachmentDisposition(opts.download) }
    : {};
  return presign(objectUrl(key, query), "GET", opts.expires ?? 3600);
}

/** URL d'envoi en une fois (jusqu'à 5 Go). */
export function presignPut(key: string, expires = 12 * 3600): Promise<string> {
  return presign(objectUrl(key), "PUT", expires);
}

export const MIN_PART_SIZE = 5 * 1024 * 1024;

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await aws().fetch(objectUrl(key, { uploads: "" }).toString(), {
    method: "POST",
    headers: { "content-type": contentType },
  });
  if (!res.ok) await fail(res, "début d'envoi en plusieurs parties");
  const id = (await res.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!id) throw new Error("Stockage B2 : identifiant d'envoi absent");
  return id;
}

export function presignPart(key: string, uploadId: string, partNumber: number, expires = 24 * 3600): Promise<string> {
  return presign(objectUrl(key, { partNumber: String(partNumber), uploadId }), "PUT", expires);
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: { part: number; etag: string }[],
): Promise<void> {
  const xml =
    "<CompleteMultipartUpload>" +
    [...parts]
      .sort((a, b) => a.part - b.part)
      .map((p) => `<Part><PartNumber>${p.part}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
      .join("") +
    "</CompleteMultipartUpload>";
  const res = await aws().fetch(objectUrl(key, { uploadId }).toString(), {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body: xml,
  });
  if (!res.ok) await fail(res, "fin d'envoi");
  // B2 peut répondre 200 avec une erreur dans le corps
  const body = await res.text();
  if (/<Error>/.test(body)) throw new Error(`Stockage B2 : fin d'envoi refusée (${body.slice(0, 200)})`);
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await aws().fetch(objectUrl(key, { uploadId }).toString(), { method: "DELETE" }).catch(() => {});
}

export interface ObjectInfo {
  size: number | null;
  contentType: string | null;
}

/** Infos d'un objet, ou null s'il n'existe pas. */
export async function headObject(key: string): Promise<ObjectInfo | null> {
  const res = await aws().fetch(objectUrl(key).toString(), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, "lecture des infos");
  const len = res.headers.get("content-length");
  return { size: len ? Number(len) : null, contentType: res.headers.get("content-type") };
}

function xmlEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlUnescape(v: string): string {
  return v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * Supprime des objets par lots de 1000 (S3 DeleteObjects).
 * Les objets absents sont ignorés ; les versions masquées sont purgées par la règle de cycle de vie du bucket.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const unique = [...new Set(keys.filter(Boolean))];
  const { endpoint, bucket } = cfg();
  let removed = 0;
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>' +
      batch.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("") +
      "</Delete>";
    const res = await aws().fetch(`${endpoint}/${bucket}?delete`, {
      method: "POST",
      headers: { "content-type": "application/xml", "content-md5": createHash("md5").update(xml).digest("base64") },
      body: xml,
    });
    if (!res.ok) await fail(res, "suppression");
    const body = await res.text();
    const errors = [...body.matchAll(/<Error>([\s\S]*?)<\/Error>/g)]
      .map((m) => m[1].match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "Erreur")
      .filter((code) => code !== "NoSuchKey");
    if (errors.length) throw new Error(`Stockage B2 : ${errors.length} fichier(s) non supprimé(s) (${errors[0]})`);
    removed += batch.length;
  }
  return removed;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified: string;
}

/** Toutes les clés sous un préfixe. */
export async function listObjects(prefix: string): Promise<string[]> {
  return (await listObjectsDetailed(prefix)).map((o) => o.key);
}

/** Toutes les clés sous un préfixe, avec taille et date de dernière modification. */
export async function listObjectsDetailed(prefix: string): Promise<ListedObject[]> {
  const { endpoint, bucket } = cfg();
  const out: ListedObject[] = [];
  let token: string | undefined;
  do {
    const url = new URL(`${endpoint}/${bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await aws().fetch(url.toString());
    if (!res.ok) await fail(res, "liste des fichiers");
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
      if (!key) continue;
      out.push({
        key: xmlUnescape(key),
        size: Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        lastModified: m[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "",
      });
    }
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && next ? xmlUnescape(next) : undefined;
  } while (token);
  return out;
}
