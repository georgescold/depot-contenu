"use client";

import { Archive, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  ONLINE_CHECK_PLATFORMS,
  archiveDelayStart,
  filesToArchive,
  isConfirmedOnline,
  isFullyPosted,
  type ArchiveRulePublication,
} from "@/lib/archive-rules";
import { dateTimeLabel, formatBytes, longDate } from "@/lib/format";
import { todayISO } from "@/lib/status";
import { supabase } from "@/lib/supabase/browser";
import type { ContentFull } from "@/lib/types";
import { useData } from "../data/DataProvider";
import { Button, cn } from "../ui";

const DAY = 24 * 3600 * 1000;

/**
 * Archivage après publication : annonce la suppression automatique des fichiers lourds une fois le contenu
 * posté partout (dès que la collecte retrouve ses posts en ligne, sinon après le délai réglé), permet de la
 * repousser (« Garder les fichiers ») ou de libérer l'espace tout de suite, et liste les fichiers déjà retirés.
 */
export function ArchiveNotice({ content }: { content: ContentFull }) {
  const { archiveAfterDays, updateContent, archiveNow, accountById } = useData();
  const [busy, setBusy] = useState(false);
  const posted = isFullyPosted(content.publications);
  const pending = filesToArchive(content.assets);
  const waiting = posted && pending.length > 0;

  // posts retrouvés en ligne par la collecte de la nuit (publication → date de parution)
  const pubIds = content.publications.map((p) => p.id).join(",");
  const [online, setOnline] = useState<{ ids: string; found: Map<string, string | null> } | null>(null);
  useEffect(() => {
    if (!waiting || !pubIds) return;
    let alive = true;
    supabase()
      .from("post_stats")
      .select("publication_id, published_at")
      .in("publication_id", pubIds.split(","))
      .then(({ data }) => {
        if (!alive) return;
        setOnline({ ids: pubIds, found: new Map((data ?? []).map((r) => [r.publication_id as string, r.published_at as string | null])) });
      });
    return () => {
      alive = false;
    };
  }, [waiting, pubIds]);
  const found = online?.ids === pubIds ? online.found : null;
  const rulePubs: ArchiveRulePublication[] = content.publications.map((p) => ({
    posted: p.posted,
    posted_at: p.posted_at,
    platform: accountById.get(p.account_id)?.platform ?? "",
    online: found?.has(p.id) ? { published_at: found.get(p.id) ?? null } : null,
  }));
  const tracked = rulePubs.filter((p) => ONLINE_CHECK_PLATFORMS.includes(p.platform));
  const confirmed = !!found && isConfirmedOnline(content.created_at, rulePubs);
  const allFound = !!found && tracked.length > 0 && tracked.every((p) => p.online);
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

  // échéance du délai réglé : « cette nuit » ou une date
  let due: { tonight: boolean; date: string } | null = null;
  if (waiting && !content.keep_files && archiveAfterDays !== undefined && archiveAfterDays !== null) {
    const d = new Date(archiveDelayStart(content.created_at, content.publications) + archiveAfterDays * DAY);
    const dueIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    due = { tonight: dueIso <= todayISO(), date: longDate(dueIso).toLowerCase() };
  }
  const size = formatBytes(pendingSize);
  let planned: string;
  if (confirmed) planned = `Posts retrouvés en ligne : ses fichiers (${size}) sont retirés du stockage cette nuit.`;
  else if (!due) planned = `Contenu posté partout : ses fichiers (${size}) seront bientôt retirés du stockage.`;
  else if (allFound)
    planned = `Contenu déjà en ligne quand il a été ajouté ici : ses fichiers (${size}) seront retirés du stockage ${due.tonight ? "cette nuit" : `à partir du ${due.date}`}.`;
  else if (tracked.length)
    planned = `Contenu posté partout : ses fichiers (${size}) seront retirés du stockage dès que la collecte de la nuit retrouvera ses posts en ligne, au plus tard ${due.tonight ? "cette nuit" : `le ${due.date}`}.`;
  else planned = `Contenu posté partout : ses fichiers (${size}) seront retirés du stockage ${due.tonight ? "cette nuit" : `à partir du ${due.date}`}.`;

  return (
    <div className="space-y-3">
      {waiting && (
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
                  : planned}
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
