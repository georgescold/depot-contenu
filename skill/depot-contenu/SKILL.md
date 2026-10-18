---
name: depot-contenu
description: Range des vidéos, reels, carrousels, slides, miniatures et légendes dans l'app « Dépôt contenu » (drive/CRM des contenus à poster) et les programme dans son calendrier de publication, via son CLI. À utiliser quand l'utilisateur dit « envoie / balance / range / mets / dépose … dans le dépôt », « … dans l'angle X / le projet Y », « dépose cette vidéo / mon reel / mon carrousel / mes slides », « programme ce post », « planifie la publication de… », « cale ce reel mardi 18 h », « ajoute au calendrier de publication / au calendrier éditorial / au planning de publication », « qu'est-ce que je dois poster aujourd'hui / cette semaine », « qu'est-ce qu'Enzo doit poster aujourd'hui / cette semaine », « les vidéos de Loys », « attribue … à Enzo », « c'est pour Loys », « supprime le dossier / l'angle X », « déplace l'angle X dans le projet Y », « supprime le compte », « renomme Enzo en … », « garde les fichiers de … », « libère la place / supprime les fichiers de … », « qu'est-ce qui est en retard », « marque comme posté », « j'ai publié le post », « crée l'angle / le sous-projet », « ajoute le compte Instagram du projet », ou cite « Dépôt contenu ». NE PAS utiliser pour un dépôt git (repo, « depot » au sens git, commit, push git, GitHub).
---

# Dépôt contenu

Arborescence de **dossiers** (projet → sous-projet → angle…) → **contenus** (titre, format `video|short|carousel|photo|story|other`)
→ **fichiers** (`video`, `thumbnail` = miniature, `photo` = slides, `other`) + **une publication par compte** (date, heure,
titre, légende, posté oui/non). Un contenu peut utiliser les comptes de son dossier **et de tous ses parents**.
**Personnes** (`depot people --json` : Enzo, Loys…) : une publication revient à la personne du contenu, sinon à celle du
compte, sinon à celle du dossier le plus proche (`assignee` / `effective_assignee` dans les réponses).
L'app ne publie **rien** sur les réseaux : elle range et planifie, l'utilisateur poste puis coche « posté ».

## Lancer le CLI (bash et PowerShell)

```bash
node "$HOME/.claude/skills/depot-contenu/depot.mjs" <commande> [options] --json
```

Ci-dessous `depot` = cette commande. Toujours `--json` pour lire les réponses. Référence complète : [reference.md](reference.md).

**Clé absente** (« Clé API non configurée » ou 401) : demande à l'utilisateur de créer une clé dans l'app (**Réglages → Clés API**)
puis de lancer lui-même `depot config --url "https://adresse-de-l-app" --key -` (il colle la clé). Ne lui demande pas la clé.

## Procédure pour déposer un contenu

1. **Date du jour** : `depot me --json` → `app.today` (heure de Paris). Convertis « demain », « mardi », « la semaine pro »
   en dates absolues et répète-les avec le jour : « mardi 20 octobre 2026 à 18 h ».
2. **Dossier** : `depot folders --json`. Choisis un dossier **existant** (projet / sous-projet / angle) et ses comptes.
   Ne mets `"create_folders": true` que si l'utilisateur demande un nouveau dossier ; en cas de doute, **demande**.
   **Personne** : si l'utilisateur dit pour qui c'est (« c'est pour Loys »), ajoute `"assignee": "Loys"` au manifest
   (sinon rien : le dossier ou le compte décide). Personne inconnue (404) : **ne la crée pas**, propose `depot people add "<nom>"`.
3. **Fichiers** : trouve les exports récents et vérifie qu'ils sont **finis** (taille non nulle et stable) :
   - PowerShell : `Get-ChildItem "$HOME\Videos","$HOME\Downloads","$HOME\Desktop" -File -Recurse -Depth 2 | Where-Object LastWriteTime -gt (Get-Date).AddDays(-2) | Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName,Length,LastWriteTime`
   - bash : `find ~/Videos ~/Downloads ~/Desktop -maxdepth 3 -type f -mtime -2 -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort -r | head -20`
   - stabilité : `node -e "const fs=require('fs'),f=process.argv[1],a=fs.statSync(f).size;setTimeout(()=>{const b=fs.statSync(f).size;console.log(a===b&&a>0?'stable':'export en cours',b)},10000)" "<fichier>"`
4. **Légendes** : une par plateforme (règles ci-dessous). Lis le brief, le script ou le `.srt` à côté de la vidéo s'il y en a.
5. **Récapitulatif à faire valider** : dossier, personne, fichiers (type de chacun), dates avec le jour, légende par compte. Attends le « ok ».
6. **Manifest** : écris-le avec l'outil Write (UTF-8) dans un dossier temporaire, chemins **absolus** avec des `/` :

```json
{
  "folder": "Compaatible/Lancement/Angle jalousie",
  "title": "Jalousie : 5 signes",
  "format": "carousel",
  "notes": "Brief, sources…",
  "assignee": "Enzo",
  "files": [ { "path": "C:/Users/moi/Exports/cover.png", "kind": "thumbnail" } ],
  "dir": "C:/Users/moi/Exports/slides",
  "publications": [
    { "account": "instagram", "date": "2026-10-20", "time": "18:00", "description": "…" },
    { "account": "tiktok", "date": "2026-10-21", "description_file": "C:/Users/moi/Exports/caption-tiktok.txt" },
    { "account": "youtube", "date": "2026-10-22", "time": "17:00", "title": "…", "description": "…" }
  ]
}
```

   - `dir` : toutes les images du dossier (png, jpg, jpeg, webp, gif, heic, heif, avif, jfif), tri naturel (2 avant 10),
     en `photo` ; fichiers cachés et autres formats ignorés (avertissement).
   - `files` : `{ path, kind }` ; sans `kind`, vidéo → `video`, image → `photo`. La miniature : `"kind": "thumbnail"`.
   - `account` : `"instagram"` (le compte le plus proche du dossier), `"@handle"`, `"instagram:@handle"` ou l'id.
     409 « Compte ambigu » : reprends un des `choices`.
7. **Envoi** : `depot push <manifest> --json`. Au-delà de quelques centaines de Mo, lance-le **en arrière-plan** (la
   progression s'affiche sur stderr). Ordre : tout est validé, puis contenu créé, fichiers envoyés, publications créées.
8. **Lien** : donne `url` (page du contenu) avec un résumé : dossier, fichiers, dates avec le jour, `warnings` éventuels.

## Reprise après un échec

- **Ne relance jamais `push`** après un échec partiel : ça créerait un doublon. Le JSON d'erreur contient `content_id`,
  `uploaded`, `remaining`, `failed_file`, `remaining_publications` et `resume_commands` : exécute ces commandes dans l'ordre
  (`upload <id> …` pour les fichiers restants, puis `schedule …` pour les publications).
- Doute sur un doublon : `depot list --q "mot du titre" --json` avant de recréer quoi que ce soit.
- `push --rollback` supprime le contenu si l'envoi échoue (utile quand l'utilisateur préfère tout recommencer).
- **413** : fichier > 4 Go (ou 0 octet). Propose de compresser :
  `ffmpeg -i in.mp4 -c:v libx264 -crf 28 -preset slow -c:a aac -b:a 128k out.mp4`, ou de découper.
- **503 / coupure réseau** : le CLI refait chaque envoi 4 fois (et chaque part de 16 Mo). Si ça échoue encore, attends
  quelques minutes puis exécute les `resume_commands`. **401** : clé révoquée ou absente (voir plus haut).

## Autres commandes

```bash
depot list [--folder "Projet"] [--status draft|scheduled|late|partial|posted] [--assignee Loys|none] [--q "mot"] --json
depot get <id> --json                                 # détail, ids des fichiers, liens de téléchargement (1 h)
depot upload <id> "C:/…/video.mp4" "C:/…/cover.png:thumbnail" "C:/…/slides"   # type par fichier : chemin:type
depot edit <id> [--title …] [--format …] [--notes-file f.txt] [--folder "Projet/Angle"] [--assignee Enzo|none]
depot people --json · depot people add "Prénom"       # n'ajoute une personne que si l'utilisateur le veut
depot folder edit "Projet/Angle" --assignee Loys|none  · depot account edit <accountId> --assignee Enzo|none
depot schedule <id> --account tiktok --date 2026-10-21 [--time 18:00] [--description-file caption.txt]
depot unschedule <id> --account tiktok                # retire la publication de ce compte
depot posted <id> --account instagram [--url https://lien-du-post] [--undo]
depot calendar [--from 2026-10-19 --to 2026-10-25] [--folder "Projet"] [--account instagram] [--assignee Enzo|none] [--include-posted] --json
depot set-kind <assetId> thumbnail                    # change le type d'un fichier
depot rm-file <assetId>                               # supprime un fichier (demande confirmation avant)
depot mkdir "Projet/Sous-projet/Angle" · depot account add --folder "Projet" --platform instagram --handle "@x"
depot delete <id> --yes                               # suppression définitive : confirmation explicite obligatoire
```

- « Qu'est-ce que je poste aujourd'hui / cette semaine ? » → `depot calendar --to <date> --json` : d'abord `overdue`
  (dates passées non postées), puis `publications`, avec titre, compte, légende et lien.
- « Qu'est-ce qu'Enzo doit poster cette semaine ? » → `depot calendar --assignee Enzo --from <lundi> --to <dimanche> --json`
  (dates de la semaine calculées depuis `app.today`) ; « les vidéos de Loys » → `depot list --assignee Loys --format video --json`.
- « Attribue ce contenu à Enzo » → `depot edit <id> --assignee Enzo` ; tout un angle ou un compte → `folder edit` / `account edit`.
- « J'ai posté le reel » → `depot posted <id> --account <compte>` (+ `--url` si l'utilisateur donne le lien).
- Options inconnues refusées (code 2) : ne devine pas d'options, lis `depot help`.

## Ranger (dossiers, comptes, personnes, fichiers)

```bash
depot folder move "Projet/Angle" --to "Autre projet"   # --to root = à la racine ; warnings si des comptes ne suivent plus
depot folder rm "Projet/Angle" --yes [--force]          # dossier VIDE seulement ; ses comptes et leurs publications partent avec lui
depot account rm <accountId> --yes [--force]            # supprime le compte et ses publications
depot people rename Enzo "Enzo B." · depot people color Enzo "#0ea5e9" · depot people rm Enzo --yes
depot keep-files <id> [--off]                           # garder les fichiers après publication (exception à l'archivage)
depot archive <id> --yes                                # « libère la place » : retire tout de suite les fichiers d'un contenu posté partout
```

- **Avant toute suppression, `--force` ou `archive`** : lance d'abord la commande **sans `--yes`** (aperçu, code 2 : comptes,
  publications non postées, fichiers et place libérée), répète à l'utilisateur ce qui sera perdu, attends un « oui » explicite,
  puis relance avec `--yes`. N'ajoute `--force` (perte de publications non postées) que s'il l'accepte clairement.
- Dossier non vide (409) : propose de déplacer ou de supprimer son contenu d'abord ; jamais de suppression en cascade.
- `archive` garde la fiche, les légendes, les dates et une miniature ≤ 2 Mo ; la vidéo et les slides sont perdues.
- **L'équipe, les clés API et les réglages** (dont le délai d'archivage, affiché par `depot me`) **ne se gèrent que dans l'app** :
  aucune commande ne les modifie. Si l'utilisateur le demande, renvoie-le vers l'app (Réglages).

## Règles d'écriture par plateforme

| Plateforme | Titre | Légende (max) | Conseils |
|---|---|---|---|
| YouTube | **≤ 100 car.**, obligatoire | 5000 | Mots-clés au début ; 3 hashtags utiles max |
| Instagram | non | 2200 | Hook en 1ʳᵉ ligne (≈ 125 car. visibles) ; 3 à 5 hashtags ciblés en fin |
| TikTok | non | 4000 | Court, accrocheur ; 3 à 5 hashtags |
| Facebook | non | 63206 | Texte aéré, 1 à 3 hashtags |
| LinkedIn | non | 3000 | Accroche en 2 lignes, paragraphes courts, 3 hashtags |
| X | non | 280 | 1 ou 2 hashtags au plus |
| Threads | non | 500 | Ton conversationnel, 1 hashtag |
| Pinterest | ≤ 100 car. | 500 | Mots-clés descriptifs |
| Snapchat | non | 250 | Très court |

- Titre seulement sur YouTube et Pinterest ; ailleurs, tout va dans `description`.
- Lis les `warnings` (longueur, date passée…) et corrige avec `depot schedule … --description-file`.
- Langue du projet, pas de hashtags hors sujet, pas d'emoji imposé.

## Précautions

- Confirmation explicite avant `delete`, `rm-file`, `folder rm`, `account rm`, `people rm` et `archive`.
- Archivage : quand un contenu est posté sur **tous** ses comptes, l'app retire ses fichiers du stockage après un délai
  (3 jours par défaut, réglable par le propriétaire). La fiche, les légendes et les dates restent ; `get` marque ces fichiers
  « retiré du stockage » et ils n'ont plus de lien. Pour garder les fichiers d'un contenu, c'est dans l'app (« Garder les fichiers »).
- Dates `AAAA-MM-JJ`, heures `HH:MM`, heure de Paris.
- Légendes longues ou avec guillemets : passe par `description_file` (fichier UTF-8 écrit avec Write) plutôt qu'en ligne de commande.
