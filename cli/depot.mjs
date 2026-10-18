#!/usr/bin/env node
// Dépôt contenu : CLI de l'API par clé (/api/v1).
// Zéro dépendance, Node >= 20 (fetch, fs.openAsBlob). Aide : node depot.mjs help

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "2.3.0";

if (Number(process.versions.node.split(".")[0]) < 20) {
  process.stderr.write(`Erreur : Node.js ${process.versions.node} détecté, ce CLI demande Node 20 ou plus récent (https://nodejs.org).\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

const SCRIPT = (process.argv[1] ?? "depot.mjs").replace(/\\/g, "/");
const PROG = `node "${SCRIPT}"`;
const CONFIG_PATH = path.join(os.homedir(), ".depot-contenu.json");

const KINDS = ["video", "thumbnail", "photo", "other"];
const KIND_ALIASES = { miniature: "thumbnail", thumb: "thumbnail", cover: "thumbnail", couverture: "thumbnail", slide: "photo", slides: "photo", image: "photo", "vidéo": "video", autre: "other" };
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif", "jfif"]);
const JUNK_FILES = new Set(["thumbs.db", "desktop.ini"]);
const MIME = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska",
  avi: "video/x-msvideo", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif", avif: "image/avif",
  srt: "application/x-subrip", vtt: "text/vtt", txt: "text/plain", pdf: "application/pdf", zip: "application/zip",
};
const STATUS_FR = { draft: "À planifier", scheduled: "Programmé", late: "En retard", partial: "En cours", posted: "Posté" };
const FORMAT_FR = { video: "Vidéo", short: "Short/Reel", carousel: "Carrousel", photo: "Photo", story: "Story", other: "Autre" };
const KIND_FR = { video: "vidéo", thumbnail: "miniature", photo: "photo", other: "autre" };

const PUT_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const PARALLEL_PARTS = 3;
const STALL_MS = 120_000;
const PROGRESS_EVERY_MS = 5000;

/** Options acceptées par commande (en plus de --json et --help). */
const SPECS = {
  help: { args: [0, 1], flags: [] },
  version: { args: [0, 0], flags: [] },
  config: { args: [0, 0], flags: ["url", "key"] },
  me: { args: [0, 0], flags: [] },
  folders: { args: [0, 0], flags: [] },
  people: { args: [0, 3], flags: ["color", "yes"] },
  mkdir: { args: [1, 1], flags: ["color", "description", "assignee"] },
  folder: { args: [2, 2], flags: ["assignee", "name", "color", "description", "to", "yes", "force"] },
  account: { args: [1, 2], flags: ["folder", "platform", "handle", "url", "create-folders", "assignee", "yes", "force"] },
  list: { args: [0, 0], flags: ["folder", "status", "format", "q", "limit", "assignee"] },
  get: { args: [1, 1], flags: [] },
  push: { args: [1, 1], flags: ["rollback"] },
  upload: { args: [2, Infinity], flags: ["kind"] },
  edit: { args: [1, 1], flags: ["title", "format", "notes", "notes-file", "folder", "create-folders", "assignee"] },
  schedule: { args: [1, 1], flags: ["account", "date", "time", "title", "description", "description-file", "post-url"] },
  unschedule: { args: [1, 1], flags: ["account"] },
  posted: { args: [1, 1], flags: ["account", "url", "undo"] },
  calendar: { args: [0, 0], flags: ["from", "to", "folder", "account", "include-posted", "assignee"] },
  "rm-file": { args: [1, 1], flags: [] },
  "set-kind": { args: [2, 2], flags: [] },
  delete: { args: [1, 1], flags: ["yes"] },
  "keep-files": { args: [1, 1], flags: ["off"] },
  stats: { args: [0, 2], flags: ["assignee", "folder", "account", "platform", "period", "from", "to", "sort", "limit"] },
  archive: { args: [1, 1], flags: ["yes"] },
};
const GLOBAL_FLAGS = ["json", "help"];
const BOOL_FLAGS = new Set(["json", "help", "yes", "undo", "include-posted", "create-folders", "rollback", "force", "off"]);

const USAGE = {
  config: `config --url <https://app> --key <dpc_…|->`,
  people: `people  |  people add <nom> [--color #hex]  |  people rename <nom|id> <nouveau nom>  |  people color <nom|id> <#hex>  |  people rm <nom|id> --yes`,
  mkdir: `mkdir "Projet/Sous-projet/Angle" [--color #hex] [--description …] [--assignee <personne>]`,
  folder: `folder edit <chemin|id> [--assignee <personne>|none] [--name …] [--color #hex] [--description …]  |  folder move <chemin|id> --to <chemin|id|root>  |  folder rm <chemin|id> --yes [--force]`,
  account: `account add --folder <chemin> --platform <instagram|tiktok|youtube|…> --handle <@x> [--url …] [--assignee <personne>] [--create-folders]  |  account edit <accountId> [--assignee <personne>|none] [--handle …] [--url …]  |  account rm <accountId> --yes [--force]`,
  list: `list [--folder …] [--status draft|scheduled|late|partial|posted] [--format …] [--q …] [--assignee <personne>|none] [--limit 50]`,
  get: `get <contentId>`,
  push: `push <manifest.json> [--rollback]`,
  upload: `upload <contentId> <fichier|dossier|fichier:type>… [--kind video|thumbnail|photo|other]`,
  edit: `edit <contentId> [--title …] [--format …] [--notes … | --notes-file <fichier>] [--folder <chemin>] [--create-folders] [--assignee <personne>|none]`,
  schedule: `schedule <contentId> --account <réf> --date AAAA-MM-JJ|none [--time HH:MM|none] [--title …] [--description … | --description-file <fichier>] [--post-url …]`,
  unschedule: `unschedule <contentId> --account <réf>`,
  posted: `posted <contentId> --account <réf> [--url <lien du post>] [--undo]`,
  calendar: `calendar [--from AAAA-MM-JJ] [--to AAAA-MM-JJ] [--folder …] [--account …] [--assignee <personne>|none] [--include-posted]`,
  "rm-file": `rm-file <assetId>`,
  "set-kind": `set-kind <assetId> <video|thumbnail|photo|other>`,
  delete: `delete <contentId> --yes`,
  "keep-files": `keep-files <contentId> [--off]`,
  archive: `archive <contentId> --yes`,
  stats: `stats [--assignee <personne>|none] [--folder …] [--account …] [--platform tiktok|instagram|youtube] [--period 7|30|90|all | --from AAAA-MM-JJ --to AAAA-MM-JJ] [--sort recent|views|likes|engagement] [--limit 50]  |  stats post <id|lien>`,
};

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

class CliError extends Error {
  constructor(message, { status, data, code = 1 } = {}) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = code;
  }
}

let FLAGS = {};
// Sortie fermée par le lecteur (ex. « | head ») : on s'arrête sans planter.
process.stdout.on("error", (e) => {
  if (e.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw e;
});
const out = (s = "") => process.stdout.write(s + "\n");
const err = (s = "") => process.stderr.write(s + "\n");
const warn = (s) => err(`  ! ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usage = (cmd) => `Usage : ${PROG} ${USAGE[cmd] ?? cmd}`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && a.length > 2) {
      const eq = a.indexOf("=");
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let v = eq > 0 ? a.slice(eq + 1) : undefined;
      if (BOOL_FLAGS.has(k)) v = v === undefined ? true : !["false", "0", "non", "no"].includes(v.toLowerCase());
      else if (v === undefined) v = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      flags[k] = v;
    } else if (a === "-y") flags.yes = true;
    else if (a === "-h") flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function closest(word, list) {
  let best = null;
  let bestD = Infinity;
  for (const w of list) {
    const dd = distance(word, w);
    if (dd < bestD) [best, bestD] = [w, dd];
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

function checkCommandLine(cmd, pos, flags) {
  const spec = SPECS[cmd];
  const allowed = [...spec.flags, ...GLOBAL_FLAGS];
  for (const k of Object.keys(flags)) {
    if (allowed.includes(k)) continue;
    const guess = closest(k, allowed);
    throw new CliError(
      `Option inconnue pour « ${cmd} » : --${k}.${guess ? ` Voulais-tu dire --${guess} ?` : ""}` +
        `\nOptions possibles : ${allowed.map((f) => `--${f}`).join(", ")}\n${usage(cmd)}`,
      { code: 2 },
    );
  }
  const [min, max] = spec.args;
  if (pos.length < min) throw new CliError(`Argument manquant.\n${usage(cmd)}`, { code: 2 });
  if (pos.length > max) {
    throw new CliError(`Argument en trop : « ${pos[max]} » (oubli d'une option comme --date ?).\n${usage(cmd)}`, { code: 2 });
  }
}

function str(v, name) {
  if (v === undefined) return undefined;
  if (v === true) throw new CliError(`L'option --${name} attend une valeur.`, { code: 2 });
  return String(v);
}

function need(v, name, cmd) {
  const s = str(v, name);
  if (!s) throw new CliError(`Option --${name} obligatoire.${cmd ? `\n${usage(cmd)}` : ""}`, { code: 2 });
  return s;
}

function normKind(v, where = "--kind") {
  const k = String(v ?? "").trim().toLowerCase();
  const kind = KINDS.includes(k) ? k : KIND_ALIASES[k];
  if (!kind) throw new CliError(`Type de fichier « ${v} » inconnu (${where}). Valeurs : ${KINDS.join(", ")}.`, { code: 2 });
  return kind;
}

/** Chemins Git Bash « /c/… » → « C:/… » sous Windows ; « ~/ » → dossier personnel. */
function toNative(p) {
  let s = String(p);
  if (/^~(?=$|[\\/])/.test(s)) s = os.homedir() + s.slice(1);
  if (process.platform === "win32") {
    const m = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(s);
    if (m) s = `${m[1].toUpperCase()}:/${m[2] ?? ""}`;
  }
  return s;
}

const shown = (p) => p.replace(/\\/g, "/");
const quote = (s) => `"${shown(String(s))}"`;

function mimeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function fmtSize(n) {
  if (n == null) return "?";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

function fmtDay(iso) {
  if (!iso) return "non programmé";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function oneLine(s, max = 80) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Décode un fichier texte : BOM UTF-16 / UTF-8 gérés, UTF-8 strict, fins de ligne en \n. */
function decodeText(buf, label) {
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf.subarray(2));
  else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder("utf-16be").decode(buf.subarray(2));
  else {
    const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      throw new CliError(
        `${label} n'est pas en UTF-8 (probablement ANSI / Windows-1252) : les accents seraient abîmés. Ré-enregistre-le en UTF-8 (Bloc-notes : Enregistrer sous → Encodage UTF-8).`,
      );
    }
  }
  return text.replace(/\r\n?/g, "\n");
}

async function readTextFile(p, base) {
  const abs = path.resolve(base, toNative(p));
  let buf;
  try {
    buf = await fsp.readFile(abs);
  } catch (e) {
    throw new CliError(`Fichier texte introuvable ou illisible : ${shown(abs)} (${e.code ?? e.message})`);
  }
  return decodeText(buf, shown(abs));
}

function expectArray(v, what) {
  if (!Array.isArray(v)) throw new CliError(`Réponse inattendue de l'API : « ${what} » n'est pas une liste. L'app et le CLI sont-ils à jour ?`);
  return v;
}

function expectObject(v, what) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CliError(`Réponse inattendue de l'API : « ${what} » manquant. L'app et le CLI sont-ils à jour ?`);
  return v;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function readConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH);
  } catch (e) {
    if (e.code === "ENOENT") return { data: {} };
    return { error: `lecture impossible (${e.code ?? e.message})` };
  }
  let text;
  try {
    text = decodeText(raw, CONFIG_PATH);
  } catch (e) {
    return { error: e.message };
  }
  if (!text.trim()) return { data: {} };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "le contenu n'est pas un objet JSON" };
    return { data };
  } catch (e) {
    return { error: `JSON invalide (${e.message})` };
  }
}

function parseOrigin(u, label) {
  let url;
  try {
    url = new URL(String(u).trim());
  } catch {
    throw new CliError(`${label} invalide : « ${u} » (attendu : https://adresse-de-l-app).`, { code: 2 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError(`${label} invalide : « ${u} » doit commencer par http:// ou https://.`, { code: 2 });
  }
  return url.origin;
}

function isLocalOrigin(origin) {
  const h = new URL(origin).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

const NO_CONFIG_HELP =
  `Crée une clé dans l'app (page Réglages → Clés API), puis lance :\n` +
  `  ${PROG} config --url "https://adresse-de-l-app" --key -     (colle la clé, puis Entrée)\n` +
  `(ou définis les variables DEPOT_API_URL et DEPOT_API_KEY).`;

function getConfig() {
  const envUrl = process.env.DEPOT_API_URL?.trim() || "";
  const envKey = process.env.DEPOT_API_KEY?.trim() || "";
  const file = readConfigFile();
  if (file.error && !(envUrl && envKey)) {
    throw new CliError(`Fichier de config ${shown(CONFIG_PATH)} illisible : ${file.error}.\nCorrige-le (JSON { "url": "…", "key": "dpc_…" }) ou supprime-le, puis relance « config ».`);
  }
  const data = file.data ?? {};
  let fileUrl = "";
  if (data.url) {
    try {
      fileUrl = parseOrigin(data.url, `URL du fichier ${shown(CONFIG_PATH)}`);
    } catch (e) {
      if (!envUrl) throw e;
    }
  }
  const url = envUrl ? parseOrigin(envUrl, "DEPOT_API_URL") : fileUrl;
  let key = envKey;
  let keyFrom = envKey ? "DEPOT_API_KEY" : null;
  if (!key && data.key) {
    if (!envUrl || url === fileUrl) {
      key = String(data.key).trim();
      keyFrom = shown(CONFIG_PATH);
    } else {
      throw new CliError(
        `DEPOT_API_URL (${url}) diffère de l'URL enregistrée (${fileUrl || "aucune"}) : définis aussi DEPOT_API_KEY.\n` +
          `Par sécurité, la clé du fichier de config n'est envoyée qu'à l'URL du fichier.`,
      );
    }
  }
  return { url, key, urlFrom: envUrl ? "DEPOT_API_URL" : fileUrl ? shown(CONFIG_PATH) : null, keyFrom };
}

async function readKeyFromStdin() {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise((r) => rl.question("Colle la clé API (dpc_…) puis Entrée : ", r));
    rl.close();
    return answer.trim();
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return decodeText(Buffer.concat(chunks), "l'entrée standard").trim();
}

/* ------------------------------------------------------------------ */
/* Appels API                                                          */
/* ------------------------------------------------------------------ */

async function api(method, route, body, query) {
  const cfg = getConfig();
  if (!cfg.url) throw new CliError(`URL de l'app non configurée.\n${NO_CONFIG_HELP}`);
  if (!cfg.key) throw new CliError(`Clé API non configurée.\n${NO_CONFIG_HELP}`);
  const u = new URL(`${cfg.url}/api/v1${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "" && v !== false) u.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(u, {
      method,
      // Pas de suivi automatique : la clé ne doit pas partir vers une autre adresse.
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
      headers: {
        authorization: `Bearer ${cfg.key}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json; charset=utf-8" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const code = e.cause?.code ?? e.name;
    const why = e.name === "TimeoutError" ? "délai de 3 min dépassé" : `${code}${e.cause?.message ? ` : ${e.cause.message}` : ""}`;
    throw new CliError(`Impossible de joindre ${cfg.url} (${why}). L'app est-elle lancée et l'URL correcte ?`, { data: { network: true, code } });
  }
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get("location") ?? "?";
    throw new CliError(
      `${cfg.url} redirige vers ${to} (HTTP ${res.status}) : configure directement l'adresse finale (ex. https://…) avec « config --url ».`,
      { status: res.status },
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const html = /^\s*</.test(text);
    throw new CliError(
      `Réponse non JSON${html ? " (page HTML)" : ""} de ${u.origin}${u.pathname} (HTTP ${res.status}) : vérifie l'URL de l'app ` +
        `(DEPOT_API_URL ou « config --url ») ; ce n'est pas l'API Dépôt contenu, ou elle n'est pas à jour.`,
      { status: res.status },
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CliError(`Réponse inattendue de ${u.origin}${u.pathname} (HTTP ${res.status}) : ce n'est pas un objet JSON. L'URL est-elle bien celle de l'app, et l'app à jour ?`, {
      status: res.status,
    });
  }
  if (!res.ok) {
    let msg = typeof data.error === "string" ? data.error : `HTTP ${res.status} ${res.statusText}`;
    if (res.status === 401) msg += `\nPuis : ${PROG} config --url "${cfg.url}" --key -`;
    throw new CliError(msg, { status: res.status, data });
  }
  return data;
}

async function limits() {
  const me = await api("GET", "/me", undefined, { credit: "false" });
  const app = expectObject(me.app, "app");
  if (typeof app.max_file_mb !== "number") throw new CliError("Réponse inattendue de /me : « max_file_mb » manquant. L'app est-elle à jour ?");
  return { maxBytes: app.max_file_mb * 1024 * 1024, maxMb: app.max_file_mb };
}

/* ------------------------------------------------------------------ */
/* Fichiers locaux                                                     */
/* ------------------------------------------------------------------ */

/** Sépare « chemin:type » (type connu uniquement, pour ne pas casser « C:/… »). */
function splitKindSuffix(arg) {
  const m = /^(.+):([a-zA-Zéè]+)$/.exec(arg);
  if (m && (KINDS.includes(m[2].toLowerCase()) || KIND_ALIASES[m[2].toLowerCase()])) return { p: m[1], kind: normKind(m[2], arg) };
  return { p: arg, kind: undefined };
}

const isHiddenOrJunk = (name) => name.startsWith(".") || JUNK_FILES.has(name.toLowerCase());

/** Fichiers ordinaires d'un dossier (pas de fichiers cachés), tri naturel. */
async function listDir(absDir, { imagesOnly }) {
  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    throw new CliError(`Dossier introuvable ou illisible : ${shown(absDir)} (${e.code ?? e.message})`);
  }
  const kept = [];
  const ignored = [];
  for (const d of entries.sort((a, b) => naturalSort(a.name, b.name))) {
    const full = path.join(absDir, d.name);
    if (isHiddenOrJunk(d.name)) {
      ignored.push(`${d.name} (fichier caché ou système)`);
      continue;
    }
    let st;
    try {
      st = await fsp.stat(full);
    } catch {
      ignored.push(`${d.name} (illisible)`);
      continue;
    }
    if (!st.isFile()) {
      ignored.push(`${d.name} (${st.isDirectory() ? "sous-dossier" : "pas un fichier"})`);
      continue;
    }
    if (imagesOnly && !IMAGE_EXT.has(path.extname(d.name).slice(1).toLowerCase())) {
      ignored.push(`${d.name} (pas une image : ${[...IMAGE_EXT].join(", ")})`);
      continue;
    }
    kept.push(full);
  }
  return { kept, ignored };
}

/** Vérifie existence, type, taille (> 0 et ≤ limite) avant tout envoi. */
async function statFiles(list, maxBytes) {
  const files = [];
  for (const f of list) {
    let st;
    try {
      st = await fsp.stat(f.abs);
    } catch {
      throw new CliError(`Fichier introuvable : ${shown(f.abs)}`);
    }
    if (!st.isFile()) throw new CliError(`Ce n'est pas un fichier : ${shown(f.abs)}`);
    const name = path.basename(f.abs);
    if (st.size === 0) throw new CliError(`Fichier vide (0 octet) : ${shown(f.abs)}. L'export est-il terminé ?`);
    if (st.size > maxBytes) {
      throw new CliError(
        `Fichier trop gros : ${name} fait ${Math.ceil(st.size / 1048576)} Mo, la limite est de ${Math.floor(maxBytes / 1048576)} Mo par fichier. ` +
          `Compresse-le (ex. ffmpeg -crf 28) ou découpe-le.`,
        { status: 413, data: { file: shown(f.abs), size: st.size } },
      );
    }
    files.push({ ...f, name, size: st.size });
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* Envoi vers le stockage (B2, URLs signées)                           */
/* ------------------------------------------------------------------ */

class Progress {
  constructor(total) {
    this.total = total;
    this.done = 0;
    this.started = Date.now();
    this.current = "";
    this.timer = null;
    this.lastLine = 0;
  }
  start() {
    this.timer = setInterval(() => this.print(), PROGRESS_EVERY_MS);
    this.timer.unref?.();
  }
  add(n) {
    this.done += n;
  }
  print() {
    if (!this.total) return;
    this.done = Math.max(0, Math.min(this.done, this.total));
    // Rien n'a bougé (attente de la réponse du stockage) : une ligne toutes les 30 s au plus.
    const now = Date.now();
    if (this.done === this.lastDone && now - this.lastLine < 30_000) return;
    this.lastDone = this.done;
    this.lastLine = now;
    const pct = Math.min(100, Math.floor((this.done / this.total) * 100));
    const secs = (Date.now() - this.started) / 1000;
    const rate = secs > 0 ? this.done / secs : 0;
    const eta = rate > 0 ? Math.max(0, (this.total - this.done) / rate) : 0;
    const etaTxt = eta >= 60 ? `${Math.round(eta / 60)} min` : `${Math.round(eta)} s`;
    err(`  … ${pct} % (${fmtSize(this.done)} / ${fmtSize(this.total)}) · ${fmtSize(rate)}/s · reste ≈ ${etaTxt}${this.current ? ` · ${this.current}` : ""}`);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

const RETRYABLE = (status) => status === 408 || status === 429 || status >= 500;

function storageMessage(text) {
  const m = /<Message>([^<]*)<\/Message>/.exec(text ?? "");
  if (m) return m[1].trim();
  return oneLine(text, 200);
}

/** PUT d'un fichier (ou d'une tranche) vers une URL signée, avec nouvelles tentatives. Renvoie l'ETag. */
async function putSigned(url, { abs, start, end, contentType, label, progress }) {
  for (let attempt = 1; attempt <= PUT_ATTEMPTS; attempt++) {
    let sent = 0;
    let dead = false;
    // Essai raté : on retire ses octets de la progression, et on n'en compte plus aucun.
    const discard = () => {
      if (dead) return;
      dead = true;
      progress?.add(-sent);
    };
    const ctrl = new AbortController();
    let last = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - last > STALL_MS) ctrl.abort(new Error(`aucun octet envoyé depuis ${STALL_MS / 1000} s`));
    }, 5000);
    watchdog.unref?.();
    try {
      // Nouveau Blob à chaque essai : lecture paresseuse depuis le disque, jamais tout en mémoire.
      const file = await fs.openAsBlob(abs);
      const blob = start === undefined ? file : file.slice(start, end);
      const body = blob.stream().pipeThrough(
        new TransformStream({
          transform(chunk, c) {
            if (dead) return c.error(new Error("essai abandonné"));
            sent += chunk.byteLength;
            last = Date.now();
            progress?.add(chunk.byteLength);
            c.enqueue(chunk);
          },
        }),
      );
      const res = await fetch(url, {
        method: "PUT",
        body,
        duplex: "half",
        // Indispensable : avec redirect « follow », undici garde tout le corps en mémoire pour pouvoir le renvoyer.
        redirect: "error",
        signal: ctrl.signal,
        headers: { "content-type": contentType, "content-length": String(blob.size) },
      });
      if (res.ok) {
        dead = true;
        await res.arrayBuffer().catch(() => {});
        return res.headers.get("etag") ?? "";
      }
      discard();
      const text = await res.text().catch(() => "");
      const msg = storageMessage(text);
      if (RETRYABLE(res.status) && attempt < PUT_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        warn(`${label} : le stockage répond ${res.status}${msg ? ` (${msg})` : ""}, nouvel essai ${attempt + 1}/${PUT_ATTEMPTS} dans ${delay / 1000} s…`);
        await sleep(delay);
        continue;
      }
      throw new CliError(`Le stockage refuse ${label} (HTTP ${res.status}${msg ? ` : ${msg}` : ""}).`, { status: res.status });
    } catch (e) {
      if (e instanceof CliError) throw e;
      discard();
      const code = e.cause?.code ?? e.code ?? (ctrl.signal.aborted ? "STALL" : e.name);
      const detail = ctrl.signal.aborted ? ctrl.signal.reason?.message : e.cause?.message ?? e.message;
      if (attempt < PUT_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1];
        warn(`${label} : coupure réseau (${code}), nouvel essai ${attempt + 1}/${PUT_ATTEMPTS} dans ${delay / 1000} s…`);
        await sleep(delay);
        continue;
      }
      throw new CliError(`Envoi de ${label} impossible après ${PUT_ATTEMPTS} essais (${code}${detail ? ` : ${detail}` : ""}).`, {
        data: { network: true, code },
      });
    } finally {
      clearInterval(watchdog);
    }
  }
  throw new CliError(`Envoi de ${label} impossible.`);
}

/** Envoi multipart : parts en parallèle, chacune relancée ; annulation si échec définitif. */
async function putMultipart(contentId, u, f, progress) {
  const urls = expectArray(u.part_urls, "part_urls");
  const partSize = Number(u.part_size);
  if (!partSize || urls.length !== Math.ceil(f.size / partSize)) {
    throw new CliError(`Réponse multipart incohérente pour ${f.name} (part_size ${u.part_size}, ${urls.length} URL).`);
  }
  const etags = new Array(urls.length);
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (!failure && next < urls.length) {
      const i = next++;
      const start = i * partSize;
      const end = Math.min(f.size, start + partSize);
      try {
        const etag = await putSigned(urls[i], {
          abs: f.abs,
          start,
          end,
          contentType: u.content_type,
          label: `${f.name} (part ${i + 1}/${urls.length})`,
          progress,
        });
        if (!etag) throw new CliError(`Le stockage n'a pas renvoyé d'ETag pour la part ${i + 1} de ${f.name}.`);
        etags[i] = etag;
      } catch (e) {
        if (!failure) failure = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, urls.length) }, worker));
  if (failure) {
    await api("POST", `/contents/${contentId}/uploads/complete`, { path: u.path, upload_id: u.upload_id, abort: true }).catch(() => {});
    throw failure;
  }
  await api("POST", `/contents/${contentId}/uploads/complete`, {
    path: u.path,
    upload_id: u.upload_id,
    parts: etags.map((etag, i) => ({ part: i + 1, etag })),
  });
}

/** Un fichier : URL(s) signée(s) → envoi → enregistrement sur le contenu. Renvoie l'asset créé. */
async function uploadOne(contentId, f, progress) {
  const res = await api("POST", `/contents/${contentId}/uploads`, {
    files: [{ name: f.name, kind: f.kind, content_type: mimeOf(f.name), size: f.size }],
  });
  const u = expectArray(res.uploads, "uploads")[0];
  expectObject(u, "uploads[0]");
  progress.current = f.name;
  if (u.mode === "multipart") await putMultipart(contentId, u, f, progress);
  else await putSigned(u.signed_url, { abs: f.abs, contentType: u.content_type, label: f.name, progress });
  const reg = await api("POST", `/contents/${contentId}/assets`, {
    assets: [{ path: u.path, kind: u.kind, file_name: f.name, content_type: u.content_type, size: f.size }],
  });
  return expectArray(reg.assets, "assets")[0];
}

/**
 * Envoie les fichiers un par un (chacun enregistré dès qu'il est arrivé).
 * En cas d'échec : CliError avec data { content_id, uploaded, remaining, failed_file }.
 */
async function uploadFiles(contentId, files) {
  const uploaded = [];
  const progress = new Progress(files.reduce((n, f) => n + f.size, 0));
  progress.start();
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      err(`  [${i + 1}/${files.length}] ${f.name} (${fmtSize(f.size)}${f.kind ? `, ${KIND_FR[f.kind]}` : ""})…`);
      try {
        const asset = await uploadOne(contentId, f, progress);
        uploaded.push({ file: shown(f.abs), asset_id: asset?.id ?? null, kind: asset?.kind ?? f.kind ?? null, file_name: f.name });
        err(`        ok${asset?.kind ? ` (${KIND_FR[asset.kind] ?? asset.kind})` : ""}`);
      } catch (e) {
        const ce = e instanceof CliError ? e : new CliError(`Envoi de ${f.name} impossible : ${e.message}`);
        ce.data = {
          ...(ce.data ?? {}),
          content_id: contentId,
          uploaded,
          remaining: files.slice(i).map((x) => shown(x.abs)),
          remaining_args: files.slice(i).map((x) => (x.kind ? `${shown(x.abs)}:${x.kind}` : shown(x.abs))),
          failed_file: shown(f.abs),
        };
        throw ce;
      }
    }
  } finally {
    progress.stop();
  }
  return uploaded;
}

/* ------------------------------------------------------------------ */
/* Affichage                                                           */
/* ------------------------------------------------------------------ */

const SOURCE_FR = { content: "attribué au contenu", account: "via le compte", folder: "via le dossier" };

/** « Enzo », « Enzo (via le dossier) »… ; null si personne. */
function personLabel(a, { showSource = true } = {}) {
  if (!a || !a.name) return null;
  return showSource && a.source && a.source !== "content" ? `${a.name} (${SOURCE_FR[a.source] ?? a.source})` : a.name;
}

function pubLine(p, contentPerson) {
  const who = p.account?.ref ?? p.ref ?? p.account_id;
  const when = p.date ? `${p.date}${p.time ? " " + p.time : ""} (${fmtDay(p.date)})` : "non programmé";
  const flag = p.posted ? " [posté]" : p.late ? " [EN RETARD]" : "";
  // La personne n'est rappelée que si elle diffère de celle du contenu (attribution via le compte).
  const person = p.assignee && p.assignee.id !== contentPerson?.id ? `  → ${personLabel(p.assignee)}` : "";
  return `${who} : ${when}${flag}${person}`;
}

function printContent(c) {
  out(`${c.title}`);
  out(`  ${STATUS_FR[c.status] ?? c.status} · ${FORMAT_FR[c.format] ?? c.format} · ${c.folder_path}`);
  out(`  pour : ${personLabel(c.effective_assignee) ?? "personne (non attribué)"}`);
  out(`  id  : ${c.id}`);
  out(`  web : ${c.url}`);
  if (c.notes) out(`  notes : ${oneLine(c.notes, 200)}`);
  if (c.keep_files) out(`  fichiers gardés : oui (pas d'archivage automatique après publication)`);
  if (c.files_archived_at) out(`  fichiers retirés du stockage le ${String(c.files_archived_at).slice(0, 10)}`);
  const assets = expectArray(c.assets, "assets");
  out(`Fichiers (${assets.length})`);
  for (const a of assets) {
    const archived = a.archived_at ? `  · retiré du stockage le ${String(a.archived_at).slice(0, 10)} (après publication)` : "";
    out(`  - [${KIND_FR[a.kind] ?? a.kind} ${a.position}] ${a.file_name} (${fmtSize(a.size_bytes)})  id ${a.id}${archived}`);
    if (a.download_url) out(`      ${a.download_url}`);
  }
  const pubs = expectArray(c.publications, "publications");
  out(`Publications (${pubs.length})`);
  for (const p of pubs) {
    out(`  - ${pubLine(p, c.effective_assignee)}`);
    if (p.title) out(`      titre : ${oneLine(p.title, 120)}`);
    if (p.description) out(`      description : ${oneLine(p.description, 160)}`);
    if (p.post_url) out(`      lien : ${p.post_url}`);
    if (p.stats) out(`      stats : ${metricsLine(p.stats)} (relevé le ${when(p.stats.updated_at)})`);
  }
  if (Array.isArray(c.available_accounts) && c.available_accounts.length) {
    out(`Comptes utilisables : ${c.available_accounts.map((a) => (a.assignee ? `${a.ref} (${a.assignee.name})` : a.ref)).join(", ")}`);
  }
}

function printWarnings(w) {
  for (const x of Array.isArray(w) ? w : []) warn(x);
}

const printJson = (v) => out(JSON.stringify(v, null, 2));

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */

function helpText() {
  return `Dépôt contenu : CLI de l'API (version ${VERSION})

Usage : ${PROG} <commande> [options]      (--json : réponse JSON brute, erreurs comprises)

Configuration
  config --url <https://app> --key <dpc_…>    Enregistre ~/.depot-contenu.json (--key - : lit la clé sur l'entrée standard)
  config                                     Affiche la config
  me                                         Vérifie la clé, date du jour (Paris), limites
  version                                    Version du CLI

Dossiers, comptes & personnes
  folders                                    Arborescence avec les comptes et les personnes
  ${USAGE.mkdir}
  folder edit <chemin|id> [--assignee <personne>|none] [--name …] [--color #hex] [--description …]
  folder move <chemin|id> --to <chemin|id|root>   Déplace un dossier (avec tout ce qu'il contient)
  folder rm <chemin|id> --yes [--force]          Supprime un dossier VIDE (ses comptes partent avec lui)
  account add --folder <chemin> --platform <…> --handle <@x> [--url …] [--assignee <personne>] [--create-folders]
  account edit <accountId> [--assignee <personne>|none] [--handle …] [--url …]
  account rm <accountId> --yes [--force]          Supprime un compte et ses publications
  people                                     Personnes (Enzo, Loys…)
  people add <nom> [--color #hex]            Ajoute une personne
  people rename <nom|id> <nouveau nom>  ·  people color <nom|id> <#hex>  ·  people rm <nom|id> --yes

Contenus
  ${USAGE.list}
  ${USAGE.get}
  ${USAGE.push}
  ${USAGE.upload}
  ${USAGE.edit}
  ${USAGE["rm-file"]}
  ${USAGE["set-kind"]}
  ${USAGE.delete}
  ${USAGE["keep-files"]}                    Garde les fichiers après publication (--off : archivage normal)
  ${USAGE.archive}                          Retire tout de suite les fichiers lourds d'un contenu posté partout

Statistiques (relevées chaque nuit, lecture seule)
  stats [--assignee …] [--folder …] [--account …] [--platform …] [--period 7|30|90|all | --from … --to …]
        [--sort recent|views|likes|engagement] [--limit 50]   Totaux, comptes (abonnés, 7 j) et posts
  stats post <id|lien>                       Détail d'un post et évolution jour par jour

Calendrier
  ${USAGE.schedule}
  ${USAGE.unschedule}
  ${USAGE.posted}
  ${USAGE.calendar}

Compte (--account) : "instagram" (plateforme), "@handle", "instagram:@handle" ou l'id.
Personne (--assignee) : nom (casse et accents ignorés) ou id ; "none" retire l'attribution. Une publication revient
  à la personne du contenu, sinon à celle du compte, sinon à celle du dossier le plus proche.
upload : un dossier ajoute tous ses fichiers (tri naturel) ; "fichier:thumbnail" fixe le type d'un fichier ;
         --kind s'applique aux fichiers sans type explicite (sinon : vidéo → video, image → photo).

Manifest de push (chemins relatifs au manifest) :
  { "folder": "Projet/Sous-projet/Angle", "create_folders": false,
    "title": "…", "format": "carousel", "notes": "…", "assignee": "Enzo",
    "files": [ { "path": "./cover.png", "kind": "thumbnail" } ],
    "dir": "./slides",
    "publications": [ { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
                      { "account": "tiktok", "date": "2026-10-21", "description_file": "./caption.txt" } ] }
  Ordre : validation complète → contenu créé → fichiers envoyés → publications créées.
  En cas d'échec, NE PAS relancer push : suivre la commande de reprise affichée (upload puis schedule).

Suppressions et archivage : --yes obligatoire (sans lui, le CLI dit ce qui serait supprimé). --force : accepte de perdre
  des publications non postées. L'équipe, les clés API et les réglages se gèrent uniquement dans l'app.

Config : DEPOT_API_URL / DEPOT_API_KEY, sinon ${shown(CONFIG_PATH)} { "url", "key" }.`;
}

async function cmdConfig(flags) {
  if (flags.url !== undefined || flags.key !== undefined) {
    const file = readConfigFile();
    if (file.error) {
      throw new CliError(
        `${shown(CONFIG_PATH)} est illisible (${file.error}) : je ne le réécris pas pour ne pas perdre ta clé.\n` +
          `Corrige-le ou supprime-le, puis relance la commande.`,
      );
    }
    const cur = { ...file.data };
    if (flags.url !== undefined) {
      const origin = parseOrigin(need(flags.url, "url", "config"), "--url");
      if (origin.startsWith("http:") && !isLocalOrigin(origin)) {
        warn(`${origin} est en http (non chiffré) : la clé API circulera en clair. Préfère https.`);
      }
      if (cur.url && cur.url !== origin && cur.key && flags.key === undefined) {
        warn(`URL changée (${cur.url} → ${origin}) : la clé enregistrée est conservée pour la nouvelle URL.`);
      }
      cur.url = origin;
    }
    if (flags.key !== undefined) {
      let k = need(flags.key, "key", "config");
      if (k === "-") k = await readKeyFromStdin();
      if (!k.startsWith("dpc_")) throw new CliError("La clé doit commencer par « dpc_ ».", { code: 2 });
      cur.key = k;
    }
    const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(cur, null, 2) + "\n", { mode: 0o600 });
    await fsp.rename(tmp, CONFIG_PATH);
    if (!flags.json) out(`Config enregistrée dans ${shown(CONFIG_PATH)}`);
  }
  const cfg = getConfig();
  const masked = cfg.key ? cfg.key.slice(0, 10) + "…" : null;
  if (flags.json) return printJson({ url: cfg.url || null, url_from: cfg.urlFrom, key: masked, key_from: cfg.keyFrom, config_file: shown(CONFIG_PATH) });
  out(`URL : ${cfg.url || "(non définie)"}${cfg.urlFrom ? `  [${cfg.urlFrom}]` : ""}`);
  out(`Clé : ${masked ?? "(non définie)"}${cfg.keyFrom ? `  [${cfg.keyFrom}]` : ""}`);
  if (!cfg.url || !cfg.key) out(`\n${NO_CONFIG_HELP}`);
}

async function cmdMe(flags) {
  const me = await api("GET", "/me");
  if (flags.json) return printJson({ ...me, cli_version: VERSION });
  const key = expectObject(me.key, "key");
  const app = expectObject(me.app, "app");
  out(`Clé « ${key.name} » (${key.prefix}…) OK`);
  out(`App : ${app.url} · aujourd'hui ${app.today} (${fmtDay(app.today)}, heure de Paris)`);
  out(`Limite : ${app.max_file_mb} Mo par fichier · envoi en plusieurs parties au-delà de ${fmtSize(app.multipart_threshold_bytes)} · CLI ${VERSION}`);
  if (app.archive_after_label !== undefined) {
    out(`Archivage des fichiers après publication : ${app.archive_after_label} (réglable seulement dans l'app, Réglages)`);
  }
  if (app.apify_keys !== undefined) {
    out(
      app.apify_credit_remaining_usd === null
        ? `Crédit Apify (statistiques) : indisponible${app.apify_credit_error ? ` (${app.apify_credit_error})` : ""}`
        : `Crédit Apify (statistiques) : ${app.apify_credit_remaining_usd.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ restants ce mois-ci (${app.apify_keys_ok}/${app.apify_keys} clé(s) valide(s))`,
    );
  }
}

async function cmdFolders(flags) {
  const res = await api("GET", "/folders");
  const folders = expectArray(res.folders, "folders");
  if (flags.json) return printJson(res);
  if (!folders.length) return out(`Aucun dossier. Crée-en un : ${PROG} mkdir "Projet/Sous-projet"`);
  for (const f of folders) {
    const pad = "  ".repeat(f.depth);
    const plural = (n) => `${n} contenu${n > 1 ? "s" : ""}`;
    const count = f.total_contents !== f.contents_count ? `${plural(f.contents_count)}, ${f.total_contents} avec les sous-dossiers` : plural(f.contents_count);
    const who = f.assignee ? `  · pour ${f.assignee.name}` : "";
    out(`${pad}${f.depth === 0 ? "■" : "└"} ${f.name}  (${count})${who}`);
    const accounts = expectArray(f.accounts, "accounts");
    if (accounts.length) out(`${pad}    comptes : ${accounts.map((a) => (a.assignee ? `${a.ref} (${a.assignee.name})` : a.ref)).join(", ")}`);
  }
  out(`\nLes contenus d'un dossier peuvent utiliser les comptes du dossier et de tous ses parents.`);
  out(`Personne : celle du contenu, sinon du compte, sinon du dossier le plus proche (sous-dossiers compris).`);
}

async function cmdMkdir(pos, flags) {
  const res = await api("POST", "/folders", {
    path: pos[0],
    color: str(flags.color, "color"),
    description: str(flags.description, "description"),
    assignee: str(flags.assignee, "assignee"),
  });
  if (flags.json) return printJson(res);
  const created = expectArray(res.created, "created");
  if (created.length) out(`Créé : ${created.join(", ")}`);
  else out(`Existe déjà : ${res.folder.path}`);
  if (res.folder.assignee) out(`pour : ${res.folder.assignee.name}`);
  out(`id : ${res.folder.id}`);
}

/** Options autorisées par sous-commande (le contrôle global par commande ne suffit pas pour folder / account / people). */
function onlyFlags(cmd, sub, flags, allowed) {
  for (const k of Object.keys(flags)) {
    if (k === "json" || k === "help" || allowed.includes(k)) continue;
    throw new CliError(`--${k} ne s'utilise pas avec « ${cmd} ${sub} ».\n${usage(cmd)}`, { code: 2 });
  }
}

/**
 * Les 409 de l'API parlent de « force=true » : côté CLI, c'est --force.
 * `preview` : refus rencontré pendant l'aperçu (sans --yes) → code 2, comme toute suppression non confirmée.
 */
function cliForce(e, preview = false) {
  if (e instanceof CliError && typeof e.message === "string") {
    e.message = e.message.replace(/Ajoute force=true pour confirmer\./g, "Ajoute --force (avec --yes) pour confirmer.");
    if (preview && e.status === 409) e.code = 2;
  }
  return e;
}

const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v));
  const t = p.toString();
  return t ? `?${t}` : "";
};

async function cmdFolder(pos, flags) {
  const [sub, ref] = pos;
  const route = `/folders/${encodeURIComponent(ref)}`; // un seul segment d'URL : l'API accepte un id ou un chemin encodé

  if (sub === "edit") {
    onlyFlags("folder", "edit", flags, ["assignee", "name", "color", "description"]);
    const body = {};
    if (flags.assignee !== undefined) body.assignee = need(flags.assignee, "assignee", "folder");
    if (flags.name !== undefined) body.name = need(flags.name, "name", "folder");
    if (flags.color !== undefined) body.color = need(flags.color, "color", "folder");
    if (flags.description !== undefined) body.description = str(flags.description, "description");
    if (!Object.keys(body).length) throw new CliError(`Rien à modifier : donne --assignee, --name, --color ou --description.\n${usage("folder")}`, { code: 2 });
    const res = await api("PATCH", route, body);
    if (flags.json) return printJson(res);
    const f = expectObject(res.folder, "folder");
    const inherited = f.effective_assignee ? `${f.effective_assignee.name} (hérité d'un dossier parent)` : "personne";
    out(`Dossier modifié : ${f.path}`);
    return out(`  pour : ${f.assignee ? f.assignee.name : inherited}`);
  }

  if (sub === "move") {
    onlyFlags("folder", "move", flags, ["to"]);
    const to = need(flags.to, "to", "folder");
    const parent = ["root", "racine", "/"].includes(to.trim().toLowerCase()) ? null : to;
    const res = await api("PATCH", route, { parent });
    if (flags.json) return printJson(res);
    const f = expectObject(res.folder, "folder");
    out(res.moved ? `Dossier déplacé : « ${ref} » → ${f.path}` : `Rien à faire : « ${f.path} » est déjà à cet endroit.`);
    return printWarnings(res.warnings);
  }

  if (sub === "rm") {
    onlyFlags("folder", "rm", flags, ["yes", "force"]);
    if (!flags.yes) {
      const prev = await api("DELETE", `${route}${qs({ dry_run: "true", force: flags.force ? "true" : "" })}`).catch((e) => {
        throw cliForce(e, true);
      });
      const accounts = expectArray(prev.removed_accounts, "removed_accounts");
      const lost = accounts.length
        ? `ses ${accounts.length} compte(s) (${accounts.map((a) => a.ref).join(", ")}) et ${prev.removed_publications} publication(s)` +
          `${prev.unposted_publications ? ` dont ${prev.unposted_publications} non postée(s)` : ""} seraient supprimés aussi`
        : "il ne porte aucun compte";
      throw new CliError(`Suppression définitive du dossier vide « ${prev.path} » : ${lost}. Relance avec --yes pour confirmer.`, { code: 2, data: prev });
    }
    const res = await api("DELETE", `${route}${qs({ force: flags.force ? "true" : "" })}`).catch((e) => {
      throw cliForce(e);
    });
    if (flags.json) return printJson(res);
    const accounts = expectArray(res.removed_accounts, "removed_accounts");
    return out(
      `Dossier supprimé : ${res.path}` +
        (accounts.length ? ` (comptes supprimés : ${accounts.map((a) => a.ref).join(", ")} ; ${res.removed_publications} publication(s) supprimée(s))` : ""),
    );
  }

  throw new CliError(`Sous-commande inconnue : « ${sub} ».\n${usage("folder")}`, { code: 2 });
}

async function cmdPeople(pos, flags) {
  const [sub, ref, value] = pos;
  if (!sub) {
    onlyFlags("people", "", flags, []);
    const res = await api("GET", "/people");
    const people = expectArray(res.people, "people");
    if (flags.json) return printJson(res);
    if (!people.length) return out(`Aucune personne. Ajoute-en une : ${PROG} people add "Prénom"`);
    for (const p of people) out(`- ${p.name}  (${p.color})  id ${p.id}`);
    return;
  }
  const bad = () => new CliError(usage("people"), { code: 2 });
  if (sub === "add") {
    onlyFlags("people", "add", flags, ["color"]);
    if (!ref || value) throw bad();
    const res = await api("POST", "/people", { name: ref, color: str(flags.color, "color") });
    if (flags.json) return printJson(res);
    return out(`Personne ajoutée : ${res.person.name}  (id ${res.person.id})`);
  }
  const route = `/people/${encodeURIComponent(ref ?? "")}`;
  if (sub === "rename" || sub === "color") {
    onlyFlags("people", sub, flags, []);
    if (!ref || !value) throw bad();
    const res = await api("PATCH", route, sub === "rename" ? { name: value } : { color: value });
    if (flags.json) return printJson(res);
    const p = expectObject(res.person, "person");
    return out(sub === "rename" ? `Personne renommée : ${res.previous_name} → ${p.name}` : `Couleur de ${p.name} : ${p.color}`);
  }
  if (sub === "rm") {
    onlyFlags("people", "rm", flags, ["yes"]);
    if (!ref || value) throw bad();
    if (!flags.yes) {
      const prev = await api("DELETE", `${route}?dry_run=true`);
      const u = expectObject(prev.unassigned, "unassigned");
      throw new CliError(
        `Suppression de la personne « ${prev.person.name} » : ${u.contents} contenu(s), ${u.accounts} compte(s) et ${u.folders} dossier(s) ` +
          `repasseront en « non attribué » (rien d'autre n'est supprimé). Relance avec --yes pour confirmer.`,
        { code: 2, data: prev },
      );
    }
    const res = await api("DELETE", route);
    if (flags.json) return printJson(res);
    const u = expectObject(res.unassigned, "unassigned");
    return out(`Personne supprimée : ${res.person.name} (attributions retirées : ${u.contents} contenu(s), ${u.accounts} compte(s), ${u.folders} dossier(s))`);
  }
  throw bad();
}

async function cmdAccount(pos, flags) {
  const [sub, id] = pos;
  if (sub === "edit") {
    onlyFlags("account", "edit", flags, ["assignee", "handle", "url"]);
    if (!id) throw new CliError(`Argument manquant : id du compte.\n${usage("account")}`, { code: 2 });
    const body = {};
    if (flags.assignee !== undefined) body.assignee = need(flags.assignee, "assignee", "account");
    if (flags.handle !== undefined) body.handle = need(flags.handle, "handle", "account");
    if (flags.url !== undefined) body.url = str(flags.url, "url");
    if (!Object.keys(body).length) throw new CliError(`Rien à modifier : donne --assignee, --handle ou --url.\n${usage("account")}`, { code: 2 });
    const res = await api("PATCH", `/accounts/${encodeURIComponent(id)}`, body);
    if (flags.json) return printJson(res);
    const a = expectObject(res.account, "account");
    return out(`Compte modifié : ${a.ref} dans ${a.folder_path} · pour : ${a.assignee ? a.assignee.name : "personne"}`);
  }
  if (sub === "rm") {
    onlyFlags("account", "rm", flags, ["yes", "force"]);
    if (!id) throw new CliError(`Argument manquant : id du compte.\n${usage("account")}`, { code: 2 });
    const route = `/accounts/${encodeURIComponent(id)}`;
    if (!flags.yes) {
      const prev = await api("DELETE", `${route}${qs({ dry_run: "true", force: flags.force ? "true" : "" })}`).catch((e) => {
        throw cliForce(e, true);
      });
      const a = expectObject(prev.account, "account");
      throw new CliError(
        `Suppression définitive du compte ${a.ref} (${a.folder_path}) et de ses ${prev.removed_publications} publication(s)` +
          `${prev.unposted_publications ? ` dont ${prev.unposted_publications} non postée(s)` : ""}. Relance avec --yes pour confirmer.`,
        { code: 2, data: prev },
      );
    }
    const res = await api("DELETE", `${route}${qs({ force: flags.force ? "true" : "" })}`).catch((e) => {
      throw cliForce(e);
    });
    if (flags.json) return printJson(res);
    return out(`Compte supprimé : ${res.account.ref} (${res.removed_publications} publication(s) supprimée(s))`);
  }
  if (sub !== "add") throw new CliError(`Sous-commande inconnue : « ${sub} ».\n${usage("account")}`, { code: 2 });
  onlyFlags("account", "add", flags, ["folder", "platform", "handle", "url", "assignee", "create-folders"]);
  if (id) throw new CliError(`Argument en trop : « ${id} ».\n${usage("account")}`, { code: 2 });
  const res = await api("POST", "/accounts", {
    folder: need(flags.folder, "folder", "account"),
    platform: need(flags.platform, "platform", "account"),
    handle: need(flags.handle, "handle", "account"),
    url: str(flags.url, "url"),
    assignee: str(flags.assignee, "assignee"),
    create_folders: flags["create-folders"] ? true : undefined,
  });
  if (flags.json) return printJson(res);
  const who = res.account.assignee ? ` · pour ${res.account.assignee.name}` : "";
  out(`Compte ajouté : ${res.account.ref} dans ${res.account.folder_path}${who}  (id ${res.account.id})`);
}

async function cmdList(flags) {
  const res = await api("GET", "/contents", undefined, {
    folder: str(flags.folder, "folder"),
    status: str(flags.status, "status"),
    format: str(flags.format, "format"),
    q: str(flags.q, "q"),
    assignee: str(flags.assignee, "assignee"),
    limit: str(flags.limit, "limit"),
  });
  const contents = expectArray(res.contents, "contents");
  if (flags.json) return printJson(res);
  if (!contents.length) return out("Aucun contenu.");
  for (const c of contents) {
    const files = c.files?.total ? `${c.files.total} fichier${c.files.total > 1 ? "s" : ""}` : "aucun fichier";
    const who = personLabel(c.effective_assignee);
    out(`[${STATUS_FR[c.status] ?? c.status}] ${c.title}  ·  ${FORMAT_FR[c.format] ?? c.format}  ·  ${c.folder_path}  ·  ${files}${who ? `  ·  pour ${who}` : ""}`);
    for (const p of expectArray(c.publications, "publications")) out(`    ${pubLine(p, c.effective_assignee)}`);
    out(`    id ${c.id}  ${c.url}`);
  }
  out(`\n${contents.length} affiché(s) sur ${res.total}.`);
}

async function cmdGet(pos, flags) {
  const c = await api("GET", `/contents/${encodeURIComponent(pos[0])}`);
  if (flags.json) return printJson(c);
  printContent(c);
}

const MANIFEST_KEYS = new Set(["folder", "create_folders", "title", "format", "notes", "notes_file", "assignee", "files", "dir", "publications"]);
const PUB_KEYS = new Set(["account", "date", "time", "title", "title_file", "description", "description_file", "posted", "post_url"]);

/** Lit et valide le manifest, rassemble les fichiers ; aucune écriture côté app. */
async function loadManifest(manifestArg) {
  const abs = path.resolve(toNative(manifestArg));
  const text = await readTextFile(abs, process.cwd());
  let m;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new CliError(`Manifest ${shown(abs)} : JSON invalide (${e.message}).`);
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new CliError(`Manifest ${shown(abs)} : il faut un objet JSON { "folder", "title", … }.`);
  const base = path.dirname(abs);
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.has(k)) warn(`clé inconnue dans le manifest ignorée : « ${k} »${closest(k, [...MANIFEST_KEYS]) ? ` (voulais-tu dire « ${closest(k, [...MANIFEST_KEYS])} » ?)` : ""}`);
  if (typeof m.folder !== "string" || !m.folder.trim()) throw new CliError("Le manifest doit contenir « folder » (texte : chemin « Projet/Sous-projet/Angle » ou id).");
  if (typeof m.title !== "string" || !m.title.trim()) throw new CliError("Le manifest doit contenir « title » (texte).");
  if (m.files !== undefined && !Array.isArray(m.files)) throw new CliError("« files » doit être une liste de chemins ou de { path, kind }.");
  if (m.publications !== undefined && !Array.isArray(m.publications)) throw new CliError("« publications » doit être une liste d'objets { account, date, … }.");
  if (m.dir !== undefined && typeof m.dir !== "string" && !(Array.isArray(m.dir) && m.dir.every((d) => typeof d === "string"))) {
    throw new CliError("« dir » doit être un chemin de dossier (ou une liste de chemins).");
  }
  if (m.create_folders !== undefined && typeof m.create_folders !== "boolean") throw new CliError("« create_folders » doit valoir true ou false.");
  if (m.assignee !== undefined && m.assignee !== null && (typeof m.assignee !== "string" || !m.assignee.trim())) {
    throw new CliError("« assignee » doit être le nom (ou l'id) d'une personne existante, ou \"none\".");
  }

  const list = [];
  const seen = new Set();
  const add = (abs2, kind) => {
    const key = path.resolve(abs2).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ abs: path.resolve(abs2), kind });
  };
  for (const [i, f] of (m.files ?? []).entries()) {
    const p = typeof f === "string" ? f : f && typeof f === "object" ? f.path : undefined;
    if (typeof p !== "string" || !p) throw new CliError(`files[${i}] : il faut un chemin ou { "path": "…", "kind": "…" }.`);
    const kind = typeof f === "object" && f.kind !== undefined ? normKind(f.kind, `files[${i}].kind`) : undefined;
    add(path.resolve(base, toNative(p)), kind);
  }
  for (const d of [].concat(m.dir ?? [])) {
    const absDir = path.resolve(base, toNative(d));
    const { kept, ignored } = await listDir(absDir, { imagesOnly: true });
    for (const x of ignored) warn(`dir ${shown(d)} : ignoré ${x}`);
    if (!kept.length) throw new CliError(`Aucune image trouvée dans « dir » : ${shown(absDir)} (formats : ${[...IMAGE_EXT].join(", ")}).`);
    for (const k of kept) add(k, "photo");
  }

  const publications = [];
  for (const [i, p] of (m.publications ?? []).entries()) {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new CliError(`publications[${i}] doit être un objet { account, date, … }.`);
    for (const k of Object.keys(p)) if (!PUB_KEYS.has(k)) warn(`publications[${i}] : clé inconnue ignorée « ${k} »`);
    if (typeof p.account !== "string" || !p.account.trim()) throw new CliError(`publications[${i}] : « account » obligatoire (ex. "instagram").`);
    const { description_file, title_file, ...rest } = p;
    for (const k of Object.keys(rest)) if (!PUB_KEYS.has(k)) delete rest[k];
    const pub = { ...rest };
    if (description_file) pub.description = (await readTextFile(description_file, base)).replace(/\s+$/, "");
    if (title_file) pub.title = (await readTextFile(title_file, base)).trim();
    publications.push({ pub, descriptionFile: description_file ? path.resolve(base, toNative(description_file)) : null });
  }
  let notes = m.notes;
  if (m.notes_file) notes = (await readTextFile(m.notes_file, base)).trim();
  return { abs, manifest: m, files: list, publications, notes };
}

/** Commande « schedule » équivalente à une publication du manifest (pour la reprise). */
function scheduleCommand(id, p) {
  const parts = [`${PROG} schedule ${id} --account ${quote(p.pub.account)}`];
  parts.push(`--date ${p.pub.date ?? "none"}`);
  if (p.pub.time) parts.push(`--time ${p.pub.time}`);
  if (p.pub.title) parts.push(/^[^"$`\n\\]*$/.test(p.pub.title) ? `--title "${p.pub.title}"` : `--title "…"`);
  if (p.descriptionFile) parts.push(`--description-file ${quote(p.descriptionFile)}`);
  else if (p.pub.description) {
    parts.push(/^[^"$`\n\\]{0,300}$/.test(p.pub.description) ? `--description "${p.pub.description}"` : `--description-file <fichier contenant la description>`);
  }
  if (p.pub.post_url) parts.push(`--post-url "${p.pub.post_url}"`);
  return parts.join(" ");
}

async function cmdPush(pos, flags) {
  const { abs, manifest: m, files: list, publications, notes } = await loadManifest(pos[0]);
  const { maxBytes } = await limits();
  const files = await statFiles(list, maxBytes);
  const payload = { folder: m.folder, create_folders: m.create_folders === true, title: m.title, format: m.format, notes, assignee: m.assignee };

  // 1. Tout valider côté app sans rien écrire (dossier, comptes, dates).
  const check = await api("POST", "/contents", { ...payload, publications: publications.map((p) => p.pub), dry_run: true });
  // Avertissements uniques : ceux de la validation sont affichés une fois, les nouveaux au fil de l'eau.
  const warnings = new Set(Array.isArray(check.warnings) ? check.warnings : []);
  if (!flags.json) {
    err(`Manifest ${shown(abs)} validé : « ${m.title} » → ${check.folder_path}${check.assignee ? ` · pour ${check.assignee.name}` : ""}`);
    if (check.missing_folders?.length) err(`  dossiers à créer : ${check.missing_folders.join(" / ")}`);
    err(`  ${files.length} fichier(s), ${fmtSize(files.reduce((n, f) => n + f.size, 0))} · ${publications.length} publication(s)`);
    printWarnings(check.warnings);
  }

  // 2. Contenu sans publications (il n'apparaît pas dans le calendrier tant que les fichiers ne sont pas là).
  const created = await api("POST", "/contents", payload);
  expectObject(created, "contenu");
  const id = created.id;
  err(`Contenu créé : « ${created.title} » dans ${created.folder_path} (id ${id})`);

  let stage = "files";
  let uploaded = [];
  const pubsDone = [];
  try {
    // 3. Fichiers, un par un.
    if (files.length) err(`Envoi de ${files.length} fichier(s)…`);
    uploaded = await uploadFiles(id, files);
    // 4. Publications.
    stage = "publications";
    for (const p of publications) {
      const res = await api("PUT", `/contents/${id}/publications`, p.pub);
      pubsDone.push(p);
      if (!flags.json) err(`  publication ${pubLine(expectObject(res.publication, "publication"))}`);
      for (const w of Array.isArray(res.warnings) ? res.warnings : []) {
        if (warnings.has(w)) continue;
        warnings.add(w);
        if (!flags.json) warn(w);
      }
    }
  } catch (e) {
    const ce = e instanceof CliError ? e : new CliError(e.message);
    const d = ce.data ?? {};
    const remainingPubs = publications.filter((p) => !pubsDone.includes(p));
    const info = {
      content_id: id,
      content_url: created.url,
      stage,
      uploaded: d.uploaded ?? uploaded,
      remaining: stage === "files" ? d.remaining ?? [] : [],
      failed_file: stage === "files" ? d.failed_file ?? null : null,
      remaining_publications: remainingPubs.map((p) => p.pub),
    };
    if (flags.rollback) {
      try {
        await api("DELETE", `/contents/${id}`);
        ce.message += `\n--rollback : le contenu ${id} et ses fichiers ont été supprimés. Tu peux relancer push.`;
        ce.data = { ...d, ...info, rolled_back: true };
      } catch (re) {
        ce.message += `\n--rollback : suppression du contenu ${id} impossible (${re.message}). Supprime-le avec : ${PROG} delete ${id} --yes`;
        ce.data = { ...d, ...info, rolled_back: false };
      }
      throw ce;
    }
    const lines = [`Le contenu existe déjà : « ${created.title} » (id ${id}) ${created.url}`];
    lines.push(`NE RELANCE PAS push (doublon). Reprends ainsi :`);
    const resume = [];
    if (stage === "files") {
      lines.push(`Fichiers envoyés et enregistrés : ${info.uploaded.length}/${files.length}. Restants :`);
      for (const r of info.remaining) lines.push(`  - ${r}`);
      resume.push(`${PROG} upload ${id} ${(d.remaining_args ?? info.remaining).map(quote).join(" ")}`);
    }
    for (const p of remainingPubs) resume.push(scheduleCommand(id, p));
    lines.push(...resume.map((c) => `  ${c}`));
    if (!flags.rollback) lines.push(`(ou ajoute --rollback à push pour tout annuler automatiquement en cas d'échec)`);
    ce.message += `\n${lines.join("\n")}`;
    ce.data = { ...d, ...info, resume_commands: resume };
    delete ce.data.remaining_args;
    throw ce;
  }

  const final = await api("GET", `/contents/${id}`);
  if (flags.json) return printJson({ ...final, uploaded, warnings: [...warnings] });
  out(`Terminé : ${final.assets.length} fichier(s), ${final.publications.length} publication(s), statut ${STATUS_FR[final.status] ?? final.status}.`);
  out(`id  : ${final.id}`);
  out(`Lien : ${final.url}`);
}

async function collectUploadArgs(args, defaultKind) {
  const list = [];
  const seen = new Set();
  const add = (abs, kind) => {
    const key = path.resolve(abs).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ abs: path.resolve(abs), kind });
  };
  const entries = args.map(splitKindSuffix).map((x) => ({ ...x, abs: path.resolve(toNative(x.p)) }));
  entries.sort((a, b) => naturalSort(a.abs, b.abs));
  for (const e of entries) {
    let st;
    try {
      st = await fsp.stat(e.abs);
    } catch {
      throw new CliError(`Fichier ou dossier introuvable : ${shown(e.abs)}`);
    }
    if (st.isDirectory()) {
      const { kept, ignored } = await listDir(e.abs, { imagesOnly: false });
      for (const x of ignored) warn(`${shown(e.p)} : ignoré ${x}`);
      if (!kept.length) throw new CliError(`Aucun fichier à envoyer dans ${shown(e.abs)}.`);
      for (const k of kept) add(k, e.kind ?? defaultKind);
    } else add(e.abs, e.kind ?? defaultKind);
  }
  return list;
}

async function cmdUpload(pos, flags) {
  const [id, ...args] = pos;
  const defaultKind = flags.kind !== undefined ? normKind(need(flags.kind, "kind", "upload")) : undefined;
  const list = await collectUploadArgs(args, defaultKind);
  const { maxBytes } = await limits();
  const files = await statFiles(list, maxBytes);
  const content = await api("GET", `/contents/${encodeURIComponent(id)}`);
  err(`Envoi de ${files.length} fichier(s) (${fmtSize(files.reduce((n, f) => n + f.size, 0))}) vers « ${content.title} »…`);
  let uploaded;
  try {
    uploaded = await uploadFiles(content.id, files);
  } catch (e) {
    const d = e.data ?? {};
    if (d.remaining?.length) {
      e.message +=
        `\nEnvoyés et enregistrés : ${d.uploaded?.length ?? 0}/${files.length}. Pour reprendre avec les fichiers restants :\n` +
        `  ${PROG} upload ${content.id} ${(d.remaining_args ?? d.remaining).map(quote).join(" ")}`;
      e.data = { ...d, content_url: content.url, resume_commands: [`${PROG} upload ${content.id} ${(d.remaining_args ?? d.remaining).map(quote).join(" ")}`] };
      delete e.data.remaining_args;
    }
    throw e;
  }
  const c = await api("GET", `/contents/${content.id}`);
  if (flags.json) return printJson({ uploaded, content: c });
  out(`${uploaded.length} fichier(s) ajouté(s) à « ${c.title} » (${c.assets.length} au total).`);
  out(`Lien : ${c.url}`);
}

async function cmdEdit(pos, flags) {
  const body = {};
  if (flags.title !== undefined) body.title = need(flags.title, "title", "edit");
  if (flags.format !== undefined) body.format = need(flags.format, "format", "edit");
  if (flags["notes-file"] !== undefined) body.notes = await readTextFile(need(flags["notes-file"], "notes-file", "edit"), process.cwd());
  else if (flags.notes !== undefined) body.notes = str(flags.notes, "notes");
  if (flags.folder !== undefined) body.folder = need(flags.folder, "folder", "edit");
  if (flags["create-folders"]) body.create_folders = true;
  if (flags.assignee !== undefined) body.assignee = need(flags.assignee, "assignee", "edit");
  if (!Object.keys(body).filter((k) => k !== "create_folders").length) {
    throw new CliError(`Rien à modifier : donne au moins --title, --format, --notes, --folder ou --assignee.\n${usage("edit")}`, { code: 2 });
  }
  const c = await api("PATCH", `/contents/${encodeURIComponent(pos[0])}`, body);
  if (flags.json) return printJson(c);
  out(`Modifié : « ${c.title} » · ${FORMAT_FR[c.format] ?? c.format} · ${c.folder_path} · pour : ${personLabel(c.effective_assignee) ?? "personne"}`);
  if (c.created_folders?.length) out(`  dossiers créés : ${c.created_folders.join(", ")}`);
  printWarnings(c.warnings);
  out(`Lien : ${c.url}`);
}

async function cmdSchedule(pos, flags) {
  const id = pos[0];
  const body = { account: need(flags.account, "account", "schedule") };
  const none = (v) => ["none", "null", "aucune", "aucun"].includes(v.toLowerCase());
  if (flags.date !== undefined) {
    const d = need(flags.date, "date", "schedule");
    body.date = none(d) ? null : d;
  }
  if (flags.time !== undefined) {
    const t = need(flags.time, "time", "schedule");
    body.time = none(t) ? null : t;
  }
  if (flags.title !== undefined) body.title = str(flags.title, "title");
  if (flags["description-file"] !== undefined && flags.description !== undefined) {
    throw new CliError("Choisis --description ou --description-file, pas les deux.", { code: 2 });
  }
  if (flags["description-file"] !== undefined) {
    body.description = (await readTextFile(need(flags["description-file"], "description-file", "schedule"), process.cwd())).replace(/\s+$/, "");
  } else if (flags.description !== undefined) body.description = str(flags.description, "description");
  if (flags["post-url"] !== undefined) body.post_url = str(flags["post-url"], "post-url");
  if (Object.keys(body).length === 1) {
    throw new CliError(`Rien à programmer : ajoute au moins --date (ou --time, --title, --description).\n${usage("schedule")}`, { code: 2 });
  }
  const res = await api("PUT", `/contents/${encodeURIComponent(id)}/publications`, body);
  if (flags.json) return printJson(res);
  out(`${res.created ? "Publication créée" : "Publication mise à jour"} : ${pubLine(expectObject(res.publication, "publication"))}`);
  out(`« ${res.content.title} » : ${STATUS_FR[res.content.status] ?? res.content.status} · ${res.content.url}`);
  printWarnings(res.warnings);
}

async function cmdUnschedule(pos, flags) {
  const res = await api("DELETE", `/contents/${encodeURIComponent(pos[0])}/publications`, undefined, {
    account: need(flags.account, "account", "unschedule"),
  });
  if (flags.json) return printJson(res);
  out(`Publication supprimée : ${res.account?.ref ?? "?"}`);
  out(`« ${res.content.title} » : ${STATUS_FR[res.content.status] ?? res.content.status} · ${res.content.url}`);
}

async function cmdPosted(pos, flags) {
  const body = { account: need(flags.account, "account", "posted"), posted: !flags.undo };
  if (flags.url !== undefined) body.post_url = str(flags.url, "url");
  const res = await api("PUT", `/contents/${encodeURIComponent(pos[0])}/publications`, body);
  if (flags.json) return printJson(res);
  out(`${flags.undo ? "Marqué comme non posté" : "Marqué comme posté"} : ${pubLine(expectObject(res.publication, "publication"))}`);
  out(`« ${res.content.title} » : ${STATUS_FR[res.content.status] ?? res.content.status} · ${res.content.url}`);
}

async function cmdCalendar(flags) {
  const res = await api("GET", "/calendar", undefined, {
    from: str(flags.from, "from"),
    to: str(flags.to, "to"),
    folder: str(flags.folder, "folder"),
    account: str(flags.account, "account"),
    assignee: str(flags.assignee, "assignee"),
    include_posted: flags["include-posted"] ? "true" : undefined,
  });
  const pubs = expectArray(res.publications, "publications");
  const overdue = expectArray(res.overdue, "overdue");
  if (flags.json) return printJson(res);
  const line = (p) =>
    `    ${p.time ?? "--:--"}  ${p.account?.ref ?? "?"}  ${p.content?.title}${p.posted ? "  [posté]" : p.late ? "  [EN RETARD]" : ""}` +
    `  ·  ${p.assignee ? p.assignee.name : "personne"}  ·  ${p.folder_path}\n` +
    `           id ${p.content?.id}  ${p.content?.url}`;
  if (res.assignee) out(`Planning de ${res.assignee === "none" ? "personne (publications non attribuées)" : res.assignee.name}`);
  if (overdue.length) {
    out(`EN RETARD, pas encore posté (${overdue.length})`);
    let day = null;
    for (const p of overdue) {
      if (p.date !== day) out(`  ${p.date} (${fmtDay(p.date)})`);
      day = p.date;
      out(line(p));
    }
    out("");
  }
  out(`Du ${res.from} au ${res.to}${res.include_posted ? " (posts publiés inclus)" : ""} : ${pubs.length} publication(s)`);
  let day = null;
  for (const p of pubs) {
    if (p.date !== day) out(`  ${p.date} (${fmtDay(p.date)})${p.date === res.today ? "  aujourd'hui" : ""}`);
    day = p.date;
    out(line(p));
  }
}

async function cmdKeepFiles(pos, flags) {
  const keep = !flags.off;
  const c = await api("PATCH", `/contents/${encodeURIComponent(pos[0])}`, { keep_files: keep });
  if (flags.json) return printJson(c);
  out(
    keep
      ? `Fichiers gardés pour « ${c.title} » : ils ne seront pas retirés du stockage après publication.`
      : `Archivage normal pour « ${c.title} » : ses fichiers seront retirés après publication, selon le délai réglé dans l'app.`,
  );
}

async function cmdArchive(pos, flags) {
  const route = `/contents/${encodeURIComponent(pos[0])}/archive`;
  if (!flags.yes) {
    const prev = await api("POST", route, { dry_run: true });
    const n = expectArray(prev.would_archive_ids, "would_archive_ids").length;
    const kept = expectArray(prev.kept_ids, "kept_ids").length;
    if (!n) throw new CliError(`Rien à retirer pour « ${prev.content.title} » : ses fichiers sont déjà archivés.`, { code: 2, data: prev });
    throw new CliError(
      `Retrait définitif de ${n} fichier(s) de « ${prev.content.title} » du stockage (${fmtSize(prev.freed_bytes)} libérés)` +
        `${kept ? `, ${kept} miniature gardée` : ""}. La fiche, les légendes et les dates restent.` +
        `${prev.keep_files ? " Attention : ce contenu est marqué « fichiers gardés »." : ""} Relance avec --yes pour confirmer.`,
      { code: 2, data: prev },
    );
  }
  const res = await api("POST", route, {});
  if (flags.json) return printJson(res);
  const ids = expectArray(res.archived_ids, "archived_ids");
  out(
    ids.length
      ? `Fichiers retirés du stockage : ${ids.length} (${fmtSize(res.freed_bytes)} libérés) pour « ${res.content.title} ».`
      : `Rien à faire : les fichiers de « ${res.content.title} » sont déjà retirés.`,
  );
}

/* ---------- Statistiques ---------- */

const NUM_FULL = new Intl.NumberFormat("fr-FR");
const NUM_COMPACT = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** 1 284 → « 1 284 », 12 900 000 → « 12,9 M » ; null → « – ». */
function num(n) {
  if (n === null || n === undefined) return "–";
  return Math.abs(n) < 10_000 ? NUM_FULL.format(n) : NUM_COMPACT.format(n);
}

function signed(n) {
  if (n === null || n === undefined) return "–";
  return n > 0 ? `+${num(n)}` : n < 0 ? `−${num(-n)}` : "0";
}

function pct(r) {
  if (r === null || r === undefined) return "–";
  return `${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: r < 0.1 ? 1 : 0 })} %`;
}

function when(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** « 13,5 k vues · 205 likes · … » (les métriques inconnues s'affichent « – »). */
function metricsLine(m) {
  return (
    `${num(m.views)} vues · ${num(m.likes)} likes · ${num(m.comments)} comm. · ${num(m.shares)} partages · ` +
    `${num(m.saves)} enreg. · engagement ${pct(m.engagement)}`
  );
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => "  " + r.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd());
}

async function cmdStats(pos, flags) {
  if (pos[0] === "post") {
    onlyFlags("stats", "post", flags, []);
    if (!pos[1] || pos.length > 2) throw new CliError(usage("stats"), { code: 2 });
    return cmdStatsPost(pos[1], flags);
  }
  if (pos.length) throw new CliError(`Argument inattendu : « ${pos[0]} ».\n${usage("stats")}`, { code: 2 });
  if (flags.period !== undefined && (flags.from !== undefined || flags.to !== undefined)) {
    throw new CliError("Choisis --period, ou --from / --to, pas les deux.", { code: 2 });
  }
  const res = await api("GET", "/stats", undefined, {
    assignee: str(flags.assignee, "assignee"),
    folder: str(flags.folder, "folder"),
    account: str(flags.account, "account"),
    platform: str(flags.platform, "platform"),
    period: str(flags.period, "period"),
    from: str(flags.from, "from"),
    to: str(flags.to, "to"),
    sort: str(flags.sort, "sort"),
    limit: str(flags.limit, "limit"),
  });
  const accounts = expectArray(res.accounts, "accounts");
  const posts = expectArray(res.posts, "posts");
  if (flags.json) return printJson(res);

  const f = res.filters ?? {};
  const range = f.period === "all" ? "toute la période" : f.period ? `${f.period} derniers jours (du ${f.from} au ${f.to})` : `du ${f.from ?? "début"} au ${f.to ?? "aujourd'hui"}`;
  const who = f.assignee ? ` · pour ${f.assignee === "none" ? "personne (comptes non attribués)" : f.assignee.name}` : "";
  out(`Statistiques · ${range}${who} · tri : ${f.sort}`);
  const t = res.totals;
  out(`Totaux : ${t.posts} post(s) · ${metricsLine(t)}`);

  if (accounts.length) {
    out("\nComptes");
    const rows = [["compte", "abonnés", "7 j", "posts", "vues", "moy./post", "engagement", "pour", "dossier"]];
    for (const a of accounts) {
      rows.push([
        a.account.ref,
        num(a.followers),
        signed(a.followers_delta_7d),
        a.posts,
        num(a.views),
        num(a.avg_views),
        pct(a.engagement),
        a.account.assignee?.name ?? "–",
        a.account.folder_path,
      ]);
    }
    for (const l of table(rows)) out(l);
  } else out("\nAucun compte suivi pour ces filtres.");

  out(`\nPosts (${posts.length} sur ${res.posts_total})`);
  for (const p of posts) {
    out(`  ${p.published_day ?? "?"}  ${p.account?.ref ?? "?"}  ${p.kind || ""}  ·  ${metricsLine(p)}`);
    if (p.caption) out(`      « ${oneLine(p.caption, 110)} »`);
    if (p.content) out(`      contenu : « ${p.content.title} »  ${p.content.url}`);
    if (p.url) out(`      ${p.url}`);
  }
  const lc = res.last_collection ?? {};
  out(`\nDernier relevé : ${when(lc.at)} · prochain : ${lc.next_label ?? "vers minuit"}`);
  for (const n of Array.isArray(res.notes) ? res.notes : []) out(`(${n})`);
}

async function cmdStatsPost(ref, flags) {
  const res = await api("GET", `/stats/posts/${encodeURIComponent(ref)}`);
  if (flags.json) return printJson(res);
  const p = expectObject(res.post, "post");
  const history = expectArray(res.history, "history");
  out(`${p.account?.ref ?? "?"} · ${p.kind || "post"} · publié le ${p.published_day ?? "?"}${p.assignee ? ` · pour ${p.assignee.name}` : ""}`);
  if (p.caption_full || p.caption) out(`  « ${oneLine(p.caption_full || p.caption, 200)} »`);
  if (p.url) out(`  ${p.url}`);
  out(`  ${metricsLine(p)}`);
  out(`  relevé le ${when(p.updated_at)} · id ${p.id}`);
  if (p.content) out(`  contenu de l'app : « ${p.content.title} »  ${p.content.url}`);
  out(`\nÉvolution jour par jour (${history.length} relevé(s))`);
  if (history.length) {
    const rows = [["jour", "vues", "évol.", "likes", "comm.", "partages", "enreg.", "engagement"]];
    for (const h of history) rows.push([h.day, num(h.views), signed(h.views_delta), num(h.likes), num(h.comments), num(h.shares), num(h.saves), pct(h.engagement)]);
    for (const l of table(rows)) out(l);
  }
  out(`\nDernier relevé : ${when(res.last_collection?.at)} · prochain : ${res.last_collection?.next_label ?? "vers minuit"}`);
}

async function cmdRmFile(pos, flags) {
  const res = await api("DELETE", `/assets/${encodeURIComponent(pos[0])}`);
  if (flags.json) return printJson(res);
  out(`Fichier supprimé : ${res.file_name} (contenu ${res.content_id})`);
  printWarnings(res.warnings);
}

async function cmdSetKind(pos, flags) {
  const kind = normKind(pos[1], "type");
  const res = await api("PATCH", `/assets/${encodeURIComponent(pos[0])}`, { kind });
  if (flags.json) return printJson(res);
  const a = expectObject(res.asset, "asset");
  out(`Type changé : ${a.file_name} → ${KIND_FR[a.kind] ?? a.kind} (position ${a.position})`);
}

async function cmdDelete(pos, flags) {
  const id = pos[0];
  if (!flags.yes) {
    const c = await api("GET", `/contents/${encodeURIComponent(id)}`);
    throw new CliError(
      `Suppression définitive de « ${c.title} » (${c.assets.length} fichier(s), ${c.publications.length} publication(s)). Relance avec --yes pour confirmer.`,
      { code: 2 },
    );
  }
  const res = await api("DELETE", `/contents/${encodeURIComponent(id)}`);
  if (flags.json) return printJson(res);
  out(`Supprimé : « ${res.title} » (${res.removed_files} fichier(s) retiré(s) du stockage).`);
  printWarnings(res.warnings);
}

/* ------------------------------------------------------------------ */

const HANDLERS = {
  config: (p, f) => cmdConfig(f),
  me: (p, f) => cmdMe(f),
  folders: (p, f) => cmdFolders(f),
  mkdir: cmdMkdir,
  account: cmdAccount,
  list: (p, f) => cmdList(f),
  get: cmdGet,
  push: cmdPush,
  upload: cmdUpload,
  edit: cmdEdit,
  schedule: cmdSchedule,
  unschedule: cmdUnschedule,
  posted: cmdPosted,
  calendar: (p, f) => cmdCalendar(f),
  "rm-file": cmdRmFile,
  "set-kind": cmdSetKind,
  delete: cmdDelete,
  people: cmdPeople,
  folder: cmdFolder,
  "keep-files": cmdKeepFiles,
  archive: cmdArchive,
  stats: cmdStats,
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  FLAGS = flags;
  if (cmd === "--json") FLAGS.json = true;
  if (!cmd || ["help", "--help", "-h"].includes(cmd)) {
    if (pos[0] && USAGE[pos[0]]) return out(usage(pos[0]));
    return out(helpText());
  }
  if (["version", "--version", "-v"].includes(cmd)) return flags.json ? printJson({ version: VERSION }) : out(`depot ${VERSION}`);
  if (!SPECS[cmd]) {
    const guess = closest(cmd, Object.keys(SPECS));
    throw new CliError(`Commande inconnue : « ${cmd} ».${guess ? ` Voulais-tu dire « ${guess} » ?` : ""} Aide : ${PROG} help`, { code: 2 });
  }
  if (flags.help) return out(usage(cmd));
  checkCommandLine(cmd, pos, flags);
  await HANDLERS[cmd](pos, flags);
}

main().catch((e) => {
  const json = FLAGS.json === true;
  const code = e instanceof CliError ? e.code ?? 1 : 1;
  if (json) {
    const data = e instanceof CliError && e.data && typeof e.data === "object" ? e.data : {};
    const message = e instanceof CliError ? e.message : `Erreur inattendue : ${e?.message ?? e}`;
    out(JSON.stringify({ status: e?.status ?? null, ...data, error: message, exit_code: code }, null, 2));
  } else if (e instanceof CliError) {
    err(`Erreur${e.status ? ` ${e.status}` : ""} : ${e.message}`);
    for (const c of Array.isArray(e.data?.choices) ? e.data.choices : []) {
      err(`  - ${c.ref ?? c.path}${c.folder_path ? ` (${c.folder_path})` : ""}  id ${c.id}`);
    }
  } else {
    err(`Erreur inattendue : ${e?.message ?? e}${process.env.DEPOT_DEBUG ? `\n${e?.stack ?? ""}` : " (DEPOT_DEBUG=1 pour le détail)"}`);
  }
  process.exitCode = code;
});
