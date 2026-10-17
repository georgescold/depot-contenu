export type Platform =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "linkedin"
  | "x"
  | "threads"
  | "pinterest"
  | "snapchat"
  | "other";

export type Format = "video" | "short" | "carousel" | "photo" | "story" | "other";

export type AssetKind = "video" | "thumbnail" | "photo" | "other";

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  color: string;
  description: string;
  position: number;
  created_at: string;
}

export interface Account {
  id: string;
  folder_id: string;
  platform: Platform;
  handle: string;
  url: string;
  position: number;
  created_at: string;
}

export interface Content {
  id: string;
  folder_id: string;
  title: string;
  format: Format;
  notes: string;
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
  created_at: string;
}

export type ContentFull = Content & {
  publications: Publication[];
  assets: Asset[];
};
