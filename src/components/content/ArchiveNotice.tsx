"use client";

import { Archive, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { filesToArchive, isFullyPosted, lastPostedAt } from "@/lib/archive-rules";
import { dateTimeLabel, formatBytes, longDate } from "@/lib/format";
import { todayISO } from "@/lib/status";
import type { ContentFull } from "@/lib/types";
import { useData } from "../data/DataProvider";
import { Button, cn } from "../ui";

const DAY = 24 * 3600 * 1000;

/**
 * Archivage après publication : annonce la suppression automatique des fichiers lourds une fois le contenu
 * posté partout, permet de la repousser (« Garder les fichiers ») ou de libérer l'espace tout de suite,
 * et liste les fichiers déjà retirés (historique).
 */
export function ArchiveNotice({ content }: { content: ContentFull }) {
  const { archiveAfterDays, updateContent, archiveNow } = useData();
  const [busy, setBusy] = useState(false);
  const posted = isFullyPosted(content.publications);
  const pending = filesToArchive(content.assets);
  const archived = content.assets.filter((a) => a.archived_at);
  const pendingSize = pending.reduce((n, a) => n + (a.size_bytes || 0), 0);
  const archivedSize = archived.reduce((n, a) => n + (a.size_bytes || 0), 0);

  if (!archived.length && !(posted && pending.length)) return null;

  const freeNow = async () => {
    const msg =
      `Retirer du stockage ${pending.length} fichier${pending.length > 1 ? "s" : ""} (${formatBytes(pendingSize)}) ?\n\n` +
      "Le titre, les légendes, les dates et les liens restent dans l'historique. Les fichiers, eux, ne pourront pas être récupérés.";
    if (!confirm(msg)) return;
    setBusy(true);
    await archiveNow(content.id);
    setBusy(false);
  };

  let planned: string | null = null;
  if (posted && pending.length && !content.keep_files && archiveAfterDays !== undefined && archiveAfterDays !== null) {
    const due = new Date(lastPostedAt(content.publications) + archiveAfterDays * DAY);
    const dueIso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
    planned = dueIso <= todayISO() ? "cette nuit" : `à partir du ${longDate(dueIso).toLowerCase()}`;
  }

  return (
    <div className="space-y-3">
      {posted && pending.length > 0 && (
        <div
          className={cn(
            "rounded-2xl border p-3 text-sm",
            content.keep_files ? "border-line bg-surface" : "border-warning/30 bg-warning-soft/60",
          )}
        >
          <p className="flex items-start gap-2 font-medium">
            {content.keep_files ? (
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <Archive className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <span>
              {content.keep_files
                ? "Fichiers conservés : pas de suppression automatique pour ce contenu."
                : archiveAfterDays === null
                  ? "Contenu posté partout. La suppression automatique des fichiers est désactivée (Réglages)."
                  : planned
                    ? `Contenu posté partout : ses fichiers (${formatBytes(pendingSize)}) seront retirés du stockage ${planned}.`
                    : `Contenu posté partout : ses fichiers (${formatBytes(pendingSize)}) seront bientôt retirés du stockage.`}
            </span>
          </p>
          <p className="mt-1 pl-6 text-xs text-muted">
            Le titre, les légendes, les dates et les liens restent dans l&apos;historique.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            <Button size="sm" onClick={() => updateContent(content.id, { keep_files: !content.keep_files })}>
              {content.keep_files ? "Réactiver la suppression automatique" : "Garder les fichiers"}
            </Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={freeNow}>
              Supprimer maintenant
            </Button>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
            <Archive className="size-4 shrink-0 text-muted" />
            {archived.length} fichier{archived.length > 1 ? "s" : ""} retiré{archived.length > 1 ? "s" : ""} du stockage
            après publication · {formatBytes(archivedSize)} libérés
          </summary>
          <ul className="mt-2 space-y-1 pl-6 text-xs text-muted">
            {archived.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span className="truncate">{a.file_name}</span>
                <span className="shrink-0">
                  {formatBytes(a.size_bytes)} · {a.archived_at ? dateTimeLabel(a.archived_at) : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
