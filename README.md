# Dépôt contenu

Le drive + CRM de tes contenus réseaux sociaux : tu y déposes les vidéos, carrousels, miniatures et descriptions
que tu prévois de poster, tu les ranges par **projet › sous-projet › angle**, tu les programmes dans un
**calendrier** (par jour et par compte) et tu coches **« posté »**. Pensé d'abord pour le téléphone.

## Ce que fait l'app

| Écran | À quoi ça sert |
| --- | --- |
| **Planning** | Agenda (en retard, aujourd'hui, demain, les jours suivants) ou vue Mois. Filtre par projet et par compte, case « posté » directement dans la liste, glisser-déposer pour décaler un post (ordinateur). |
| **Projets** | Arborescence libre : projet (ex. Compaatible) › sous-projets › angles… Chaque dossier a ses comptes de publication (Instagram, TikTok, YouTube…), hérités par ses sous-dossiers. |
| **Contenus** | Tous les contenus avec recherche (titre, légendes, notes) et filtres par projet, format et statut (À planifier, Programmé, En retard, En cours, Posté). |
| **Fiche contenu** | Fichiers (vidéo, miniature, slides du carrousel dans l'ordre, autres), puis une carte par compte : date + heure, titre (YouTube), légende avec compteur de caractères, bouton **Copier le texte**, case **Posté**, lien du post. **Tout récupérer** envoie les fichiers dans la pellicule du téléphone (feuille de partage) ou les télécharge sur ordinateur. |
| **Réglages** | Mot de passe, équipe (le propriétaire — premier compte créé — ajoute ou retire les membres ; retirer un membre révoque ses clés API), clés API, espace de stockage utilisé. |

Installable sur l'écran d'accueil du téléphone (Safari → Partager → « Sur l'écran d'accueil »).

## Envoyer du contenu depuis un autre dossier (Claude Code / API)

1. Dans l'app : **Réglages → Clés API → Nouvelle clé**, copie la commande affichée.
2. Installe le skill une fois : `node scripts/install-skill.mjs`, puis colle la commande `... depot.mjs config --url ... --key ...`.
3. Dans n'importe quel dossier, demande à Claude par exemple : « envoie ce carrousel dans le dépôt, projet Compaatible › Angle jalousie, Instagram demain 18h ».

Référence complète de l'API REST et du format de manifest : [docs/API.md](docs/API.md).

## Stack

- **Next.js 16** (App Router) déployé sur **Vercel**.
- **Supabase** : Postgres (tables + RLS : seuls les membres de l'équipe ont accès) et Auth (e-mail + mot de passe,
  inscriptions publiques désactivées).
- **Backblaze B2** (API S3) pour les fichiers : bucket privé, envoi direct depuis le navigateur ou le CLI via des URLs
  pré-signées (rien ne transite par Vercel), envoi en plusieurs parties au-delà de 100 Mo, fichiers supprimés purgés
  après 1 jour par une règle de cycle de vie. Un cron Vercel quotidien (`/api/cron/cleanup`) supprime les fichiers
  envoyés mais jamais rattachés à une fiche depuis plus de 24 h (envoi interrompu, onglet fermé…).
- Robustesse : écritures ordonnées par élément, retour arrière et message en cas d'échec, bandeau hors connexion,
  suppressions « base d'abord puis stockage », taille réelle des fichiers vérifiée côté serveur.
- Schéma complet et relançable : [`supabase/schema.sql`](supabase/schema.sql).

## Développement

```bash
npm install
cp .env.example .env.local   # puis remplis les variables
npm run dev
```

Variables d'environnement :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique (publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé secrète, uniquement côté serveur (API par clé, gestion de l'équipe) |
| `B2_KEY_ID`, `B2_APPLICATION_KEY` | clé Backblaze limitée au bucket (serveur uniquement) |
| `B2_BUCKET`, `B2_REGION`, `B2_ENDPOINT` | bucket B2 et point d'accès S3 (ex. `https://s3.us-east-005.backblazeb2.com`) |
| `CRON_SECRET` | secret du nettoyage quotidien (Vercel l'envoie automatiquement au cron) |
| `NEXT_PUBLIC_MAX_FILE_MB` | facultatif, taille max par fichier (4096 par défaut) |

Au premier lancement, la page de connexion propose de créer le compte principal (propriétaire). Cette étape n'est
disponible qu'une seule fois dans la vie du projet.

## Stockage

Backblaze B2 : 10 Go gratuits, puis environ 0,007 $ par Go et par mois ; téléchargements gratuits jusqu'à 3 fois
le volume stocké chaque mois. Jusqu'à 4 Go par fichier.

Le bucket doit autoriser l'origine de l'app en CORS (opérations `s3_get`, `s3_head`, `s3_put`, en-tête exposé
`ETag`) et garder une règle de cycle de vie qui purge les versions masquées et les envois inachevés après 1 jour.
