import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dépôt contenu",
    short_name: "Dépôt",
    description: "Vidéos, carrousels, descriptions et planning de publication.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#4f46e5",
    lang: "fr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
