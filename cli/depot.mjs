#!/usr/bin/env node
// Dépôt contenu : CLI pour l'API par clé (/api/v1).
// Zéro dépendance, Node >= 20 (fetch, fs.openAsBlob). Usage : node depot.mjs help

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_PATH = path.join(os.homedir(), ".depot-contenu.json");
const BOOL_FLAGS = new Set(["json", "yes", "undo", "include-posted", "create-folders", "help"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif"]);
const MIME = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska",
  avi: "video/x-msvideo", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", avif: "image/avif", srt: "application/x-subrip",
  vtt: "text/vtt", txt: "text/plain", pdf: "application/pdf", zip: "application/zip",
};
const STATUS_FR = { draft: "À planifier", scheduled: "Programmé", late: "En retard", partial: "En cours", posted: "Posté" };
const FORMAT_FR = { video: "Vidéo", short: "Short/Reel", carousel: "Carrousel", photo: "Photo", story: "Story", other: "Autre" };
const KIND_FR = { video: "vidéo", thumbnail: "miniature", photo: "photo", other: "autre" };

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
      if (v === undefined) {
        if (BOOL_FLAGS.has(k)) v = true;
        else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) v = argv[++i];
        else v = true;
      }
      flags[k] = v;
    } else if (a === "-y") flags.yes = true;
    else if (a === "-h") flags.help = true;
    else pos.push(a);
  }
  return { pos, flags };
}

const out = (s = "") => process.stdout.write(s + "\n");
const err = (s = "") => process.stderr.write(s + "\n");

function str(v, name) {
  if (v === undefined) return undefined;
  if (v === true) throw new CliError(`L'option --${name} attend une valeur.`, { code: 2 });
  return String(v);
}

function need(v, name, hint = "") {
  const s = str(v, name);
  if (!s) throw new CliError(`Option --${name} obligatoire.${hint ? " " + hint : ""}`, { code: 2 });
  return s;
}

function mimeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function fmtSize(n) {
  if (n == null) return "?";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

function fmtDay(iso) {
  if (!iso) return "non programmé";
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function oneLine(s, max = 80) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/* ------------------------------------------------------------------ */
/* Config & appels API                                                 */
/* ------------------------------------------------------------------ */

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function normalizeUrl(u) {
  return String(u || "").trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

function getConfig() {
  const file = readConfigFile();
  return {
    url: normalizeUrl(process.env.DEPOT_API_URL || file.url),
    key: (process.env.DEPOT_API_KEY || file.key || "").trim(),
    urlFrom: process.env.DEPOT_API_URL ? "DEPOT_API_URL" : file.url ? CONFIG_PATH : null,
    keyFrom: process.env.DEPOT_API_KEY ? "DEPOT_API_KEY" : file.key ? CONFIG_PATH : null,
  };
}

const NO_KEY_HELP =
  "Crée une clé dans l'app (page Réglages → Clés API), puis lance :\n" +
  '  depot config --url "https://ton-app" --key "dpc_…"\n' +
  "(ou définis les variables DEPOT_API_URL et DEPOT_API_KEY).";

async function api(method, route, body, query) {
  const cfg = getConfig();
  if (!cfg.url) throw new CliError(`URL de l'app non configurée.\n${NO_KEY_HELP}`);
  if (!cfg.key) throw new CliError(`Clé API non configurée.\n${NO_KEY_HELP}`);
  const u = new URL(`${cfg.url}/api/v1${route}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "" && v !== false) u.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(u, {
      method,
      headers: {
        authorization: `Bearer ${cfg.key}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new CliError(`Impossible de joindre ${cfg.url} (${e.cause?.code ?? e.message}). L'app est-elle lancée et l'URL correcte ?`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 500) || res.statusText };
  }
  if (!res.ok) {
    let msg = data.error || `${res.status} ${res.statusText}`;
    if (res.status === 401) msg += `\n${NO_KEY_HELP}`;
    throw new CliError(msg, { status: res.status, data });
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Envoi de fichiers                                                   */
/* ------------------------------------------------------------------ */

async function statFiles(list, maxMb) {
  const files = [];
  for (const f of list) {
    let st;
    try {
      st = await fsp.stat(f.abs);
    } catch {
      throw new CliError(`Fichier introuvable : ${f.abs}`);
    }
    if (!st.isFile()) throw new CliError(`Ce n'est pas un fichier : ${f.abs}`);
    if (maxMb && st.size > maxMb * 1024 * 1024) {
      throw new CliError(
        `Fichier trop gros : ${path.basename(f.abs)} fait ${fmtSize(st.size)}, la limite est de ${maxMb} Mo par fichier ` +
          `(plan gratuit Supabase). Compresse-le (ex. ffmpeg -crf 28) ou découpe-le.`,
        { status: 413 },
      );
    }
    files.push({ ...f, name: f.name ?? path.basename(f.abs), size: st.size });
  }
  return files;
}

async function maxFileMb() {
  try {
    const me = await api("GET", "/me");
    return me.app?.max_file_mb ?? 50;
  } catch (e) {
    if (e.status) throw e;
    return 50;
  }
}

/** Envoie des fichiers (déjà vérifiés) sur un contenu : /uploads → PUT signé → /assets. */
async function uploadFiles(contentId, files, { quiet = false } = {}) {
  if (!files.length) return [];
  const { uploads } = await api("POST", `/contents/${contentId}/uploads`, {
    files: files.map((f) => ({ name: f.name, kind: f.kind, content_type: mimeOf(f.name), size: f.size })),
  });
  const done = [];
  let failure = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const u = uploads[i];
    if (!quiet) process.stderr.write(`  [${i + 1}/${files.length}] ${f.name} (${fmtSize(f.size)}, ${KIND_FR[u.kind] ?? u.kind})… `);
    try {
      const blob = await fs.openAsBlob(f.abs, { type: u.content_type });
      const res = await fetch(u.signed_url, {
        method: "PUT",
        headers: { "content-type": u.content_type, "x-upsert": "false", "cache-control": "max-age=3600" },
        body: blob,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        const tooBig = res.status === 413 || /too large|exceeded the maximum/i.test(t);
        throw new CliError(
          tooBig
            ? `Le stockage refuse ${f.name} : fichier trop gros (limite de 50 Mo par fichier sur le plan gratuit Supabase).`
            : `Le stockage refuse ${f.name} (${res.status}) : ${oneLine(t, 300)}`,
          { status: res.status },
        );
      }
      done.push({ path: u.path, kind: u.kind, file_name: f.name, content_type: u.content_type, size: f.size });
      if (!quiet) process.stderr.write("ok\n");
    } catch (e) {
      if (!quiet) process.stderr.write("échec\n");
      failure = e instanceof CliError ? e : new CliError(`Envoi de ${f.name} impossible : ${e.message}`);
      break;
    }
  }
  let registered = [];
  if (done.length) {
    const res = await api("POST", `/contents/${contentId}/assets`, { assets: done });
    registered = res.assets ?? [];
  }
  if (failure) {
    failure.message += `\n${done.length}/${files.length} fichier(s) envoyé(s) et enregistré(s). Relance « depot upload ${contentId} … » pour les autres.`;
    throw failure;
  }
  return registered;
}

/* ------------------------------------------------------------------ */
/* Affichage                                                           */
/* ------------------------------------------------------------------ */

function pubLine(p) {
  const who = p.account?.ref ?? p.ref ?? p.account_id;
  const when = p.date ? `${p.date}${p.time ? " " + p.time : ""} (${fmtDay(p.date)})` : "non programmé";
  const flag = p.posted ? " [posté]" : p.late ? " [EN RETARD]" : "";
  return `${who} : ${when}${flag}`;
}

function printContent(c) {
  out(`${c.title}`);
  out(`  ${STATUS_FR[c.status] ?? c.status} · ${FORMAT_FR[c.format] ?? c.format} · ${c.folder_path}`);
  out(`  id  : ${c.id}`);
  out(`  web : ${c.url}`);
  if (c.notes) out(`  notes : ${oneLine(c.notes, 200)}`);
  out(`Fichiers (${c.assets.length})`);
  for (const a of c.assets) {
    out(`  - [${KIND_FR[a.kind] ?? a.kind} ${a.position}] ${a.file_name} (${fmtSize(a.size_bytes)})  id ${a.id}`);
    if (a.download_url) out(`      ${a.download_url}`);
  }
  out(`Publications (${c.publications.length})`);
  for (const p of c.publications) {
    out(`  - ${pubLine(p)}`);
    if (p.title) out(`      titre : ${oneLine(p.title, 120)}`);
    if (p.description) out(`      description : ${oneLine(p.description, 160)}`);
    if (p.post_url) out(`      lien : ${p.post_url}`);
  }
  if (c.available_accounts?.length) {
    out(`Comptes utilisables : ${c.available_accounts.map((a) => a.ref).join(", ")}`);
  }
}

function printWarnings(w) {
  for (const x of w ?? []) err(`  ! ${x}`);
}

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */

const HELP = `Dépôt contenu : CLI de l'API

Usage : node depot.mjs <commande> [options]   (--json pour la réponse brute)

Configuration
  config --url <https://app> --key <dpc_…>   Enregistre la config dans ~/.depot-contenu.json
  config                                    Affiche la config actuelle
  me                                        Vérifie la clé

Dossiers & comptes
  folders                                   Arborescence avec les comptes
  mkdir <chemin> [--color #hex] [--description …]
                                            Crée "Projet/Sous-projet/Angle" (comme mkdir -p)
  account add --folder <chemin> --platform <instagram|tiktok|youtube|…> --handle <@x> [--url …]

Contenus
  list [--folder …] [--status draft|scheduled|late|partial|posted] [--format …] [--q …] [--limit 50]
  get <contentId>                           Détail + liens de téléchargement (1 h)
  push <manifest.json>                      Crée un contenu + fichiers + publications
  upload <contentId> <fichiers…> [--kind video|thumbnail|photo|other]
  delete <contentId> --yes                  Supprime le contenu et ses fichiers

Calendrier
  schedule <contentId> --account <réf> --date AAAA-MM-JJ|none [--time HH:MM|none]
           [--title …] [--description … | --description-file <fichier>] [--post-url …]
  posted <contentId> --account <réf> [--url <lien du post>] [--undo]
  calendar [--from AAAA-MM-JJ] [--to AAAA-MM-JJ] [--folder …] [--account …] [--include-posted]

Référence de compte (--account) : "instagram" (plateforme), "@handle", "instagram:@handle" ou l'id.

Manifest de push (chemins relatifs au manifest) :
  { "folder": "Projet/Sous-projet/Angle", "create_folders": true,
    "title": "…", "format": "carousel", "notes": "…",
    "files": [ { "path": "./cover.png", "kind": "thumbnail" } ],
    "dir": "./slides",
    "publications": [ { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
                      { "account": "tiktok", "date": "2026-10-21", "description_file": "./caption.txt" } ] }

Config : variables DEPOT_API_URL / DEPOT_API_KEY, sinon ~/.depot-contenu.json { "url", "key" }.`;

async function cmdConfig(flags) {
  if (flags.url !== undefined || flags.key !== undefined) {
    const cur = readConfigFile();
    if (flags.url !== undefined) cur.url = normalizeUrl(need(flags.url, "url"));
    if (flags.key !== undefined) {
      const k = need(flags.key, "key");
      if (!k.startsWith("dpc_")) throw new CliError("La clé doit commencer par « dpc_ ».", { code: 2 });
      cur.key = k;
    }
    await fsp.writeFile(CONFIG_PATH, JSON.stringify(cur, null, 2) + "\n", { mode: 0o600 });
    out(`Config enregistrée dans ${CONFIG_PATH}`);
  }
  const cfg = getConfig();
  if (flags.json) return out(JSON.stringify({ url: cfg.url, key: cfg.key ? cfg.key.slice(0, 10) + "…" : null, config_file: CONFIG_PATH }, null, 2));
  out(`URL : ${cfg.url || "(non définie)"}${cfg.urlFrom ? `  [${cfg.urlFrom}]` : ""}`);
  out(`Clé : ${cfg.key ? cfg.key.slice(0, 10) + "…" : "(non définie)"}${cfg.keyFrom ? `  [${cfg.keyFrom}]` : ""}`);
  if (!cfg.url || !cfg.key) out(`\n${NO_KEY_HELP}`);
}

async function cmdMe(flags) {
  const me = await api("GET", "/me");
  if (flags.json) return out(JSON.stringify(me, null, 2));
  out(`Clé « ${me.key.name} » (${me.key.prefix}…) OK`);
  out(`App : ${me.app.url} · limite ${me.app.max_file_mb} Mo par fichier · aujourd'hui ${me.app.today}`);
}

async function cmdFolders(flags) {
  const res = await api("GET", "/folders");
  if (flags.json) return out(JSON.stringify(res, null, 2));
  if (!res.folders.length) return out("Aucun dossier. Crée-en un : depot mkdir \"Projet/Sous-projet\"");
  for (const f of res.folders) {
    const pad = "  ".repeat(f.depth);
    const count = f.total_contents !== f.contents_count ? `${f.contents_count} / ${f.total_contents} au total` : `${f.contents_count}`;
    out(`${pad}${f.depth === 0 ? "■" : "└"} ${f.name}  (${count} contenu${f.total_contents > 1 ? "s" : ""})`);
    if (f.accounts.length) out(`${pad}    comptes : ${f.accounts.map((a) => a.ref).join(", ")}`);
  }
  out(`\nLes contenus d'un dossier peuvent utiliser les comptes du dossier et de tous ses parents.`);
}

async function cmdMkdir(pos, flags) {
  const p = pos[0];
  if (!p) throw new CliError("Usage : depot mkdir \"Projet/Sous-projet/Angle\" [--color #hex]", { code: 2 });
  const res = await api("POST", "/folders", { path: p, color: str(flags.color, "color"), description: str(flags.description, "description") });
  if (flags.json) return out(JSON.stringify(res, null, 2));
  if (res.created.length) out(`Créé : ${res.created.join(", ")}`);
  else out(`Existe déjà : ${res.folder.path}`);
  out(`id : ${res.folder.id}`);
}

async function cmdAccount(pos, flags) {
  if (pos[0] !== "add") throw new CliError("Usage : depot account add --folder <chemin> --platform <plateforme> --handle <@x> [--url …]", { code: 2 });
  const res = await api("POST", "/accounts", {
    folder: need(flags.folder, "folder"),
    platform: need(flags.platform, "platform"),
    handle: need(flags.handle, "handle"),
    url: str(flags.url, "url"),
    create_folders: flags["create-folders"] ? true : undefined,
  });
  if (flags.json) return out(JSON.stringify(res, null, 2));
  out(`Compte ajouté : ${res.account.ref} dans ${res.account.folder_path}  (id ${res.account.id})`);
}

async function cmdList(flags) {
  const res = await api("GET", "/contents", undefined, {
    folder: str(flags.folder, "folder"),
    status: str(flags.status, "status"),
    format: str(flags.format, "format"),
    q: str(flags.q, "q"),
    limit: str(flags.limit, "limit"),
  });
  if (flags.json) return out(JSON.stringify(res, null, 2));
  if (!res.contents.length) return out("Aucun contenu.");
  for (const c of res.contents) {
    const files = c.files.total ? `${c.files.total} fichier${c.files.total > 1 ? "s" : ""}` : "aucun fichier";
    out(`[${STATUS_FR[c.status] ?? c.status}] ${c.title}  ·  ${FORMAT_FR[c.format] ?? c.format}  ·  ${c.folder_path}  ·  ${files}`);
    for (const p of c.publications) out(`    ${pubLine(p)}`);
    out(`    id ${c.id}  ${c.url}`);
  }
  out(`\n${res.contents.length} affiché(s) sur ${res.total}.`);
}

async function cmdGet(pos, flags) {
  const id = pos[0];
  if (!id) throw new CliError("Usage : depot get <contentId>", { code: 2 });
  const c = await api("GET", `/contents/${encodeURIComponent(id)}`);
  if (flags.json) return out(JSON.stringify(c, null, 2));
  printContent(c);
}

async function readTextFile(p, base) {
  const abs = path.resolve(base, p);
  try {
    return (await fsp.readFile(abs, "utf8")).replace(/^﻿/, "").replace(/\s+$/, "");
  } catch {
    throw new CliError(`Fichier texte introuvable : ${abs}`);
  }
}

async function cmdPush(pos, flags) {
  const manifestPath = pos[0];
  if (!manifestPath) throw new CliError("Usage : depot push <manifest.json>", { code: 2 });
  const absManifest = path.resolve(manifestPath);
  let m;
  try {
    m = JSON.parse((await fsp.readFile(absManifest, "utf8")).replace(/^﻿/, ""));
  } catch (e) {
    throw new CliError(`Manifest illisible (${absManifest}) : ${e.message}`);
  }
  const base = path.dirname(absManifest);
  if (!m.folder) throw new CliError("Le manifest doit contenir « folder ».");
  if (!m.title) throw new CliError("Le manifest doit contenir « title ».");

  // Fichiers : « files » d'abord, puis les images de « dir » (tri naturel).
  const list = [];
  const seen = new Set();
  const add = (abs, kind) => {
    const key = path.resolve(abs).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ abs: path.resolve(abs), kind });
  };
  for (const f of m.files ?? []) {
    const p = typeof f === "string" ? f : f?.path;
    if (!p) throw new CliError("Chaque entrée de « files » doit être un chemin ou { path, kind }.");
    add(path.resolve(base, p), typeof f === "object" ? f.kind : undefined);
  }
  for (const d of [].concat(m.dir ?? [])) {
    const absDir = path.resolve(base, d);
    let names;
    try {
      names = await fsp.readdir(absDir);
    } catch {
      throw new CliError(`Dossier « dir » introuvable : ${absDir}`);
    }
    names
      .filter((n) => IMAGE_EXT.has(path.extname(n).slice(1).toLowerCase()))
      .sort(naturalSort)
      .forEach((n) => add(path.join(absDir, n), "photo"));
  }

  const publications = [];
  for (const p of m.publications ?? []) {
    const { description_file, title_file, ...rest } = p;
    if (description_file) rest.description = await readTextFile(description_file, base);
    if (title_file) rest.title = await readTextFile(title_file, base);
    publications.push(rest);
  }

  // Vérifications avant de créer quoi que ce soit.
  const files = await statFiles(list, await maxFileMb());

  const created = await api("POST", "/contents", {
    folder: m.folder,
    create_folders: m.create_folders,
    title: m.title,
    format: m.format,
    notes: m.notes,
    publications,
  });
  if (!flags.json) {
    out(`Contenu créé : « ${created.title} » (${FORMAT_FR[created.format] ?? created.format}) dans ${created.folder_path}`);
    if (created.created_folders?.length) out(`  dossiers créés : ${created.created_folders.join(", ")}`);
    for (const p of created.publications) out(`  publication ${pubLine(p)}`);
    printWarnings(created.warnings);
    if (files.length) err(`Envoi de ${files.length} fichier(s)…`);
  }

  try {
    await uploadFiles(created.id, files, { quiet: !!flags.json });
  } catch (e) {
    e.message += `\nContenu : ${created.url}`;
    throw e;
  }

  const final = await api("GET", `/contents/${created.id}`);
  if (flags.json) return out(JSON.stringify({ ...final, warnings: created.warnings ?? [] }, null, 2));
  out(`Terminé : ${final.assets.length} fichier(s), ${final.publications.length} publication(s), statut ${STATUS_FR[final.status] ?? final.status}.`);
  out(`id  : ${final.id}`);
  out(`Lien : ${final.url}`);
}

async function cmdUpload(pos, flags) {
  const [id, ...paths] = pos;
  if (!id || !paths.length) throw new CliError("Usage : depot upload <contentId> <fichiers…> [--kind thumbnail]", { code: 2 });
  const kind = str(flags.kind, "kind");
  const files = await statFiles(paths.map((p) => ({ abs: path.resolve(p), kind })), await maxFileMb());
  if (!flags.json) err(`Envoi de ${files.length} fichier(s)…`);
  const assets = await uploadFiles(id, files, { quiet: !!flags.json });
  if (flags.json) return out(JSON.stringify({ assets }, null, 2));
  const c = await api("GET", `/contents/${encodeURIComponent(id)}`);
  out(`${assets.length} fichier(s) ajouté(s) à « ${c.title} » (${c.assets.length} au total).`);
  out(`Lien : ${c.url}`);
}

async function cmdSchedule(pos, flags) {
  const id = pos[0];
  if (!id) throw new CliError("Usage : depot schedule <contentId> --account <réf> --date AAAA-MM-JJ [--time HH:MM]", { code: 2 });
  const body = { account: need(flags.account, "account") };
  if (flags.date !== undefined) {
    const d = need(flags.date, "date");
    body.date = ["none", "null", "aucune"].includes(d.toLowerCase()) ? null : d;
  }
  if (flags.time !== undefined) {
    const t = need(flags.time, "time");
    body.time = ["none", "null", "aucune"].includes(t.toLowerCase()) ? null : t;
  }
  if (flags.title !== undefined) body.title = str(flags.title, "title");
  if (flags["description-file"] !== undefined) body.description = await readTextFile(need(flags["description-file"], "description-file"), process.cwd());
  else if (flags.description !== undefined) body.description = str(flags.description, "description");
  if (flags["post-url"] !== undefined) body.post_url = str(flags["post-url"], "post-url");
  if (Object.keys(body).length === 1) throw new CliError("Rien à programmer : ajoute au moins --date (ou --time, --title, --description).", { code: 2 });
  const res = await api("PUT", `/contents/${encodeURIComponent(id)}/publications`, body);
  if (flags.json) return out(JSON.stringify(res, null, 2));
  out(`${res.created ? "Publication créée" : "Publication mise à jour"} : ${pubLine(res.publication)}`);
  out(`« ${res.content.title} » : ${STATUS_FR[res.content.status] ?? res.content.status} · ${res.content.url}`);
  printWarnings(res.warnings);
}

async function cmdPosted(pos, flags) {
  const id = pos[0];
  if (!id) throw new CliError("Usage : depot posted <contentId> --account <réf> [--url <lien>] [--undo]", { code: 2 });
  const body = { account: need(flags.account, "account"), posted: !flags.undo };
  if (flags.url !== undefined) body.post_url = str(flags.url, "url");
  const res = await api("PUT", `/contents/${encodeURIComponent(id)}/publications`, body);
  if (flags.json) return out(JSON.stringify(res, null, 2));
  out(`${flags.undo ? "Marqué comme non posté" : "Marqué comme posté"} : ${pubLine(res.publication)}`);
  out(`« ${res.content.title} » : ${STATUS_FR[res.content.status] ?? res.content.status} · ${res.content.url}`);
}

async function cmdCalendar(flags) {
  const res = await api("GET", "/calendar", undefined, {
    from: str(flags.from, "from"),
    to: str(flags.to, "to"),
    folder: str(flags.folder, "folder"),
    account: str(flags.account, "account"),
    include_posted: flags["include-posted"] ? "true" : undefined,
  });
  if (flags.json) return out(JSON.stringify(res, null, 2));
  const line = (p) =>
    `    ${p.time ?? "--:--"}  ${p.account.ref ?? "?"}  ${p.content.title}${p.posted ? "  [posté]" : p.late ? "  [EN RETARD]" : ""}  ·  ${p.folder_path}\n` +
    `           id ${p.content.id}  ${p.content.url}`;
  if (res.overdue.length) {
    out(`EN RETARD, pas encore posté (${res.overdue.length})`);
    let day = null;
    for (const p of res.overdue) {
      if (p.date !== day) out(`  ${p.date} (${fmtDay(p.date)})`);
      day = p.date;
      out(line(p));
    }
    out("");
  }
  out(`Du ${res.from} au ${res.to}${res.include_posted ? " (posts publiés inclus)" : ""} : ${res.publications.length} publication(s)`);
  let day = null;
  for (const p of res.publications) {
    if (p.date !== day) out(`  ${p.date} (${fmtDay(p.date)})${p.date === res.today ? "  aujourd'hui" : ""}`);
    day = p.date;
    out(line(p));
  }
}

async function cmdDelete(pos, flags) {
  const id = pos[0];
  if (!id) throw new CliError("Usage : depot delete <contentId> --yes", { code: 2 });
  if (!flags.yes) {
    const c = await api("GET", `/contents/${encodeURIComponent(id)}`);
    throw new CliError(
      `Suppression définitive de « ${c.title} » (${c.assets.length} fichier(s), ${c.publications.length} publication(s)). Relance avec --yes pour confirmer.`,
      { code: 2 },
    );
  }
  const res = await api("DELETE", `/contents/${encodeURIComponent(id)}`);
  if (flags.json) return out(JSON.stringify(res, null, 2));
  out(`Supprimé : « ${res.title} » (${res.removed_files} fichier(s) retiré(s) du stockage).`);
}

/* ------------------------------------------------------------------ */

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h" || flags.help) return out(HELP);
  switch (cmd) {
    case "config": return cmdConfig(flags);
    case "me": return cmdMe(flags);
    case "folders": return cmdFolders(flags);
    case "mkdir": return cmdMkdir(pos, flags);
    case "account": return cmdAccount(pos, flags);
    case "list": return cmdList(flags);
    case "get": return cmdGet(pos, flags);
    case "push": return cmdPush(pos, flags);
    case "upload": return cmdUpload(pos, flags);
    case "schedule": return cmdSchedule(pos, flags);
    case "posted": return cmdPosted(pos, flags);
    case "calendar": return cmdCalendar(flags);
    case "delete": return cmdDelete(pos, flags);
    default:
      throw new CliError(`Commande inconnue : ${cmd}. Lance « depot help ».`, { code: 2 });
  }
}

main().catch((e) => {
  const json = process.argv.includes("--json");
  if (e instanceof CliError) {
    if (json) {
      const data = e.data && typeof e.data === "object" ? e.data : {};
      out(JSON.stringify({ status: e.status ?? null, ...data, error: e.message }, null, 2));
    } else {
      err(`Erreur${e.status ? ` ${e.status}` : ""} : ${e.message}`);
      for (const c of e.data?.choices ?? []) {
        err(`  - ${c.ref ?? c.path}${c.folder_path ? ` (${c.folder_path})` : ""}  id ${c.id}`);
      }
    }
    process.exit(e.code ?? 1);
  }
  err(`Erreur inattendue : ${e?.stack ?? e}`);
  process.exit(1);
});
