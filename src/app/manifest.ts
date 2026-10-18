import type { MetadataRoute } from "next";

/** Manifeste de l'app installable (écran d'accueil du téléphone, app de bureau Chrome / Edge). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dépôt contenu",
    short_name: "Dépôt",
    description: "Vidéos, carrousels, descriptions et planning de publication.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#4f46e5",
    lang: "fr",
    dir: "ltr",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // appui long sur l'icône de l'app
    shortcuts: [
      { name: "Planning", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Contenus", url: "/contenus", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Statistiques", url: "/statistiques", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
