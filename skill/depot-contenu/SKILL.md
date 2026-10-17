---
name: depot-contenu
description: Envoie des vidéos, carrousels, miniatures et descriptions dans l'app « Dépôt contenu » (drive/CRM de contenus à poster) et les programme dans son calendrier de publication, via son API par clé. À utiliser dès que l'utilisateur dit « envoie dans le dépôt », « dépose cette vidéo / ce carrousel / ces slides », « mets ça dans Dépôt contenu », « programme ce post », « planifie la publication de… », « ajoute au calendrier de publication », « cale ce reel mardi 18 h », « qu'est-ce que je dois poster aujourd'hui / cette semaine », « qu'est-ce qui est en retard », « marque comme posté », « j'ai publié le post », « crée le dossier projet / sous-projet / angle », « ajoute le compte Instagram du projet », ou mentionne « dépôt contenu », « dépôt vidéo » ou « depot ».
---

# Dépôt contenu

L'app range les contenus dans des **dossiers imbriqués** (projet → sous-projet → angle…). Un contenu = un titre, un format
(`video`, `short`, `carousel`, `photo`, `story`, `other`), des fichiers (`video`, `thumbnail`, `photo` = slides, `other`)
et **une publication par compte** (date, heure, titre, description, posté oui/non). Les comptes (plateforme + handle) sont
rattachés à un dossier ; un contenu peut utiliser les comptes de son dossier **et de tous ses parents**.

## Lancer le CLI

```bash
node ~/.claude/skills/depot-contenu/depot.mjs <commande> [options]      # --json pour la réponse brute
```

(Ci-dessous `depot` = cette commande.) `depot help` liste tout.

## Si la clé manque

Erreur « Clé API non configurée » ou 401 : demande à l'utilisateur de créer une clé dans l'app (**Réglages → Clés API**),
puis de lancer lui-même (ne lui demande pas de te coller la clé si tu peux l'éviter) :

```bash
depot config --url "https://adresse-de-l-app" --key "dpc_…"
```

Alternative : variables `DEPOT_API_URL` / `DEPOT_API_KEY`. Vérifie avec `depot me`.

## Workflow conseillé

1. **Voir l'arborescence et les comptes** : `depot folders`.
2. **Choisir le bon dossier** (projet / sous-projet / angle). S'il n'existe pas : `depot mkdir "Projet/Sous-projet/Angle"`
   ou `"create_folders": true` dans le manifest. Les noms sont comparés sans casse ni accents ; séparateur `/` ou `>`.
   Si un compte manque : `depot account add --folder "Projet" --platform instagram --handle "@moncompte"`.
3. **Écrire un manifest** (JSON, chemins relatifs au manifest) puis `depot push manifest.json` :

```json
{
  "folder": "Compaatible/Lancement/Angle jalousie",
  "create_folders": true,
  "title": "Jalousie : 5 signes",
  "format": "carousel",
  "notes": "Brief, sources, idées de hook…",
  "files": [ { "path": "./cover.png", "kind": "thumbnail" } ],
  "dir": "./slides",
  "publications": [
    { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
    { "account": "tiktok", "date": "2026-10-21", "description_file": "./caption-tiktok.txt" },
    { "account": "youtube", "date": "2026-10-22", "time": "17:00", "title": "…", "description": "…" }
  ]
}
```

   - `dir` ajoute toutes les images du dossier (tri naturel : 2 avant 10) comme slides `photo`.
   - `files` : `{ "path", "kind" }` ; sans `kind`, vidéo → `video`, image → `photo`. La miniature = `thumbnail`.
   - `account` : `"instagram"` (s'il n'y en a qu'un, sinon le plus proche du dossier), `"@handle"`, `"instagram:@handle"` ou l'id.
     Erreur 409 « Compte ambigu » → reprends un des choix listés.
   - Une description **adaptée à chaque plateforme** (voir règles ci-dessous). `description_file` / `title_file` lisent un fichier texte.
   - Sans date, la publication est créée « à planifier ».
4. **Donner le lien web** affiché à la fin (`Lien : …/contenus/<id>`) à l'utilisateur, avec un résumé (dossier, fichiers, dates).

Le push vérifie tout avant de créer : fichiers présents, taille, dossier, comptes. Si un envoi échoue au milieu, le contenu
existe déjà : relance seulement `depot upload <id> <fichiers…>`.

## Autres commandes

```bash
depot list [--folder "Projet"] [--status draft|scheduled|late|partial|posted] [--format carousel] [--q "mot"]
depot get <id>                                   # détail + liens de téléchargement (1 h)
depot upload <id> video.mp4 cover.png --kind thumbnail   # --kind s'applique à tous les fichiers
depot schedule <id> --account tiktok --date 2026-10-21 --time 18:00 --description-file caption.txt
depot schedule <id> --account tiktok --date none # déprogrammer
depot posted <id> --account instagram [--url https://lien-du-post] [--undo]
depot calendar [--from 2026-10-20 --to 2026-10-26] [--folder "Projet"] [--account instagram] [--include-posted]
depot delete <id> --yes
```

- « Qu'est-ce que je dois poster aujourd'hui / cette semaine ? » → `depot calendar --to <date>` : montre d'abord le bloc
  **EN RETARD** (dates passées non postées), puis les publications à venir, avec titre, compte et lien.
- « J'ai posté le reel » → `depot posted <id> --account <compte>` (ajoute `--url` si l'utilisateur donne le lien).
- Pour retrouver un id : `depot list --q "mot du titre"`.

## Règles d'écriture par plateforme

| Plateforme | Titre | Description (max) | Conseils |
|---|---|---|---|
| YouTube | **≤ 100 caractères**, obligatoire | 5000 | Mots-clés au début ; 3 hashtags max utiles (les 3 premiers s'affichent au-dessus du titre) |
| Instagram | pas de titre | 2200 | Hook dans la 1ʳᵉ ligne (≈ 125 car. visibles) ; 3 à 5 hashtags ciblés en fin (30 max) |
| TikTok | pas de titre | 4000 | Court, accrocheur ; 3 à 5 hashtags |
| Facebook | pas de titre | 63206 | Texte aéré, 1 à 3 hashtags |
| LinkedIn | pas de titre | 3000 | Accroche en 2 lignes, paragraphes courts, 3 hashtags |
| X | pas de titre | 280 | 1 ou 2 hashtags au plus |
| Threads | pas de titre | 500 | Ton conversationnel, 1 hashtag |
| Pinterest | titre (100) | 500 | Mots-clés descriptifs |
| Snapchat | pas de titre | 250 | Très court |

- Mets le titre seulement là où la plateforme en a un (YouTube, Pinterest) ; ailleurs, tout va dans `description`.
- L'API renvoie des `warnings` (titre trop long, description trop longue…) : corrige avec `depot schedule … --description-file`.
- Écris dans la langue du projet ; pas de hashtags inventés hors sujet.

## Limites et précautions

- **50 Mo maximum par fichier** (plan gratuit Supabase). Au-delà, l'envoi est refusé (413) : propose de compresser
  (ex. `ffmpeg -i in.mp4 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 128k out.mp4`) ou de découper.
- **Demande toujours une confirmation explicite avant `depot delete`** (suppression définitive du contenu et de ses fichiers).
- Dates `AAAA-MM-JJ`, heures `HH:MM` (heure de Paris).
- Ne publie rien sur les réseaux : l'app ne fait que ranger et planifier ; c'est l'utilisateur qui poste puis coche « posté ».
- Référence complète de l'API : `docs/API.md` dans le projet de l'app.
