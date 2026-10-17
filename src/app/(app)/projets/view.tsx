"use client";

import { FolderPlus, FolderTree } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageBody, PageHeader, Splash } from "@/components/AppShell";
import { useData } from "@/components/data/DataProvider";
import { FolderFormModal } from "@/components/FolderFormModal";
import { FolderTreeNav, useFolderCounts } from "@/components/FolderTreeNav";
import { Button, Card, EmptyState, PlatformBadge, Segmented } from "@/components/ui";
import { childrenOf } from "@/lib/folders";
import { useLocalState } from "@/lib/use-local-state";

export default function ProjectsPage() {
  const { index, accounts, ready } = useData();
  const counts = useFolderCounts();
  const [view, setView] = useLocalState<"cartes" | "arbre">("projects.view", "cartes");
  const [creating, setCreating] = useState(false);
  const roots = childrenOf(index, null);

  if (!ready) return <Splash />;

  return (
    <>
      <PageHeader
        title="Projets"
        subtitle="Projet › sous-projet › angle › contenus"
        actions={
          <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={() => setCreating(true)}>
            <span className="hidden sm:inline">Nouveau projet</span>
            <span className="sm:hidden">Projet</span>
          </Button>
        }
      >
        {roots.length > 0 && (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "cartes", label: "Cartes" },
              { value: "arbre", label: "Arborescence" },
            ]}
          />
        )}
      </PageHeader>

      <PageBody>
        {roots.length === 0 ? (
          <EmptyState
            icon={<FolderTree className="size-8" />}
            title="Aucun projet pour l'instant"
            action={
              <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={() => setCreating(true)}>
                Créer mon premier projet
              </Button>
            }
          >
            Un projet = une marque ou une app (ex. Compaatible). Dedans, tu crées des sous-projets puis des angles, et tu y
            ranges tes vidéos et carrousels.
          </EmptyState>
        ) : view === "arbre" ? (
          <Card className="p-2">
            <FolderTreeNav />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roots.map((p) => {
              const c = counts.get(p.id);
              const subs = childrenOf(index, p.id);
              const accs = accounts.filter((a) => a.folder_id === p.id);
              return (
                <Card key={p.id} className="overflow-hidden">
                  <Link href={`/projets/${p.id}`} className="block p-4 transition hover:bg-surface-2/50">
                    <div className="flex items-start gap-3">
                      <span
                        className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
                        style={{ background: p.color }}
                      >
                        {(Array.from(p.name)[0] ?? "?").toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{p.name}</p>
                        <p className="text-xs text-muted">
                          {c?.total ?? 0} contenu{(c?.total ?? 0) > 1 ? "s" : ""}
                          {c && c.pending > 0 && ` · ${c.pending} à poster`}
                        </p>
                      </div>
                      {accs.length > 0 && (
                        <div className="flex -space-x-1">
                          {accs.slice(0, 4).map((a) => (
                            <PlatformBadge key={a.id} platform={a.platform} size="sm" />
                          ))}
                        </div>
                      )}
                    </div>
                    {p.description && <p className="mt-3 line-clamp-2 text-sm text-muted">{p.description}</p>}
                  </Link>
                  {subs.length > 0 && (
                    <ul className="border-t border-line px-2 py-2">
                      {subs.slice(0, 5).map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/projets/${s.id}`}
                            className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2"
                          >
                            <span className="text-muted">↳</span>
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="text-xs text-muted tabular-nums">{counts.get(s.id)?.total ?? 0}</span>
                          </Link>
                        </li>
                      ))}
                      {subs.length > 5 && (
                        <li>
                          <Link href={`/projets/${p.id}`} className="block px-2 py-1 text-xs text-accent">
                            + {subs.length - 5} autres
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>

      <FolderFormModal open={creating} onClose={() => setCreating(false)} parentId={null} />
    </>
  );
}
