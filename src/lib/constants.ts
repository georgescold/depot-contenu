import type { AssetKind, Format, Platform } from "./types";

export interface PlatformInfo {
  label: string;
  /** Abréviation affichée dans le badge */
  short: string;
  color: string;
  /** Couleur du texte sur le badge */
  ink: string;
  /** La plateforme a un champ « titre » distinct de la description */
  hasTitle: boolean;
  /** Longueur max de la description (indicatif) */
  limit: number;
}

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  youtube: { label: "YouTube", short: "YT", color: "#ff0033", ink: "#fff", hasTitle: true, limit: 5000 },
  instagram: { label: "Instagram", short: "IG", color: "#d62976", ink: "#fff", hasTitle: false, limit: 2200 },
  tiktok: { label: "TikTok", short: "TT", color: "#000000", ink: "#fff", hasTitle: false, limit: 4000 },
  facebook: { label: "Facebook", short: "FB", color: "#1877f2", ink: "#fff", hasTitle: false, limit: 63206 },
  linkedin: { label: "LinkedIn", short: "IN", color: "#0a66c2", ink: "#fff", hasTitle: false, limit: 3000 },
  x: { label: "X", short: "X", color: "#0f1419", ink: "#fff", hasTitle: false, limit: 280 },
  threads: { label: "Threads", short: "TH", color: "#101010", ink: "#fff", hasTitle: false, limit: 500 },
  pinterest: { label: "Pinterest", short: "PI", color: "#e60023", ink: "#fff", hasTitle: true, limit: 500 },
  snapchat: { label: "Snapchat", short: "SC", color: "#fffc00", ink: "#111", hasTitle: false, limit: 250 },
  other: { label: "Autre", short: "•", color: "#64748b", ink: "#fff", hasTitle: true, limit: 10000 },
};

export const PLATFORM_LIST = Object.keys(PLATFORMS) as Platform[];

export const FORMATS: Record<Format, { label: string; hint: string }> = {
  video: { label: "Vidéo", hint: "Vidéo longue (YouTube…)" },
  short: { label: "Short / Reel", hint: "Vidéo verticale courte" },
  carousel: { label: "Carrousel", hint: "Plusieurs images à la suite" },
  photo: { label: "Photo", hint: "Une image" },
  story: { label: "Story", hint: "Story éphémère" },
  other: { label: "Autre", hint: "" },
};

export const FORMAT_LIST = Object.keys(FORMATS) as Format[];

export const ASSET_KINDS: Record<AssetKind, { label: string; accept: string }> = {
  video: { label: "Vidéo", accept: "video/*" },
  thumbnail: { label: "Miniature", accept: "image/*" },
  photo: { label: "Photos / slides", accept: "image/*" },
  other: { label: "Autres fichiers", accept: "" },
};

export const ASSET_KIND_LIST = Object.keys(ASSET_KINDS) as AssetKind[];

/** Palette proposée pour les dossiers */
export const FOLDER_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#0ea5e9",
  "#64748b",
];

/** Taille max par fichier : 4 Go (un envoi direct B2 en une fois est plafonné à 5 Go). */
export const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 4096);

/** Au-delà, l'envoi se fait en plusieurs parties (reprise en cas de coupure, plus rapide). */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

/** Espace gratuit chez Backblaze B2. */
export const FREE_STORAGE_GB = 10;
