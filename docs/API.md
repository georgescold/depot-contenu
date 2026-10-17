# API Dépôt contenu (v1)

API REST par clé pour envoyer du contenu dans l'app et le programmer depuis d'autres projets (scripts, Claude Code…).
Base : `https://<app>/api/v1`. Réponses en JSON. Les fichiers ne passent jamais par l'app : ils vont directement chez
**Backblaze B2** via des URLs signées.

Dans les exemples :

```bash
export DEPOT_API_URL="http://localhost:3000"
export DEPOT_API_KEY="dpc_…"            # créée dans l'app : Réglages → Clés API
```

> Windows / Git Bash : `curl -d '…é…'` envoie les accents dans le mauvais encodage. Mets le JSON dans un fichier UTF-8 et
> envoie-le avec `--data-binary @corps.json` (ou utilise le CLI, qui envoie toujours de l'UTF-8).

## Authentification

`Authorization: Bearer dpc_…` (ou `X-API-Key: dpc_…`). La clé est hachée (SHA-256) et comparée à `api_keys` ; une clé
inconnue ou révoquée renvoie **401** (une clé révoquée ne peut pas être réactivée). `last_used_at` est mis à jour après la réponse.

## Erreurs

```json
{ "error": "message en français", "...": "détails éventuels" }
```

| Code | Cas |
|---|---|
| 400 | JSON invalide, champ manquant, date ≠ `AAAA-MM-JJ`, heure ≠ `HH:MM`, valeur inconnue, id non uuid, chemin de stockage invalide, fichier vide, plus de 100 fichiers par requête |
| 401 | Clé absente, inconnue ou révoquée |
| 404 | Contenu, fichier, dossier ou compte introuvable (`missing`, `available_accounts` en détail) |
| 409 | Compte ou dossier ambigu (`choices: [{ id, platform, handle, ref, folder_path }]`), compte ou fichier en double |
| 413 | Fichier > `MAX_FILE_MB` (4096 Mo) |
| 502 | Erreur du stockage (Backblaze B2) |

## Conventions

- **Dossier** (`folder`) : uuid, ou chemin `"Projet/Sous-projet/Angle"` (séparateurs `/`, `>` ou `›`), comparé sans casse,
  sans accents et sans espaces en trop. `create_folders: true` crée les segments manquants (comme `mkdir -p`) ; si deux
  requêtes créent le même dossier en même temps, la seconde réutilise celui de la première. En cas d'échec en cours de
  route, les dossiers créés par la requête sont supprimés. Les chemins renvoyés (`path`, `folder_path`) utilisent ` / `.
- **Compte** (`account`), cherché parmi les comptes du dossier du contenu **et de ses parents** :
  - uuid du compte ;
  - plateforme (`"instagram"`, alias `ig`, `yt`, `tt`, `twitter`…) : s'il y en a plusieurs, le plus proche du dossier
    (le plus profond) gagne ; égalité → 409 avec `choices` ;
  - handle (`"@didier.immo"` ou `"didier.immo"`) ou `"plateforme:handle"`.
- **Dates** `AAAA-MM-JJ`, **heures** `HH:MM` (heure de Paris ; `9h30` et `HH:MM:SS` acceptés en entrée).
- **Énumérations** : formats `video|short|carousel|photo|story|other` ; fichiers `video|thumbnail|photo|other` ;
  plateformes `youtube|instagram|tiktok|facebook|linkedin|x|threads|pinterest|snapchat|other` ;
  statuts `draft|scheduled|late|partial|posted` (calculés par `contentStatus`).
- `url` = page web du contenu : `${origin}/contenus/${id}` (origine = `APP_URL` si défini, sinon celle de la requête).
- `warnings` : avertissements non bloquants (titre YouTube > 100 caractères, légende trop longue, **date déjà passée**…).
- **100 fichiers maximum par requête** sur `/uploads` et `/assets` (le CLI envoie les fichiers un par un).

---

## GET /api/v1/me

```bash
curl -s "$DEPOT_API_URL/api/v1/me" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "key": { "id": "…", "name": "Mon PC", "prefix": "dpc_a028Hf", "created_at": "…", "last_used_at": "…" },
  "app": { "url": "http://localhost:3000", "max_file_mb": 4096, "multipart_threshold_bytes": 104857600,
           "max_files_per_request": 100, "today": "2026-10-17" } }
```

## GET /api/v1/folders

Liste à plat, triée dans l'ordre de l'arbre.

```bash
curl -s "$DEPOT_API_URL/api/v1/folders" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "folders": [
  { "id": "…", "parent_id": null, "name": "Projet", "path": "Projet", "depth": 0, "color": "#14b8a6",
    "description": "", "position": 0, "created_at": "…", "contents_count": 0, "total_contents": 3,
    "accounts": [ { "id": "…", "folder_id": "…", "platform": "instagram", "platform_label": "Instagram",
                    "handle": "@projet", "url": "", "ref": "instagram:@projet" } ] }
] }
```

`contents_count` = contenus directement dans le dossier, `total_contents` = avec les sous-dossiers ; `accounts` = comptes
propres au dossier (pas ceux hérités des parents).

## POST /api/v1/folders

`{ path, color?, description? }` : crée le chemin (mkdir -p) et renvoie le dossier final (201 si quelque chose a été créé, 200 sinon).

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/folders" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"path":"Compaatible/Lancement/Angle jalousie","color":"#ec4899"}'
```

```json
{ "folder": { "id": "…", "name": "Angle jalousie", "path": "Compaatible / Lancement / Angle jalousie", "depth": 2, "...": "…" },
  "created": ["Compaatible", "Compaatible / Lancement", "Compaatible / Lancement / Angle jalousie"], "existed": false }
```

## POST /api/v1/accounts

`{ folder, platform, handle, url?, create_folders? }` → 201 `{ account }` ; 409 si ce compte (plateforme + handle) existe déjà.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/accounts" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"folder":"Compaatible","platform":"instagram","handle":"@compaatible"}'
```

## GET /api/v1/contents

`?folder=&status=&format=&q=&limit=` : `folder` inclut les sous-dossiers ; `q` cherche dans le titre (sans casse ; les
caractères `* % _ , ( ) \` comptent comme « n'importe quel caractère ») ; `limit` 50 par défaut, 200 max. Plus récents d'abord.

```bash
curl -s -G "$DEPOT_API_URL/api/v1/contents" -H "Authorization: Bearer $DEPOT_API_KEY" \
  --data-urlencode "folder=Compaatible" --data-urlencode "status=late"
```

```json
{ "contents": [
  { "id": "…", "title": "…", "format": "carousel", "folder_id": "…", "folder_path": "Projet / Angle", "status": "partial",
    "files": { "video": 0, "thumbnail": 1, "photo": 2, "other": 0, "total": 3 },
    "publications": [ { "id": "…", "account_id": "…", "platform": "instagram", "handle": "@projet", "ref": "instagram:@projet",
                        "date": "2026-10-20", "time": "18:00", "posted": true, "late": false } ],
    "url": "…/contenus/…", "created_at": "…", "updated_at": "…" } ],
  "total": 1, "limit": 50 }
```

## POST /api/v1/contents

`{ folder, create_folders?, title, format?, notes?, publications?: [{ account, date?, time?, title?, description?, posted?, post_url? }], dry_run? }`
→ 201 avec le contenu complet (forme de `GET /contents/:id`) + `created_folders` + `warnings`. Tout est validé avant
écriture ; en cas d'erreur, rien ne reste. `format` vaut `video` par défaut ; une publication par compte.

**`dry_run: true`** : valide tout (dossier, comptes, dates, doublons) **sans rien écrire** → 200
`{ dry_run, title, format, folder_id, folder_path, missing_folders, publications: [{ account, date, time }], warnings }`
(`folder_id` est `null` si des dossiers restent à créer). Le CLI s'en sert avant d'envoyer les fichiers.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" --data-binary @contenu.json
```

## GET /api/v1/contents/:id

Contenu complet. Les `download_url` sont des URLs B2 pré-signées valables **1 h**, qui forcent le téléchargement sous le
nom d'origine (`response-content-disposition` : `filename="<ASCII de secours>"` + `filename*=UTF-8''<vrai nom>`).

```json
{ "id": "…", "title": "…", "format": "carousel", "notes": "…", "folder_id": "…", "folder_path": "Projet / Angle",
  "status": "scheduled", "created_at": "…", "updated_at": "…", "url": "…/contenus/…",
  "assets": [ { "id": "…", "kind": "thumbnail", "position": 0, "file_name": "Légende été.png", "mime_type": "image/png",
                "size_bytes": 211, "storage_path": "<id>/thumbnail/mvcpl98y-axnq-Legende-ete.png", "created_at": "…",
                "download_url": "https://s3.<région>.backblazeb2.com/<bucket>/<id>/thumbnail/…?response-content-disposition=attachment%3B…&X-Amz-Expires=3600&X-Amz-Signature=…" } ],
  "publications": [ { "id": "…", "account_id": "…", "account": { "id": "…", "platform": "instagram", "handle": "@projet", "url": "…", "ref": "instagram:@projet" },
                      "date": "2026-10-20", "time": "18:00", "title": "", "description": "…", "posted": false,
                      "posted_at": null, "post_url": "", "late": false, "updated_at": "…" } ],
  "available_accounts": [ { "id": "…", "folder_path": "Projet", "platform": "instagram", "handle": "@projet", "ref": "instagram:@projet", "...": "…" } ] }
```

`assets` : tri par type (`video`, `thumbnail`, `photo`, `other`) puis `position` ; `publications` : par date puis heure.

## PATCH /api/v1/contents/:id

`{ title?, format?, notes?, folder?, create_folders? }` (`folder` = déplacer). Les publications dont le compte n'est plus
accessible depuis le nouveau dossier sont gardées, avec un `warning`.

```bash
curl -s -X PATCH "$DEPOT_API_URL/api/v1/contents/<id>" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"format":"short","folder":"Compaatible/Lancement"}'
```

## DELETE /api/v1/contents/:id

Supprime d'abord la ligne (publications et fichiers en cascade), puis, au mieux, les objets B2 : ceux des fichiers et
**tout le préfixe `<id>/`** (envois interrompus). Si le stockage échoue, la suppression réussit quand même et `warnings`
le signale (le nettoyage quotidien ramassera les restes).

```bash
curl -s -X DELETE "$DEPOT_API_URL/api/v1/contents/<id>" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "deleted": true, "id": "…", "title": "…", "removed_files": 8, "warnings": [] }
```

## PUT /api/v1/contents/:id/publications

`{ account, date?, time?, title?, description?, posted?, post_url? }` : upsert sur (contenu, compte), seuls les champs
fournis changent. `date: null` déprogramme (et efface l'heure). 201 si créée, 200 sinon (deux requêtes simultanées :
la seconde met à jour la publication créée par la première).

```bash
curl -s -X PUT "$DEPOT_API_URL/api/v1/contents/<id>/publications" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"account":"tiktok","date":"2026-10-22","time":"09:30"}'
```

```json
{ "publication": { "id": "…", "account": { "...": "…" }, "date": "2026-10-22", "time": "09:30", "posted": false, "late": false, "...": "…" },
  "created": false, "content": { "id": "…", "title": "…", "status": "scheduled", "url": "…" }, "warnings": [] }
```

Marquer comme posté : `{"account":"instagram","posted":true,"post_url":"https://…"}` (`posted:false` pour annuler).

## DELETE /api/v1/contents/:id/publications?account=…

```bash
curl -s -X DELETE "$DEPOT_API_URL/api/v1/contents/<id>/publications?account=instagram" -H "Authorization: Bearer $DEPOT_API_KEY"
```

## Envoyer des fichiers

Trois étapes : **préparer** (`/uploads`), **envoyer** directement chez B2, **enregistrer** (`/assets`).

### POST /api/v1/contents/:id/uploads

`{ files: [{ name, size, kind?, content_type? }] }` (un objet seul est accepté ; 100 au plus). `size` (octets) est
**obligatoire** : 0 → 400, > 4096 Mo → 413. `kind` fourni ou déduit (`inferKind`). Pour chaque fichier :

- `size` ≤ 100 Mo → `{ mode: "single", signed_url }` : un seul PUT (URL valable 12 h) ;
- au-delà → `{ mode: "multipart", upload_id, part_size, part_count, part_urls }` : une URL par part (16 Mo, valables 24 h).

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents/<id>/uploads" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"files":[{"name":"video.mp4","size":31457280}]}'
```

```json
{ "uploads": [ { "name": "video.mp4", "file_name": "video.mp4", "path": "<id>/video/mvcp…-video.mp4", "kind": "video",
                 "content_type": "video/mp4", "size": 31457280, "mode": "single", "signed_url": "https://s3.<région>.backblazeb2.com/…" } ],
  "max_file_mb": 4096, "multipart_threshold_bytes": 104857600, "how_to": "…" }
```

**Envoi simple** (le fichier est lu en flux, pas chargé en mémoire) :

```bash
curl -s -T video.mp4 -H "content-type: video/mp4" "<signed_url>"
```

**Envoi multipart** : la part `i` (1..N) contient les octets `[(i-1)×part_size, i×part_size[` ; garde l'en-tête `ETag`
de chaque réponse, puis termine :

```bash
curl -s -T part-001.bin -D - "<part_urls[0]>" | grep -i etag
```

### POST /api/v1/contents/:id/uploads/complete

`{ path, upload_id, parts: [{ part, etag }] }` : assemble le fichier (parts 1..N contiguës, sinon 400).
`{ path, upload_id, abort: true }` : annule l'envoi et supprime les parts déjà reçues.

```json
{ "completed": true, "path": "<id>/video/…", "parts": 10 }
```

### POST /api/v1/contents/:id/assets

`{ assets: [{ path, kind?, file_name, content_type?, size? }] }` (objet seul accepté ; 100 au plus). `path` doit être un
chemin renvoyé par `/uploads` **pour ce contenu** (`<id>/<type>/<nom>`). L'API vérifie que l'objet existe vraiment
(HEAD B2) et sa taille réelle : au-delà de 4096 Mo, l'objet est supprimé et la réponse est 413. `position` = max du même
type + 1 (dans l'ordre de la liste) ; `kind` vaut par défaut le type du chemin.

**Valeurs enregistrées** : `size_bytes` = taille réelle lue dans B2 (la `size` envoyée ne sert que si B2 n'en donne pas) ;
`mime_type` = type stocké par B2, sauf s'il est générique (`application/octet-stream`), alors `content_type` envoyé,
sinon déduit de l'extension.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents/<id>/assets" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" \
  -d '{"assets":[{"path":"<id>/video/mvcp…-video.mp4","kind":"video","file_name":"video.mp4","content_type":"video/mp4"}]}'
```

### PATCH /api/v1/assets/:id

`{ kind?, position? }` → `{ asset }`. Un changement de type sans `position` place le fichier à la fin de son nouveau type.

### DELETE /api/v1/assets/:id

Supprime la ligne, puis l'objet B2 au mieux → `{ deleted, id, content_id, file_name, warnings }`.

## GET /api/v1/calendar

`?from=&to=&folder=&account=&include_posted=` : par défaut d'aujourd'hui (Paris) à +30 jours, non postées seulement.
`folder` inclut les sous-dossiers ; `account` = une plateforme (tous ses comptes) ou un compte précis. Tri par date puis
heure. `overdue` = publications non postées dont la date est passée (toutes dates, mêmes filtres).

```bash
curl -s -G "$DEPOT_API_URL/api/v1/calendar" -H "Authorization: Bearer $DEPOT_API_KEY" \
  --data-urlencode "from=2026-10-19" --data-urlencode "to=2026-10-25"
```

```json
{ "from": "2026-10-19", "to": "2026-10-25", "today": "2026-10-17", "include_posted": false,
  "publications": [ { "publication_id": "…", "date": "2026-10-22", "time": "09:30", "posted": false, "late": false,
                      "title": "", "description": "…", "post_url": "",
                      "account": { "id": "…", "platform": "tiktok", "handle": "@projet", "ref": "tiktok:@projet" },
                      "content": { "id": "…", "title": "…", "format": "carousel", "url": "…" },
                      "folder_id": "…", "folder_path": "Projet / Angle" } ],
  "overdue": [] }
```

---

## CLI `cli/depot.mjs` (version 2.0.0)

Zéro dépendance, Node ≥ 20. Config : `DEPOT_API_URL` / `DEPOT_API_KEY`, sinon `~/.depot-contenu.json`
(`{ "url", "key" }`, écrit par `config`). La clé du fichier n'est envoyée qu'à l'URL du fichier : si `DEPOT_API_URL`
diffère, il faut aussi `DEPOT_API_KEY`. Sortie lisible en français ; `--json` = JSON brut sur stdout, **erreurs comprises**
(`{ error, status, exit_code, … }`), progression sur stderr. Codes de sortie : 0 ok, 1 erreur, 2 mauvaise utilisation
(options inconnues refusées, avec suggestion).

```bash
node cli/depot.mjs config --url "https://app" --key -           # « - » : colle la clé (entrée standard)
node cli/depot.mjs me | version | folders
node cli/depot.mjs mkdir "Projet/Sous-projet/Angle" [--color "#14b8a6"]
node cli/depot.mjs account add --folder "Projet" --platform instagram --handle "@moncompte" [--url …]
node cli/depot.mjs list [--folder …] [--status late] [--format …] [--q …] [--limit 50]
node cli/depot.mjs get <id>
node cli/depot.mjs push manifest.json [--rollback]
node cli/depot.mjs upload <id> video.mp4 "cover.png:thumbnail" ./slides [--kind photo]
node cli/depot.mjs edit <id> [--title …] [--format …] [--notes … | --notes-file f.txt] [--folder "Projet/Angle"] [--create-folders]
node cli/depot.mjs schedule <id> --account tiktok --date 2026-10-21 [--time 18:00] [--title …] [--description … | --description-file f.txt]
node cli/depot.mjs schedule <id> --account tiktok --date none        # déprogrammer (garder la publication)
node cli/depot.mjs unschedule <id> --account tiktok                   # supprimer la publication
node cli/depot.mjs posted <id> --account instagram [--url https://…] [--undo]
node cli/depot.mjs calendar [--from …] [--to …] [--folder …] [--account …] [--include-posted]
node cli/depot.mjs set-kind <assetId> thumbnail
node cli/depot.mjs rm-file <assetId>
node cli/depot.mjs delete <id> --yes
```

- `upload` : arguments triés en ordre naturel ; un dossier ajoute tous ses fichiers (sauf fichiers cachés et
  `Thumbs.db` / `desktop.ini`) ; `chemin:type` fixe le type d'un fichier ; `--kind` s'applique aux autres. Fichiers de
  0 octet refusés.
- Envoi : un fichier à la fois (`/uploads` → envoi → `/assets`), donc jamais plus de 100 par requête. Corps lu en flux
  depuis le disque (`fs.openAsBlob`, `redirect: "error"`) : la mémoire reste stable (≈ 70 Mo mesurés pour 160 Mo).
  Au-delà de 100 Mo : multipart, parts de 16 Mo, 3 en parallèle. Chaque PUT (ou part) est retenté 4 fois (délais 1, 3,
  9 s) sur erreur réseau, 408, 429 ou 5xx ; message de B2 (`<Message>`) affiché sinon. Progression toutes les 5 s.
- Fichiers texte (`description_file`, `notes_file`, manifest) : UTF-8 (BOM accepté), UTF-16 avec BOM ; fichier ANSI
  refusé avec un message clair ; fins de ligne converties en `\n`. Sous Windows, les chemins Git Bash `/c/…` sont acceptés.

### Manifest de `push`

Chemins relatifs au manifest (ou absolus).

```json
{
  "folder": "Compaatible/Lancement/Angle jalousie",
  "create_folders": false,
  "title": "Jalousie : 5 signes",
  "format": "carousel",
  "notes": "…",
  "files": [ { "path": "./video.mp4", "kind": "video" }, { "path": "./cover.png", "kind": "thumbnail" } ],
  "dir": "./slides",
  "publications": [
    { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
    { "account": "tiktok", "date": "2026-10-21", "description_file": "./caption-tiktok.txt" }
  ]
}
```

| Champ | Rôle |
|---|---|
| `folder`, `create_folders` | Dossier cible (chemin ou uuid) ; crée les segments manquants |
| `title`, `format`, `notes` / `notes_file` | Contenu (`format` : `video` par défaut) |
| `files` | Chemins ou `{ path, kind }` ; sans `kind`, déduit du type de fichier |
| `dir` | Dossier (ou liste) : toutes les images (png, jpg, jpeg, webp, gif, heic, heif, avif, jfif) en `photo`, tri naturel ; fichiers cachés (`.…`, `._…`), sous-dossiers et autres formats ignorés avec avertissement ; erreur si aucune image |
| `publications` | Comme l'API ; `description_file` / `title_file` lisent un fichier texte |

Déroulé : lecture et vérification locale (fichiers, tailles, encodages) → `POST /contents` en `dry_run` (dossier, comptes,
dates) → contenu créé **sans** publications → fichiers envoyés et enregistrés un par un → publications créées.

En cas d'échec, le JSON d'erreur contient `content_id`, `content_url`, `stage` (`files` ou `publications`), `uploaded[]`,
`remaining[]`, `failed_file`, `remaining_publications[]` et `resume_commands[]` (`upload <id> …` pour les fichiers restants,
puis `schedule …`). **Ne pas relancer `push`** (doublon). Avec `--rollback`, le contenu est supprimé à la place
(`rolled_back: true`).

## Installer le skill Claude Code

```bash
node scripts/install-skill.mjs
```

Copie `skill/depot-contenu/SKILL.md`, `cli/depot.mjs` et ce fichier (en `reference.md`) dans
`~/.claude/skills/depot-contenu/`, affiche l'ancienne et la nouvelle version du CLI ; ne touche pas à `~/.depot-contenu.json`.
Ensuite, une fois :

```bash
node "$HOME/.claude/skills/depot-contenu/depot.mjs" config --url "https://adresse-de-l-app" --key -
node "$HOME/.claude/skills/depot-contenu/depot.mjs" me
```

Relancer `install-skill.mjs` après chaque mise à jour du CLI, du skill ou de cette doc.
