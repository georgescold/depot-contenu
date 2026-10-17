# API Dépôt contenu (v1)

API REST par clé pour envoyer du contenu dans l'app et le programmer depuis d'autres projets (scripts, Claude Code…).
Base : `https://<app>/api/v1`. Toutes les réponses sont en JSON.

Dans les exemples :

```bash
export DEPOT_API_URL="http://localhost:3000"
export DEPOT_API_KEY="dpc_…"            # créée dans l'app : Réglages → Clés API
```

> Windows / Git Bash : un `curl -d '…é…'` envoie les accents dans le mauvais encodage. Mets le JSON dans un fichier UTF-8
> et envoie-le avec `--data-binary @corps.json` (ou utilise le CLI, qui envoie toujours de l'UTF-8).

## Authentification

`Authorization: Bearer dpc_…` (ou `X-API-Key: dpc_…`). La clé est hachée (SHA-256) et comparée à la table `api_keys` ;
une clé inconnue ou révoquée renvoie **401**. `last_used_at` est mis à jour après la réponse.

## Erreurs

```json
{ "error": "message en français", "...": "détails éventuels" }
```

| Code | Cas |
|---|---|
| 400 | JSON invalide, champ manquant, date ≠ `AAAA-MM-JJ`, heure ≠ `HH:MM`, valeur d'énumération inconnue, id non uuid |
| 401 | Clé absente, inconnue ou révoquée |
| 404 | Contenu, fichier, dossier ou compte introuvable (`missing`, `available_accounts` en détail) |
| 409 | Compte ou dossier ambigu (`choices: [{ id, platform, handle, ref, folder_path }]`), doublon |
| 413 | Fichier > `MAX_FILE_MB` (50 Mo, plan gratuit Supabase) |
| 502 | Erreur du stockage Supabase |

## Conventions

- **Dossier** (`folder`) : uuid, ou chemin `"Projet/Sous-projet/Angle"` (séparateurs `/` ou `>`), comparé sans casse,
  sans accents et sans espaces en trop. `create_folders: true` crée les segments manquants (comme `mkdir -p`).
  Les chemins renvoyés (`path`, `folder_path`) utilisent ` / ` et sont réutilisables tels quels.
- **Compte** (`account`) : cherché parmi les comptes du dossier du contenu **et de ses parents** :
  - uuid du compte ;
  - nom de plateforme (`"instagram"`, alias `ig`, `yt`, `tt`, `twitter`…) : s'il y en a plusieurs, le plus proche du dossier
    (le plus profond) gagne ; égalité → 409 avec `choices` ;
  - handle (`"@didier.immo"` ou `"didier.immo"`) ;
  - `"plateforme:handle"` (`"instagram:@didier.immo"`).
- **Dates** `AAAA-MM-JJ`, **heures** `HH:MM` (heure de Paris implicite ; `9h30` et `HH:MM:SS` acceptés en entrée).
- **Énumérations** : formats `video|short|carousel|photo|story|other` ; fichiers `video|thumbnail|photo|other` ;
  plateformes `youtube|instagram|tiktok|facebook|linkedin|x|threads|pinterest|snapchat|other` ;
  statuts `draft|scheduled|late|partial|posted` (calculés, voir `src/lib/status.ts`).
- `url` = page web du contenu : `${origin}/contenus/${id}` (origine = `APP_URL` si défini, sinon celle de la requête).
- `warnings` (tableau de textes) : avertissements non bloquants (titre YouTube > 100 caractères, description trop longue…).

---

## GET /api/v1/me

Infos sur la clé utilisée.

```bash
curl -s "$DEPOT_API_URL/api/v1/me" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "key": { "id": "…", "name": "Mon PC", "prefix": "dpc_a028Hf", "created_at": "…", "last_used_at": "…" },
  "app": { "url": "http://localhost:3000", "max_file_mb": 50, "today": "2026-10-17" } }
```

## GET /api/v1/folders

Liste à plat, triée en profondeur (ordre de l'arbre).

```bash
curl -s "$DEPOT_API_URL/api/v1/folders" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "folders": [
  { "id": "…", "parent_id": null, "name": "Test API", "path": "Test API", "depth": 0, "color": "#14b8a6",
    "description": "", "position": 0, "created_at": "…",
    "contents_count": 0, "total_contents": 3,
    "accounts": [ { "id": "…", "folder_id": "…", "platform": "instagram", "platform_label": "Instagram",
                    "handle": "@test.api", "url": "https://instagram.com/test.api", "ref": "instagram:@test.api" } ] },
  { "id": "…", "parent_id": "…", "name": "Sous-projet", "path": "Test API / Sous-projet", "depth": 1, "...": "…" }
] }
```

`contents_count` = contenus directement dans le dossier, `total_contents` = avec les sous-dossiers ; `accounts` = comptes
propres au dossier (pas ceux hérités des parents).

## POST /api/v1/folders

`{ path, color?, description? }` : crée le chemin (mkdir -p) et renvoie le dossier final. `color` (`#RRGGBB`) et
`description` s'appliquent au dossier final ; un projet créé d'un coup prend la couleur sur toute la branche.
201 si quelque chose a été créé, 200 sinon.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/folders" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"path":"Compaatible/Lancement/Angle jalousie","color":"#ec4899"}'
```

```json
{ "folder": { "id": "…", "parent_id": "…", "name": "Angle jalousie", "path": "Compaatible / Lancement / Angle jalousie",
              "depth": 2, "color": "#ec4899", "description": "", "position": 0, "created_at": "…" },
  "created": ["Compaatible", "Compaatible / Lancement", "Compaatible / Lancement / Angle jalousie"],
  "existed": false }
```

## POST /api/v1/accounts

`{ folder, platform, handle, url?, create_folders? }` → 201 `{ account }`. 409 si le même compte (plateforme + handle)
existe déjà dans ce dossier.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/accounts" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"folder":"Compaatible","platform":"instagram","handle":"@compaatible"}'
```

```json
{ "account": { "id": "…", "folder_id": "…", "folder_path": "Compaatible", "platform": "instagram",
               "platform_label": "Instagram", "handle": "@compaatible", "url": "", "ref": "instagram:@compaatible" } }
```

## GET /api/v1/contents

`?folder=&status=&format=&q=&limit=` : `folder` inclut les sous-dossiers, `status` est calculé avec `contentStatus`,
`q` cherche dans le titre (insensible à la casse), `limit` 50 par défaut, 200 max. Tri : plus récents d'abord.

```bash
curl -s -G "$DEPOT_API_URL/api/v1/contents" -H "Authorization: Bearer $DEPOT_API_KEY" \
  --data-urlencode "folder=Compaatible" --data-urlencode "status=late"
```

```json
{ "contents": [
  { "id": "…", "title": "Carrousel de test", "format": "carousel", "folder_id": "…",
    "folder_path": "Test API / Sous-projet / Angle", "status": "partial",
    "files": { "video": 0, "thumbnail": 1, "photo": 2, "other": 0, "total": 3 },
    "publications": [ { "id": "…", "account_id": "…", "platform": "instagram", "handle": "@test.api",
                        "ref": "instagram:@test.api", "date": "2026-10-20", "time": "18:00", "posted": true, "late": false } ],
    "url": "http://localhost:3000/contenus/…", "created_at": "…", "updated_at": "…" } ],
  "total": 1, "limit": 50 }
```

## POST /api/v1/contents

`{ folder, create_folders?, title, format?, notes?, publications?: [{ account, date?, time?, title?, description?, posted?, post_url? }] }`
→ 201 avec le **contenu complet** (même forme que `GET /contents/:id`) + `created_folders` + `warnings`.
Tout est validé avant écriture ; en cas d'erreur, rien ne reste (contenu et dossiers créés pour l'occasion sont annulés).
`format` vaut `video` par défaut. Une seule publication par compte.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" --data-binary @contenu.json
```

```json
{ "folder": "Compaatible/Lancement/Angle jalousie", "create_folders": true,
  "title": "Jalousie : 5 signes", "format": "carousel", "notes": "…",
  "publications": [ { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
                    { "account": "tiktok", "date": "2026-10-21" } ] }
```

## GET /api/v1/contents/:id

Contenu complet. Les `download_url` sont signées **1 h** et forcent le téléchargement avec le nom d'origine
(caractères non ASCII remplacés : « Légende été.png » → « Legende ete.png »).

```bash
curl -s "$DEPOT_API_URL/api/v1/contents/<id>" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "id": "…", "title": "…", "format": "carousel", "notes": "…", "folder_id": "…",
  "folder_path": "Test API / Sous-projet / Angle", "status": "scheduled",
  "created_at": "…", "updated_at": "…", "url": "http://localhost:3000/contenus/…",
  "assets": [ { "id": "…", "kind": "thumbnail", "position": 0, "file_name": "cover.png", "mime_type": "image/png",
                "size_bytes": 211, "storage_path": "<id>/thumbnail/mvcpl98y-axnq-cover.png", "created_at": "…",
                "download_url": "https://….supabase.co/storage/v1/object/sign/media/…?token=…&download=cover.png" } ],
  "publications": [ { "id": "…", "account_id": "…",
                      "account": { "id": "…", "platform": "instagram", "handle": "@test.api", "url": "…", "ref": "instagram:@test.api" },
                      "date": "2026-10-20", "time": "18:00", "title": "", "description": "…",
                      "posted": false, "posted_at": null, "post_url": "", "late": false, "updated_at": "…" } ],
  "available_accounts": [ { "id": "…", "folder_id": "…", "folder_path": "Test API", "platform": "instagram",
                            "platform_label": "Instagram", "handle": "@test.api", "url": "…", "ref": "instagram:@test.api" } ] }
```

`assets` est trié par type (`video`, `thumbnail`, `photo`, `other`) puis `position` ; `publications` par date puis heure
(non programmées à la fin) ; `available_accounts` = comptes utilisables (dossier + parents, du plus haut au plus proche).

## PATCH /api/v1/contents/:id

`{ title?, format?, notes?, folder?, create_folders? }` : `folder` déplace le contenu. Les publications dont le compte
n'est plus accessible depuis le nouveau dossier sont gardées, avec un `warning`. Renvoie le contenu complet.

```bash
curl -s -X PATCH "$DEPOT_API_URL/api/v1/contents/<id>" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"format":"short","folder":"Compaatible/Lancement"}'
```

## DELETE /api/v1/contents/:id

Supprime d'abord les objets du bucket (ceux des `assets` + ceux restés sous `<id>/` après un envoi interrompu),
puis la ligne (publications et assets partent en cascade).

```bash
curl -s -X DELETE "$DEPOT_API_URL/api/v1/contents/<id>" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "deleted": true, "id": "…", "title": "…", "removed_files": 4 }
```

## PUT /api/v1/contents/:id/publications

`{ account, date?, time?, title?, description?, posted?, post_url? }` : upsert sur (contenu, compte). Seuls les champs
fournis sont modifiés. `date: null` déprogramme (et efface l'heure). `posted: true` renseigne `posted_at`.
201 si la publication est créée, 200 si elle est modifiée.

```bash
curl -s -X PUT "$DEPOT_API_URL/api/v1/contents/<id>/publications" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"account":"tiktok","date":"2026-10-22","time":"09:30"}'
```

```json
{ "publication": { "id": "…", "account_id": "…", "account": { "...": "…" }, "date": "2026-10-22", "time": "09:30",
                   "title": "", "description": "…", "posted": false, "posted_at": null, "post_url": "", "late": false, "updated_at": "…" },
  "created": false,
  "content": { "id": "…", "title": "…", "status": "scheduled", "url": "…" },
  "warnings": [] }
```

Marquer comme posté : `{"account":"instagram","posted":true,"post_url":"https://…"}` (`posted:false` pour annuler).

## DELETE /api/v1/contents/:id/publications?account=…

```bash
curl -s -X DELETE "$DEPOT_API_URL/api/v1/contents/<id>/publications?account=instagram" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "deleted": true, "publication_id": "…", "account": { "id": "…", "platform": "instagram", "handle": "…", "ref": "…" },
  "content": { "id": "…", "title": "…", "status": "draft", "url": "…" } }
```

## POST /api/v1/contents/:id/uploads

`{ files: [{ name, kind?, content_type?, size? }] }` (un objet seul est accepté). Pour chaque fichier : `kind` fourni ou
déduit (`inferKind`), chemin `buildStoragePath(id, kind, name)`, URL d'envoi signée (valable 2 h).
**413** si `size` > 50 Mo.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents/<id>/uploads" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"files":[{"name":"video.mp4","size":31457280}]}'
```

```json
{ "uploads": [ { "name": "video.mp4", "file_name": "video.mp4", "path": "<id>/video/mvcp…-video.mp4", "kind": "video",
                 "content_type": "video/mp4", "size": 31457280,
                 "signed_url": "https://….supabase.co/storage/v1/object/upload/sign/media/…?token=…", "token": "…" } ],
  "max_file_mb": 50, "how_to": "…" }
```

Envoi du fichier (corps = octets bruts) :

```bash
curl -s -X PUT "<signed_url>" -H "content-type: video/mp4" -H "x-upsert: false" --data-binary @video.mp4
```

## POST /api/v1/contents/:id/assets

`{ assets: [{ path, kind, file_name, content_type?, size? }] }` (un objet seul est accepté). Vérifie que `path` commence par
`<id>/` et que l'objet existe vraiment dans le bucket (`storage.info`), puis insère la ligne avec
`position` = max du même type + 1 (dans l'ordre de la liste). Taille et type MIME sont repris du stockage si absents.

```bash
curl -s -X POST "$DEPOT_API_URL/api/v1/contents/<id>/assets" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" \
  -d '{"assets":[{"path":"<id>/video/mvcp…-video.mp4","kind":"video","file_name":"video.mp4","content_type":"video/mp4"}]}'
```

```json
{ "assets": [ { "id": "…", "kind": "video", "position": 0, "file_name": "video.mp4", "...": "…", "download_url": "…" } ],
  "content": { "id": "…", "url": "…" } }
```

## PATCH /api/v1/assets/:id

`{ kind?, position? }` → `{ asset }`.

```bash
curl -s -X PATCH "$DEPOT_API_URL/api/v1/assets/<assetId>" -H "Authorization: Bearer $DEPOT_API_KEY" \
  -H "content-type: application/json" -d '{"kind":"thumbnail","position":0}'
```

## DELETE /api/v1/assets/:id

Supprime l'objet du bucket puis la ligne.

```bash
curl -s -X DELETE "$DEPOT_API_URL/api/v1/assets/<assetId>" -H "Authorization: Bearer $DEPOT_API_KEY"
```

```json
{ "deleted": true, "id": "…", "content_id": "…", "file_name": "cover.png" }
```

## GET /api/v1/calendar

`?from=&to=&folder=&account=&include_posted=` : par défaut d'aujourd'hui (heure de Paris) à +30 jours, publications non
postées seulement. `folder` inclut les sous-dossiers. `account` : un nom de plateforme filtre **tous** les comptes de cette
plateforme ; un handle, `plateforme:handle` ou un id filtre un compte précis. Tri par date puis heure.
`overdue` = publications non postées dont la date est passée (toutes dates, mêmes filtres dossier/compte).

```bash
curl -s -G "$DEPOT_API_URL/api/v1/calendar" -H "Authorization: Bearer $DEPOT_API_KEY" \
  --data-urlencode "from=2026-10-19" --data-urlencode "to=2026-10-25" --data-urlencode "folder=Compaatible"
```

```json
{ "from": "2026-10-19", "to": "2026-10-25", "today": "2026-10-17", "include_posted": false,
  "publications": [
    { "publication_id": "…", "date": "2026-10-22", "time": "09:30", "posted": false, "posted_at": null, "late": false,
      "title": "", "description": "…", "post_url": "",
      "account": { "id": "…", "platform": "tiktok", "handle": "@test.api", "ref": "tiktok:@test.api" },
      "content": { "id": "…", "title": "…", "format": "carousel", "url": "…" },
      "folder_id": "…", "folder_path": "Test API / Sous-projet / Angle" } ],
  "overdue": [ { "...": "même forme, late: true" } ] }
```

---

## CLI `cli/depot.mjs`

Zéro dépendance, Node ≥ 20. Config : `DEPOT_API_URL` / `DEPOT_API_KEY`, sinon `~/.depot-contenu.json`
(`{ "url": "...", "key": "..." }`, écrit par `depot config`). Sortie lisible en français, `--json` pour le JSON brut
(erreurs comprises, sur stdout). Code de sortie : 0 ok, 1 erreur, 2 mauvaise utilisation.

```bash
node cli/depot.mjs config --url "http://localhost:3000" --key "dpc_…"
node cli/depot.mjs me
node cli/depot.mjs folders
node cli/depot.mjs mkdir "Projet/Sous-projet/Angle" --color "#14b8a6"
node cli/depot.mjs account add --folder "Projet" --platform instagram --handle "@moncompte" [--url …]
node cli/depot.mjs list --folder "Projet" --status late
node cli/depot.mjs get <id>
node cli/depot.mjs push manifest.json
node cli/depot.mjs upload <id> video.mp4 cover.png [--kind thumbnail]
node cli/depot.mjs schedule <id> --account tiktok --date 2026-10-21 --time 18:00 --description-file caption.txt
node cli/depot.mjs schedule <id> --account tiktok --date none            # déprogrammer
node cli/depot.mjs posted <id> --account instagram [--url https://…] [--undo]
node cli/depot.mjs calendar --from 2026-10-19 --to 2026-10-25 [--folder …] [--account …] [--include-posted]
node cli/depot.mjs delete <id> --yes
```

Envoi d'un fichier : `/uploads` → `PUT signed_url` (`content-type`, `x-upsert: false`, corps `fs.openAsBlob`, sans tout
charger en mémoire) → `/assets`. La taille est vérifiée avant tout envoi (limite lue via `/me`).

### Manifest de `push`

Chemins relatifs au fichier manifest.

```json
{
  "folder": "Compaatible/Lancement/Angle jalousie",
  "create_folders": true,
  "title": "Jalousie : 5 signes",
  "format": "carousel",
  "notes": "…",
  "files": [ { "path": "./slides/01.png", "kind": "photo" }, { "path": "./cover.png", "kind": "thumbnail" } ],
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
| `title`, `format`, `notes` | Contenu (`format` : `video` par défaut) |
| `files` | Chemins (texte) ou `{ path, kind }` ; sans `kind`, déduit du type de fichier |
| `dir` | Dossier (ou liste) dont toutes les images sont ajoutées en `photo`, tri naturel (2 avant 10) ; les fichiers déjà listés dans `files` ne sont pas dupliqués |
| `publications` | Comme l'API ; `description_file` / `title_file` lisent un fichier texte UTF-8 |

Déroulé : vérification des fichiers (existence, taille) → `POST /contents` (dossier, comptes et dates validés côté API,
rien n'est créé en cas d'erreur) → envoi des fichiers dans l'ordre (`files` puis `dir`) → affichage du lien web.
Si un envoi échoue, les fichiers déjà envoyés restent enregistrés ; relancer `upload` pour le reste.

## Installer le skill Claude Code

```bash
node scripts/install-skill.mjs
```

Copie `skill/depot-contenu/SKILL.md` et `cli/depot.mjs` dans `~/.claude/skills/depot-contenu/`. Ensuite, une fois :

```bash
node ~/.claude/skills/depot-contenu/depot.mjs config --url "https://adresse-de-l-app" --key "dpc_…"
node ~/.claude/skills/depot-contenu/depot.mjs me
```

Le skill se déclenche dans n'importe quel projet (« envoie dans le dépôt », « programme ce post », « qu'est-ce que je dois
poster cette semaine »…). Relancer `install-skill.mjs` après une mise à jour du CLI ou du skill.
