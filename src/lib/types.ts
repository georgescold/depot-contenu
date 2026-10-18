export type Platform =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "x"
  | "threads"
  | "pinterest"
  | "snapchat"
  | "other";

export type Format = "video" | "short" | "carousel" | "photo" | "story" | "other";

export type AssetKind = "video" | "thumbnail" | "photo" | "other";

export interface Person {
  id: string;
  name: string;
  color: string;
  position: number;
  created_at: string;
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  color: string;
  description: string;
  position: number;
  /** personne responsable par défaut des contenus du dossier */
  assignee_id: string | null;
  created_at: string;
}

export interface Account {
  id: string;
  folder_id: string;
  platform: Platform;
  handle: string;
  url: string;
  position: number;
  /** personne qui poste sur ce compte (par défaut) */
  assignee_id: string | null;
  created_at: string;
}

export interface Content {
  id: string;
  folder_id: string;
  title: string;
  format: Format;
  notes: string;
  /** personne qui doit poster ce contenu (sinon : celle du compte, puis du dossier) */
  assignee_id: string | null;
  /** protège les fichiers de l'archivage automatique */
  keep_files: boolean;
  /** dernière fois que des fichiers ont été retirés du stockage après publication */
  files_archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Publication {
  id: string;
  content_id: string;
  account_id: string;
  /** YYYY-MM-DD, heure de Paris implicite */
  scheduled_date: string | null;
  /** HH:MM:SS */
  scheduled_time: string | null;
  title: string;
  description: string;
  posted: boolean;
  posted_at: string | null;
  post_url: string;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  content_id: string;
  kind: AssetKind;
  position: number;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** fichier retiré du stockage après publication (la ligne reste pour l'historique) */
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface TeamMember {
  user_id: string;
  email: string;
  role: "owner" | "member";
  created_at: string;
}

export type ContentFull = Content & {
  publications: Publication[];
  assets: Asset[];
};
