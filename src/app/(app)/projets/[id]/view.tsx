"use client";

import { ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AccountFormModal } from "@/components/AccountFormModal";
import { PageBody, PageHeader, Splash, useShell } from "@/components/AppShell";
import { ContentCard } from "@/components/ContentCard";
import { useData } from "@/components/data/DataProvider";
import { FolderFormModal } from "@/components/FolderFormModal";
import { useFolderCounts } from "@/components/FolderTreeNav";
import { Button, Card, Chip, EmptyState, IconButton, PlatformBadge, SectionTitle } from "@/components/ui";
import { PLATFORMS } from "@/lib/constants";
import { accountsForFolder, ancestorsOf, childrenOf, descendantIds } from "@/lib/folders";
import { useLocalState } from "@/lib/use-local-state";
import type { Account } from "@/lib/types";

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { index, accounts, contents, ready, deleteFolder } = useData();
  const { openNewContent } = useShell();
  const counts = useFolderCounts();
  const [includeSubs, setIncludeSubs] = useLocalState("folder.includeSubs", true);
  const [editing, setEditing] = useState(false);
  const [creatingSub, setCreatingSub] = useState(false);
  const [accountModal, setAccountModal] = useState<{ open: boolean; account: Account | null }>({
    open: false,
    account: null,
  });

  const folder = index.byId.get(id);
  const chain = ancestorsOf(index, id);
  const subs = childrenOf(index, id);
  const available = accountsForFolder(index, accounts, id);
  const scope = useMemo(() => (includeSubs ? descendantIds(index, id) : new Set([id])), [includeSubs, index, id]);
  const list = contents.filter((c) => scope.has(c.folder_id));

  if (!ready) return <Splash />;
  if (!folder) {
    return (
      <PageBody className="pt-10">
        <EmptyState title="Dossier introuvable" action={<Button onClick={() => router.push("/projets")}>Retour aux projets</Button>}>
          Il a peut-être été supprimé ou déplacé.
        </EmptyState>
      </PageBody>
    );
  }

  const remove = async () => {
    const own = accounts.filter((a) => a.folder_id === folder.id);
    const ownIds = new Set(own.map((a) => a.id));
    const pubs = contents.reduce((n, c) => n + c.publications.filter((p) => ownIds.has(p.account_id)).length, 0);
    const warn = own.length
      ? `\n\nSes ${own.length} compte(s) seront aussi supprimés${pubs ? `, avec ${pubs} publication(s) prévue(s) dessus (dates et légendes)` : ""}.`
      : "";
    if (!confirm(`Supprimer le dossier « ${folder.name} » ?${warn}`)) return;
    const ok = await deleteFolder(folder.id);
    if (ok) router.push(folder.parent_id ? `/projets/${folder.parent_id}` : "/projets");
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="size-3.5 shrink-0 rounded-full" style={{ background: folder.color }} />
            <span className="truncate">{folder.name}</span>
          </span>
        }
        subtitle={
          <nav className="flex flex-wrap items-center gap-1">
            <Link href="/projets" className="hover:text-ink">
              Projets
            </Link>
            {chain.slice(0, -1).map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="size-3.5" />
                <Link href={`/projets/${f.id}`} className="hover:text-ink">
                  {f.name}
                </Link>
              </span>
            ))}
          </nav>
        }
        actions={
          <>
            <IconButton label="Modifier le dossier" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Supprimer le dossier" onClick={remove}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <PageBody className="space-y-8">
        {folder.description && <p className="-mt-2 max-w-2xl text-sm whitespace-pre-line text-muted">{folder.description}</p>}

        {/* Comptes */}
        <section>
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAccountModal({ open: true, account: null })}>
                Compte
              </Button>
            }
          >
            Comptes de publication
          </SectionTitle>
          {available.length ? (
            <div className="flex flex-wrap gap-2">
              {available.map((a) => {
                const own = a.folder_id === folder.id;
                const from = index.byId.get(a.folder_id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => (own ? setAccountModal({ open: true, account: a }) : router.push(`/projets/${a.folder_id}`))}
                    className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm transition hover:border-accent"
                    title={own ? "Modifier" : `Hérité de ${from?.name}`}
                  >
                    <PlatformBadge platform={a.platform} />
                    <span className="font-medium">{a.handle || PLATFORMS[a.platform].label}</span>
                    {!own && <span className="text-xs text-muted">· {from?.name}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Ajoute les comptes Instagram, TikTok, YouTube… de ce projet pour pouvoir programmer les publications.
            </p>
          )}
        </section>

        {/* Sous-dossiers */}
        <section>
          <SectionTitle
            action={
              <Button size="sm" variant="ghost" icon={<FolderPlus className="size-4" />} onClick={() => setCreatingSub(true)}>
                Dossier
              </Button>
            }
          >
            Sous-dossiers
          </SectionTitle>
          {subs.length ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {subs.map((s) => {
                const c = counts.get(s.id);
                const n = childrenOf(index, s.id).length;
                return (
                  <Link key={s.id} href={`/projets/${s.id}`}>
                    <Card className="h-full p-3 transition hover:border-accent">
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                        <p className="truncate text-sm font-semibold">{s.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {c?.total ?? 0} contenu{(c?.total ?? 0) > 1 ? "s" : ""}
                        {n > 0 && ` · ${n} dossier${n > 1 ? "s" : ""}`}
                      </p>
                      {c && c.pending > 0 && <p className="mt-0.5 text-xs font-medium text-warning">{c.pending} à poster</p>}
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">Crée des sous-projets ou des angles pour ranger tes contenus.</p>
          )}
        </section>

        {/* Contenus */}
        <section>
          <SectionTitle
            action={
              <div className="flex items-center gap-2">
                {subs.length > 0 && (
                  <Chip active={includeSubs} onClick={() => setIncludeSubs(!includeSubs)}>
                    Avec les sous-dossiers
                  </Chip>
                )}
                <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => openNewContent(folder.id)}>
                  Contenu
                </Button>
              </div>
            }
          >
            Contenus · {list.length}
          </SectionTitle>
          {list.length ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {list.map((c) => (
                <ContentCard key={c.id} content={c} showPath={includeSubs && c.folder_id !== folder.id} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun contenu ici"
              action={
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openNewContent(folder.id)}>
                  Ajouter un contenu
                </Button>
              }
            >
              Dépose une vidéo, un carrousel, la miniature et les descriptions.
            </EmptyState>
          )}
        </section>
      </PageBody>

      <FolderFormModal open={editing} onClose={() => setEditing(false)} folder={folder} />
      <FolderFormModal
        open={creatingSub}
        onClose={() => setCreatingSub(false)}
        parentId={folder.id}
        onSaved={(f) => router.push(`/projets/${f.id}`)}
      />
      <AccountFormModal
        open={accountModal.open}
        onClose={() => setAccountModal({ open: false, account: null })}
        folderId={folder.id}
        account={accountModal.account}
      />
    </>
  );
}
