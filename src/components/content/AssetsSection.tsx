"use client";

import { ArrowLeft, ArrowRight, Download, ExternalLink, FileText, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { ASSET_KINDS } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { getDownloadUrl, useSignedUrl } from "@/lib/signed-urls";
import type { Asset, AssetKind, ContentFull } from "@/lib/types";
import { useData } from "../data/DataProvider";
import { useToast } from "../Toast";
import { Button, cn, IconButton } from "../ui";
import { useUploads } from "../upload/UploadProvider";

export async function downloadAsset(a: Asset) {
  const url = await getDownloadUrl(a.storage_path, a.file_name);
  if (url) window.location.assign(url);
}

const HINTS: Record<AssetKind, string> = {
  video: "Dépose la vidéo ici, ou touche pour la choisir",
  thumbnail: "Dépose la miniature (image de couverture)",
  photo: "Dépose les images du carrousel (dans l'ordre)",
  other: "Sous-titres, musique, fichier projet…",
};

export function AssetsSection({ content, kind }: { content: ContentFull; kind: AssetKind }) {
  const { upload } = useUploads();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const assets = content.assets.filter((a) => a.kind === kind).sort((a, b) => a.position - b.position);

  const pick = () => inputRef.current?.click();
  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    upload(content.id, Array.from(files), kind);
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      onFiles(e.dataTransfer.files);
    },
  };

  return (
    <section {...dropProps} className={cn("rounded-2xl transition", over && "ring-2 ring-accent ring-offset-4 ring-offset-bg")}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ASSET_KINDS[kind].accept || undefined}
        multiple
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {ASSET_KINDS[kind].label}
          {assets.length > 0 && <span className="ml-1.5 font-normal text-muted">· {assets.length}</span>}
        </h3>
        {assets.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={pick}>
            Ajouter
          </Button>
        )}
      </div>

      {assets.length === 0 ? (
        <button
          type="button"
          onClick={pick}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface px-4 text-sm text-muted transition hover:border-accent hover:text-accent",
            kind === "other" ? "py-4" : "py-8",
          )}
        >
          <Upload className="size-5" />
          {HINTS[kind]}
        </button>
      ) : kind === "video" ? (
        <div className="space-y-3">
          {assets.map((a) => (
            <VideoItem key={a.id} asset={a} />
          ))}
        </div>
      ) : kind === "thumbnail" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map((a) => (
            <ImageItem key={a.id} asset={a} />
          ))}
        </div>
      ) : kind === "photo" ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {assets.map((a, i) => (
            <ImageItem key={a.id} asset={a} order={i + 1} siblings={assets} />
          ))}
          <button
            type="button"
            onClick={pick}
            className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-xs text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="size-5" />
            Ajouter
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {assets.map((a) => (
            <FileRow key={a.id} asset={a} icon={<FileText className="size-4" />} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetActions({ asset, children }: { asset: Asset; children?: ReactNode }) {
  const { deleteAsset } = useData();
  const toast = useToast();
  return (
    <div className="flex items-center gap-0.5">
      {children}
      <IconButton
        label="Télécharger"
        onClick={async () => {
          toast("Téléchargement…");
          await downloadAsset(asset);
        }}
      >
        <Download className="size-4" />
      </IconButton>
      <IconButton
        label="Supprimer"
        onClick={() => confirm(`Supprimer « ${asset.file_name} » ?`) && deleteAsset(asset)}
        className="hover:text-danger"
      >
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}

function VideoItem({ asset }: { asset: Asset }) {
  const url = useSignedUrl(asset.storage_path);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex max-h-[70vh] justify-center bg-black">
        {url ? (
          <video src={url} controls playsInline preload="metadata" className="max-h-[70vh] w-auto max-w-full" />
        ) : (
          <div className="aspect-video w-full" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{asset.file_name}</p>
          <p className="text-xs text-muted">{formatBytes(asset.size_bytes)}</p>
        </div>
        <AssetActions asset={asset} />
      </div>
    </div>
  );
}

function ImageItem({ asset, order, siblings }: { asset: Asset; order?: number; siblings?: Asset[] }) {
  const { reorderAssets } = useData();
  const url = useSignedUrl(asset.storage_path);
  const move = (dir: -1 | 1) => {
    if (!siblings || order === undefined) return;
    const ids = siblings.map((s) => s.id);
    const i = order - 1;
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorderAssets(asset.content_id, ids);
  };
  return (
    <div className="group overflow-hidden rounded-xl border border-line bg-surface">
      <a
        href={url ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={cn("relative block bg-surface-2", order ? "aspect-[4/5]" : "aspect-video")}
      >
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={asset.file_name} loading="lazy" className="absolute inset-0 size-full object-cover" />
        )}
        {order !== undefined && (
          <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-black/60 text-xs font-semibold text-white">
            {order}
          </span>
        )}
      </a>
      <div className="flex items-center justify-between px-0.5 py-0.5">
        {order !== undefined && siblings && siblings.length > 1 ? (
          <div className="flex">
            <IconButton label="Avancer" className="size-8" disabled={order === 1} onClick={() => move(-1)}>
              <ArrowLeft className="size-3.5" />
            </IconButton>
            <IconButton label="Reculer" className="size-8" disabled={order === siblings.length} onClick={() => move(1)}>
              <ArrowRight className="size-3.5" />
            </IconButton>
          </div>
        ) : (
          <span className="truncate px-2 text-xs text-muted">{formatBytes(asset.size_bytes)}</span>
        )}
        <AssetActions asset={asset} />
      </div>
    </div>
  );
}

function FileRow({ asset, icon }: { asset: Asset; icon: ReactNode }) {
  const url = useSignedUrl(asset.storage_path);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2 pl-3">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.file_name}</p>
        <p className="text-xs text-muted">{formatBytes(asset.size_bytes)}</p>
      </div>
      <AssetActions asset={asset}>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" aria-label="Ouvrir" className="inline-flex size-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink">
            <ExternalLink className="size-4" />
          </a>
        )}
      </AssetActions>
    </li>
  );
}
