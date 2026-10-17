"use client";

import { Download, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { getDownloadUrl, getSignedUrl } from "@/lib/signed-urls";
import type { Asset } from "@/lib/types";
import { useToast } from "../Toast";
import { Button, IconButton, Modal } from "../ui";

const ORDER = { video: 0, photo: 1, thumbnail: 2, other: 3 } as const;

/** Au-delà, on évite de charger les fichiers en mémoire du téléphone (Safari peut fermer la page). */
const SHARE_MAX_BYTES = 450 * 1024 * 1024;

function supportsFileShare() {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;
  } catch {
    return false;
  }
}

const isMobile = () => typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);

/** Téléphone capable de partager des fichiers (faux côté serveur, pour un rendu identique à l'hydratation). */
const noopSubscribe = () => () => {};
function useMobileShare() {
  return useSyncExternalStore(noopSubscribe, () => isMobile() && supportsFileShare(), () => false);
}

/** Téléchargements successifs (ordinateur, ou repli). */
async function downloadAll(list: Asset[]) {
  let ok = 0;
  for (const a of list) {
    const url = await getDownloadUrl(a.storage_path, a.file_name);
    if (!url) continue;
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    ok++;
    await new Promise((r) => setTimeout(r, 700));
  }
  return ok;
}

/**
 * Récupérer des fichiers sur l'appareil :
 * - sur téléphone : prépare les fichiers puis ouvre la feuille de partage (Enregistrer dans Photos, Instagram, TikTok…) ;
 * - sur ordinateur : télécharge chaque fichier.
 * `variant="icon"` : petit bouton pour un seul fichier.
 */
export function SaveToDevice({ assets, variant = "button" }: { assets: Asset[]; variant?: "button" | "icon" }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState<File[] | null>(null);
  const mobileShareUi = useMobileShare();
  const sorted = [...assets].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.position - b.position);

  if (!sorted.length) return null;

  const start = async () => {
    if (busy) return;
    const mobileShare = isMobile() && supportsFileShare();
    // la feuille de partage des photos/vidéos ne sait pas quoi faire d'un .srt ou d'un .zip
    const shareable = sorted.filter((a) => a.kind !== "other");
    const total = shareable.reduce((n, a) => n + (a.size_bytes || 0), 0);

    if (!mobileShare || !shareable.length || total > SHARE_MAX_BYTES) {
      if (mobileShare && total > SHARE_MAX_BYTES) {
        toast("Fichiers lourds : ils vont dans l'app Fichiers. Pour la pellicule, partage-les un par un.", "info");
      }
      setBusy(true);
      const n = await downloadAll(sorted);
      setBusy(false);
      if (!n) toast("Téléchargement impossible, réessaie.", "error");
      else if (!mobileShare) toast(`${n} fichier${n > 1 ? "s" : ""} téléchargé${n > 1 ? "s" : ""}`, "success");
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      const files: File[] = [];
      for (let i = 0; i < shareable.length; i++) {
        const a = shareable[i];
        const url = await getSignedUrl(a.storage_path);
        if (!url) throw new Error("lien indisponible");
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        files.push(new File([blob], a.file_name, { type: a.mime_type || blob.type }));
        setProgress((i + 1) / shareable.length);
      }
      if (!navigator.canShare({ files })) {
        await downloadAll(shareable);
        return;
      }
      setReady(files);
    } catch (e) {
      console.error(e);
      toast("Préparation impossible : télécharge les fichiers un par un.", "error");
    } finally {
      setBusy(false);
    }
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

  const label =
    variant === "icon"
      ? mobileShareUi
        ? "Enregistrer / partager"
        : "Télécharger"
      : busy && progress > 0
        ? `${Math.round(progress * 100)} %`
        : "Tout récupérer";

  return (
    <>
      {variant === "icon" ? (
        <IconButton label={label} onClick={start} disabled={busy}>
          {mobileShareUi ? <Share2 className="size-4" /> : <Download className="size-4" />}
        </IconButton>
      ) : (
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          loading={busy}
          onClick={start}
          title="Récupérer tous les fichiers sur cet appareil"
        >
          {label}
        </Button>
      )}
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
          « Enregistrer » pour les mettre dans ta pellicule, ou envoie-les directement dans l&apos;app de ton choix.
        </p>
      </Modal>
    </>
  );
}
