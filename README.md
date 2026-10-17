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
| **Réglages** | Mot de passe, équipe (ajouter / retirer des membres), clés API, espace de stockage utilisé. |

Installable sur l'écran d'accueil du téléphone (Safari → Partager → « Sur l'écran d'accueil »).

## Envoyer du contenu depuis un autre dossier (Claude Code / API)

1. Dans l'app : **Réglages → Clés API → Nouvelle clé**, copie la commande affichée.
2. Installe le skill une fois : `node scripts/install-skill.mjs`, puis colle la commande `... depot.mjs config --url ... --key ...`.
3. Dans n'importe quel dossier, demande à Claude par exemple : « envoie ce carrousel dans le dépôt, projet Compaatible › Angle jalousie, Instagram demain 18h ».

Référence complète de l'API REST et du format de manifest : [docs/API.md](docs/API.md).

## Stack

- **Next.js 16** (App Router) déployé sur **Vercel**.
- **Supabase** : Postgres (tables + RLS : seuls les membres de l'équipe ont accès), Auth (e-mail + mot de passe,
  inscriptions publiques désactivées), Storage (bucket privé `media`, envoi « resumable » pour les gros fichiers).
- Schéma complet et relançable : [`supabase/schema.sql`](supabase/schema.sql).

## Développement

```bash
npm install
cp .env.example .env.local   # puis remplis les 3 variables
npm run dev
```

Variables d'environnement :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique (publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé secrète, uniquement côté serveur (API par clé, gestion de l'équipe) |
| `NEXT_PUBLIC_MAX_FILE_MB` | facultatif, taille max par fichier (50 par défaut = plan gratuit Supabase) |

Au premier lancement, la page de connexion propose de créer le compte principal (tant que l'équipe est vide).

## Limites du plan gratuit Supabase

1 Go de stockage au total et 50 Mo par fichier. Pour des vidéos longues, passe l'organisation Supabase en plan Pro
(100 Go, fichiers de plusieurs Go), puis augmente la limite dans Storage → Settings et `NEXT_PUBLIC_MAX_FILE_MB`.
