"use client";

import { Download, Share2 } from "lucide-react";
import { useState } from "react";
import { getDownloadUrl, getSignedUrl } from "@/lib/signed-urls";
import type { Asset } from "@/lib/types";
import { useToast } from "../Toast";
import { Button, Modal } from "../ui";

const ORDER = { video: 0, photo: 1, thumbnail: 2, other: 3 } as const;

function canShareFiles() {
  try {
    if (typeof navigator === "undefined" || !navigator.canShare) return false;
    const probe = new File(["x"], "x.txt", { type: "text/plain" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

const isMobile = () => typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);

/**
 * « Tout récupérer » :
 * - sur téléphone : prépare les fichiers puis ouvre la feuille de partage (Enregistrer dans Photos, Instagram, TikTok…)
 * - sur ordinateur : télécharge chaque fichier.
 */
export function SaveToDevice({ assets }: { assets: Asset[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState<File[] | null>(null);
  const sorted = [...assets].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.position - b.position);

  if (!sorted.length) return null;

  const start = async () => {
    if (isMobile() && canShareFiles()) {
      setBusy(true);
      setProgress(0);
      try {
        const files: File[] = [];
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          const url = await getSignedUrl(a.storage_path);
          if (!url) throw new Error("lien indisponible");
          const blob = await fetch(url).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.blob();
          });
          files.push(new File([blob], a.file_name, { type: a.mime_type || blob.type }));
          setProgress((i + 1) / sorted.length);
        }
        setReady(files);
      } catch (e) {
        console.error(e);
        toast("Préparation impossible, télécharge les fichiers un par un.", "error");
      } finally {
        setBusy(false);
      }
      return;
    }
    // ordinateur : téléchargements successifs
    setBusy(true);
    for (const a of sorted) {
      const url = await getDownloadUrl(a.storage_path, a.file_name);
      if (!url) continue;
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      await new Promise((r) => setTimeout(r, 600));
    }
    setBusy(false);
    toast(`${sorted.length} fichier${sorted.length > 1 ? "s" : ""} téléchargé${sorted.length > 1 ? "s" : ""}`, "success");
  };

  const share = async () => {
    if (!ready) return;
    try {
      await navigator.share({ files: ready });
      setReady(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast("Partage impossible", "error");
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        icon={<Download className="size-4" />}
        loading={busy}
        onClick={start}
        title="Récupérer tous les fichiers sur cet appareil"
      >
        {busy && progress > 0 ? `${Math.round(progress * 100)} %` : "Tout récupérer"}
      </Button>
      <Modal
        open={!!ready}
        onClose={() => setReady(null)}
        title="Fichiers prêts"
        footer={
          <Button variant="primary" size="lg" className="w-full" icon={<Share2 className="size-5" />} onClick={share}>
            Enregistrer / Partager
          </Button>
        }
      >
        <p className="text-sm text-muted">
          {ready?.length} fichier{(ready?.length ?? 0) > 1 ? "s" : ""} prêt{(ready?.length ?? 0) > 1 ? "s" : ""}. Choisis
          « Enregistrer les vidéos / images » pour les mettre dans ta pellicule, ou envoie-les directement dans l&apos;app.
        </p>
      </Modal>
    </>
  );
}
