"use client";

import { Film, GalleryHorizontalEnd, Image as ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { forgetSignedUrl, useSignedUrl } from "@/lib/signed-urls";
import type { Asset, ContentFull } from "@/lib/types";
import { cn } from "./ui";

/** Image la plus représentative d'un contenu : miniature, sinon 1re slide. */
export function coverAsset(c: Pick<ContentFull, "assets">): Asset | undefined {
  const sorted = c.assets.filter((a) => !a.archived_at).sort((a, b) => a.position - b.position);
  return sorted.find((a) => a.kind === "thumbnail") ?? sorted.find((a) => a.kind === "photo");
}

export function firstVideo(c: Pick<ContentFull, "assets">): Asset | undefined {
  return c.assets
    .filter((a) => !a.archived_at)
    .sort((a, b) => a.position - b.position)
    .find((a) => a.kind === "video");
}

export function Thumb({
  content,
  className,
  color,
}: {
  content: ContentFull;
  className?: string;
  color?: string;
}) {
  const cover = coverAsset(content);
  const video = cover ? undefined : firstVideo(content);
  const ref = useRef<HTMLDivElement>(null);
  // une vidéo n'est demandée que lorsque la vignette arrive à l'écran (grilles de centaines de contenus)
  const [visible, setVisible] = useState(!video);
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      rootMargin: "200px",
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  const path = cover?.storage_path ?? (visible ? video?.storage_path : undefined);
  const url = useSignedUrl(path);
  const Icon = content.format === "carousel" ? GalleryHorizontalEnd : content.format === "photo" ? ImageIcon : Film;

  return (
    <div
      ref={ref}
      className={cn("relative overflow-hidden bg-surface-2", className)}
      style={!url && color ? { background: `color-mix(in srgb, ${color} 14%, var(--surface-2))` } : undefined}
    >
      {url && cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => path && forgetSignedUrl(path)}
        />
      )}
      {url && video && (
        <video
          src={`${url}#t=0.5`}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          onError={() => path && forgetSignedUrl(path)}
        />
      )}
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color }}>
          <Icon className="size-1/3 max-h-10 max-w-10 opacity-60" />
        </div>
      )}
    </div>
  );
}
