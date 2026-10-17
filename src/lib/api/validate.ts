import { ASSET_KIND_LIST, FORMAT_LIST, PLATFORMS, PLATFORM_LIST } from "@/lib/constants";
import type { AssetKind, Format, Platform } from "@/lib/types";
import { ApiError } from "./errors";
import type { Obj } from "./http";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

export function requireUuid(v: string, label: string): string {
  if (!isUuid(v)) throw new ApiError(400, `${label} invalide : « ${v} » n'est pas un identifiant (uuid).`);
  return v.trim().toLowerCase();
}

const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

/** Texte optionnel : undefined si absent, null accepté si `nullable` (sinon null → ""). */
export function optText(o: Obj, key: string, opts: { max?: number; trim?: boolean } = {}): string | undefined {
  if (!has(o, key)) return undefined;
  const v = o[key];
  if (v === null) return "";
  if (typeof v !== "string" && typeof v !== "number") {
    throw new ApiError(400, `Le champ « ${key} » doit être un texte.`);
  }
  let s = String(v);
  if (opts.trim !== false) s = s.trim();
  if (opts.max && s.length > opts.max) {
    throw new ApiError(400, `Le champ « ${key} » est trop long (${s.length} caractères, max ${opts.max}).`);
  }
  return s;
}

export function reqText(o: Obj, key: string, opts: { max?: number } = {}): string {
  const s = optText(o, key, opts);
  if (!s) throw new ApiError(400, `Le champ « ${key} » est obligatoire.`);
  return s;
}

export function optBool(o: Obj, key: string): boolean | undefined {
  if (!has(o, key) || o[key] === null) return undefined;
  const b = parseBool(o[key]);
  if (b === undefined) throw new ApiError(400, `Le champ « ${key} » doit être true ou false.`);
  return b;
}

export function parseBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "oui", "on"].includes(s)) return true;
    if (["false", "0", "no", "non", "off", ""].includes(s)) return false;
  }
  return undefined;
}

export function optInt(o: Obj, key: string, min = 0, max = 1_000_000): number | undefined {
  if (!has(o, key) || o[key] === null) return undefined;
  const n = typeof o[key] === "string" ? Number(o[key]) : o[key];
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, `Le champ « ${key} » doit être un entier entre ${min} et ${max}.`);
  }
  return n;
}

/* ---------- Dates & heures ---------- */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = s.match(DATE_RE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseDate(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!isValidDate(s)) {
    throw new ApiError(400, `« ${label} » doit être une date au format AAAA-MM-JJ (ex. 2026-10-20), reçu : ${JSON.stringify(v)}.`);
  }
  return s;
}

/** Accepte HH:MM, H:MM, HHhMM, HH:MM:SS → "HH:MM". */
export function parseTime(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^(\d{1,2})[:hH](\d{2})(?::(\d{2}))?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || (m[3] !== undefined && Number(m[3]) > 59)) {
    throw new ApiError(400, `« ${label} » doit être une heure au format HH:MM (ex. 18:00), reçu : ${JSON.stringify(v)}.`);
  }
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** undefined = absent, null = effacer, sinon date validée. */
export function optDate(o: Obj, key: string): string | null | undefined {
  if (!has(o, key)) return undefined;
  if (o[key] === null || o[key] === "") return null;
  return parseDate(o[key], key);
}

export function optTime(o: Obj, key: string): string | null | undefined {
  if (!has(o, key)) return undefined;
  if (o[key] === null || o[key] === "") return null;
  return parseTime(o[key], key);
}

/** Date du jour à Paris (YYYY-MM-DD), quel que soit le fuseau du serveur. */
export function todayParis(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Heure actuelle à Paris (HH:MM). */
export function nowParisHHMM(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/* ---------- Énumérations ---------- */

const PLATFORM_ALIASES: Record<string, Platform> = {
  yt: "youtube",
  ig: "instagram",
  insta: "instagram",
  tt: "tiktok",
  fb: "facebook",
  li: "linkedin",
  in: "linkedin",
  twitter: "x",
  th: "threads",
  pin: "pinterest",
  pi: "pinterest",
  snap: "snapchat",
  sc: "snapchat",
  autre: "other",
};

/** Reconnaît une plateforme par son code, son libellé ou un alias courant. */
export function parsePlatform(v: string): Platform | undefined {
  const s = v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if ((PLATFORM_LIST as string[]).includes(s)) return s as Platform;
  if (PLATFORM_ALIASES[s]) return PLATFORM_ALIASES[s];
  for (const p of PLATFORM_LIST) {
    if (PLATFORMS[p].label.toLowerCase() === s) return p;
  }
  return undefined;
}

export function requirePlatform(v: unknown, key = "platform"): Platform {
  const p = typeof v === "string" ? parsePlatform(v) : undefined;
  if (!p) {
    throw new ApiError(400, `Plateforme « ${String(v ?? "")} » inconnue pour « ${key} ». Valeurs possibles : ${PLATFORM_LIST.join(", ")}.`);
  }
  return p;
}

export function optFormat(o: Obj, key = "format"): Format | undefined {
  if (!has(o, key) || o[key] === null || o[key] === "") return undefined;
  const v = String(o[key]).trim().toLowerCase();
  const alias: Record<string, Format> = { reel: "short", reels: "short", carrousel: "carousel", image: "photo", "vidéo": "video", autre: "other" };
  const f = (FORMAT_LIST as string[]).includes(v) ? (v as Format) : alias[v];
  if (!f) throw new ApiError(400, `Format « ${String(o[key])} » inconnu. Valeurs possibles : ${FORMAT_LIST.join(", ")}.`);
  return f;
}

export function parseFormat(v: string): Format {
  return optFormat({ format: v })!;
}

export function parseKind(v: unknown, key = "kind"): AssetKind {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  const alias: Record<string, AssetKind> = { thumb: "thumbnail", miniature: "thumbnail", cover: "thumbnail", image: "photo", slide: "photo", "vidéo": "video", autre: "other" };
  const k = (ASSET_KIND_LIST as string[]).includes(s) ? (s as AssetKind) : alias[s];
  if (!k) throw new ApiError(400, `Type de fichier « ${String(v ?? "")} » inconnu pour « ${key} ». Valeurs possibles : ${ASSET_KIND_LIST.join(", ")}.`);
  return k;
}

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function optColor(o: Obj, key = "color"): string | undefined {
  const s = optText(o, key);
  if (s === undefined || s === "") return undefined;
  const v = /^[0-9a-f]{6}$/i.test(s) ? `#${s}` : s;
  if (!HEX_COLOR_RE.test(v)) throw new ApiError(400, `« ${key} » doit être une couleur hexadécimale (#RRGGBB), reçu : « ${s} ».`);
  return v.toLowerCase();
}

/** Liste d'objets : accepte `{ key: [...] }`, un tableau nu ou un objet seul. */
export function listOf(body: unknown, key: string): Obj[] {
  let list: unknown;
  if (Array.isArray(body)) list = body;
  else if (body && typeof body === "object" && Array.isArray((body as Obj)[key])) list = (body as Obj)[key];
  else if (body && typeof body === "object") list = [body];
  else list = [];
  const arr = list as unknown[];
  if (arr.length === 0) throw new ApiError(400, `La liste « ${key} » est vide.`);
  arr.forEach((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      throw new ApiError(400, `L'élément n°${i + 1} de « ${key} » doit être un objet.`);
    }
  });
  return arr as Obj[];
}
