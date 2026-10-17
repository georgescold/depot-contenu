"use client";

import { Library, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PageBody, PageHeader, Splash, useShell } from "@/components/AppShell";
import { ContentCard, nextPublication } from "@/components/ContentCard";
import { useData } from "@/components/data/DataProvider";
import { FolderPicker } from "@/components/FolderPicker";
import { Button, Chip, EmptyState, Input, Select } from "@/components/ui";
import { FORMAT_LIST, FORMATS } from "@/lib/constants";
import { descendantIds, folderPath } from "@/lib/folders";
import { contentStatus, STATUS_INFO, type ContentStatus } from "@/lib/status";
import { useLocalState } from "@/lib/use-local-state";
import type { Format } from "@/lib/types";

const STATUSES: ContentStatus[] = ["draft", "scheduled", "late", "partial", "posted"];

export default function ContentsPage() {
  const { contents, index, ready } = useData();
  const { openNewContent } = useShell();
  const [q, setQ] = useState("");
  const [folderId, setFolderId] = useLocalState("contents.folder", "");
  const [format, setFormat] = useLocalState<Format | "">("contents.format", "");
  // ?statut=draft depuis le planning (écran rendu uniquement côté navigateur)
  const [status, setStatus] = useState<ContentStatus | "">(() => {
    const s = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("statut");
    return s && (STATUSES as string[]).includes(s) ? (s as ContentStatus) : "";
  });
  const [sort, setSort] = useLocalState<"recent" | "date">("contents.sort", "recent");

  const scope = useMemo(
    () => (folderId && index.byId.has(folderId) ? descendantIds(index, folderId) : null),
    [folderId, index],
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = contents.filter((c) => {
      if (scope && !scope.has(c.folder_id)) return false;
      if (format && c.format !== format) return false;
      if (status && contentStatus(c.publications) !== status) return false;
      if (needle) {
        const hay = `${c.title} ${c.notes} ${folderPath(index, c.folder_id)} ${c.publications.map((p) => p.description).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "date") {
      const key = (c: (typeof rows)[number]) => {
        const n = nextPublication(c);
        return n ? `${n.scheduled_date}${n.scheduled_time ?? ""}` : "9999";
      };
      rows.sort((a, b) => key(a).localeCompare(key(b)));
    }
    return rows;
  }, [contents, scope, format, status, q, sort, index]);

  const counts = useMemo(() => {
    const m = new Map<ContentStatus, number>();
    for (const c of contents) {
      if (scope && !scope.has(c.folder_id)) continue;
      const s = contentStatus(c.publications);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [contents, scope]);

  if (!ready) return <Splash />;

  return (
    <>
      <PageHeader
        title="Contenus"
        subtitle={`${list.length} sur ${contents.length}`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openNewContent(folderId || null)}>
            <span className="hidden sm:inline">Nouveau contenu</span>
            <span className="sm:hidden">Nouveau</span>
          </Button>
        }
      >
        <div className="space-y-2">
          <div className="relative md:hidden">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un titre, une légende…" className="h-10 pl-9" />
          </div>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            <div className="relative hidden min-w-0 flex-1 basis-48 md:block">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un titre, une légende…" className="h-9 pl-9" />
            </div>
            <FolderPicker
              allowEmpty
              value={folderId && index.byId.has(folderId) ? folderId : ""}
              onChange={setFolderId}
              className="h-9 w-auto max-w-56 shrink-0 md:max-w-xs"
            />
            <Select value={format} onChange={(e) => setFormat(e.target.value as Format | "")} className="h-9 w-auto shrink-0">
              <option value="">Tous formats</option>
              {FORMAT_LIST.map((f) => (
                <option key={f} value={f}>
                  {FORMATS[f].label}
                </option>
              ))}
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "date")} className="h-9 w-auto shrink-0">
              <option value="recent">Plus récents</option>
              <option value="date">Prochaine date</option>
            </Select>
          </div>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
            <Chip active={!status} onClick={() => setStatus("")}>
              Tous
            </Chip>
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(status === s ? "" : s)}>
                {STATUS_INFO[s].label}
                <span className="text-xs opacity-70 tabular-nums">{counts.get(s) ?? 0}</span>
              </Chip>
            ))}
          </div>
        </div>
      </PageHeader>

      <PageBody>
        {list.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {list.map((c) => (
              <ContentCard key={c.id} content={c} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Library className="size-8" />}
            title={contents.length ? "Aucun contenu ne correspond" : "Aucun contenu pour l'instant"}
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openNewContent(folderId || null)}>
                Ajouter un contenu
              </Button>
            }
          >
            {contents.length ? "Change les filtres ou la recherche." : "Commence par déposer une vidéo ou un carrousel."}
          </EmptyState>
        )}
      </PageBody>
    </>
  );
}
