"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ancestorsOf, childrenOf } from "@/lib/folders";
import { contentStatus } from "@/lib/status";
import { useLocalState } from "@/lib/use-local-state";
import type { Folder } from "@/lib/types";
import { useData } from "./data/DataProvider";
import { cn, ColorDot } from "./ui";

export interface FolderCounts {
  total: number;
  pending: number;
}

/** Nombre de contenus par dossier, sous-dossiers inclus. */
export function useFolderCounts(): Map<string, FolderCounts> {
  const { contents, index } = useData();
  return useMemo(() => {
    const map = new Map<string, FolderCounts>();
    for (const c of contents) {
      const pending = contentStatus(c.publications) !== "posted";
      for (const f of ancestorsOf(index, c.folder_id)) {
        const cur = map.get(f.id) ?? { total: 0, pending: 0 };
        cur.total += 1;
        if (pending) cur.pending += 1;
        map.set(f.id, cur);
      }
    }
    return map;
  }, [contents, index]);
}

export function FolderTreeNav({ compact, rootId }: { compact?: boolean; rootId?: string | null }) {
  const { index, ready } = useData();
  const pathname = usePathname();
  const counts = useFolderCounts();
  const [expanded, setExpanded] = useLocalState<string[]>("tree.expanded", []);

  const activeId = pathname.startsWith("/projets/") ? pathname.split("/")[2] : null;
  const activeChain = useMemo(() => new Set(ancestorsOf(index, activeId).map((f) => f.id)), [index, activeId]);
  const open = useMemo(() => new Set([...expanded, ...activeChain]), [expanded, activeChain]);

  const toggle = (id: string) =>
    setExpanded((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const roots = childrenOf(index, rootId ?? null);
  if (!ready) return null;
  if (!roots.length) {
    return compact ? (
      <Link href="/projets" className="block px-3 py-1 text-sm text-muted hover:text-ink">
        Créer un premier projet →
      </Link>
    ) : null;
  }

  const renderNode = (f: Folder, depth: number) => {
    const kids = childrenOf(index, f.id);
    const isOpen = open.has(f.id);
    const c = counts.get(f.id);
    return (
      <li key={f.id}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-lg pr-2 transition",
            compact ? "h-8 text-[13px]" : "h-11 text-[15px]",
            activeId === f.id ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
          )}
          style={{ paddingLeft: depth * (compact ? 14 : 18) + 4 }}
        >
          <button
            type="button"
            aria-label={isOpen ? "Replier" : "Déplier"}
            onClick={() => kids.length && toggle(f.id)}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded text-muted",
              !kids.length && "invisible",
            )}
          >
            <ChevronRight className={cn("size-3.5 transition", isOpen && "rotate-90")} />
          </button>
          <Link href={`/projets/${f.id}`} className="flex min-w-0 flex-1 items-center gap-2">
            <ColorDot color={f.color} className={depth > 0 ? "opacity-70" : ""} />
            <span className={cn("truncate", depth === 0 && "font-medium")}>{f.name}</span>
          </Link>
          {c && c.pending > 0 && (
            <span
              className={cn(
                "shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] font-medium text-muted tabular-nums",
                !compact && "px-2 py-0.5 text-xs",
              )}
              title={`${c.pending} à poster sur ${c.total}`}
            >
              {c.pending}
            </span>
          )}
        </div>
        {isOpen && kids.length > 0 && <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    );
  };

  return <ul className="space-y-0.5">{roots.map((f) => renderNode(f, 0))}</ul>;
}
