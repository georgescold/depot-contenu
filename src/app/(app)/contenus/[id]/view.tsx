"use client";

import { ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageBody, PageHeader, Splash } from "@/components/AppShell";
import { AutoField } from "@/components/AutoField";
import { ArchiveNotice } from "@/components/content/ArchiveNotice";
import { AssetsSection } from "@/components/content/AssetsSection";
import { PublicationCard } from "@/components/content/PublicationCard";
import { SaveToDevice } from "@/components/content/SaveToDevice";
import { useData } from "@/components/data/DataProvider";
import { useUploads } from "@/components/upload/UploadProvider";
import { FolderPicker } from "@/components/FolderPicker";
import { inheritedLabel, PersonPicker } from "@/components/people";
import { Button, Chip, EmptyState, Field, IconButton, Pill, SectionTitle } from "@/components/ui";
import { FORMAT_LIST, FORMATS } from "@/lib/constants";
import { effectiveAssignee } from "@/lib/assignee";
import { accountsForFolder, ancestorsOf } from "@/lib/folders";
import { formatBytes } from "@/lib/format";
import { contentStatus, STATUS_INFO } from "@/lib/status";
import type { AssetKind, Format } from "@/lib/types";

function kindsFor(format: Format, present: Set<AssetKind>): AssetKind[] {
  const base: AssetKind[] =
    format === "carousel" || format === "photo" ? ["photo", "thumbnail"] : ["video", "thumbnail"];
  const extra = (["video", "photo", "thumbnail"] as AssetKind[]).filter((k) => !base.includes(k) && present.has(k));
  return [...base, ...extra, "other"];
}

export default function ContentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { contentById, index, accounts, personById, ready, updateContent, deleteContent } = useData();
  const { activeFor } = useUploads();
  const content = contentById.get(id);

  if (!ready) return <Splash />;
  if (!content) {
    return (
      <PageBody className="pt-10">
        <EmptyState title="Contenu introuvable" action={<Button onClick={() => router.push("/contenus")}>Voir les contenus</Button>}>
          Il a peut-être été supprimé.
        </EmptyState>
      </PageBody>
    );
  }

  const chain = ancestorsOf(index, content.folder_id);
  const status = contentStatus(content.publications);
  const available = accountsForFolder(index, accounts, content.folder_id);
  // comptes déjà utilisés mais plus dans l'arborescence (contenu déplacé)
  const orphanPubs = content.publications.filter((p) => !available.some((a) => a.id === p.account_id));
  const orphanAccounts = orphanPubs
    .map((p) => accounts.find((a) => a.id === p.account_id))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const allAccounts = [...available, ...orphanAccounts];
  const sortedAccounts = [
    ...allAccounts.filter((a) => content.publications.some((p) => p.account_id === a.id)),
    ...allAccounts.filter((a) => !content.publications.some((p) => p.account_id === a.id)),
  ];
  const live = content.assets.filter((a) => !a.archived_at);
  const present = new Set(live.map((a) => a.kind));
  const totalSize = live.reduce((s, a) => s + (a.size_bytes || 0), 0);

  const remove = async () => {
    const sending = activeFor(content.id);
    const warn = sending ? `\n\nAttention : ${sending} fichier(s) sont encore en cours d'envoi et seront perdus.` : "";
    if (!confirm(`Supprimer « ${content.title} » et tous ses fichiers ? C'est définitif.${warn}`)) return;
    const folderId = content.folder_id;
    if (await deleteContent(content.id)) router.push(`/projets/${folderId}`);
  };

  return (
    <>
      <PageHeader
        title={content.title || "Sans titre"}
        subtitle={
          <nav className="flex flex-wrap items-center gap-1">
            {chain.map((f, i) => (
              <span key={f.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" />}
                <Link href={`/projets/${f.id}`} className="hover:text-ink">
                  {f.name}
                </Link>
              </span>
            ))}
          </nav>
        }
        actions={
          <>
            <Pill tone={STATUS_INFO[status].tone} className="hidden sm:inline-flex">
              {STATUS_INFO[status].label}
            </Pill>
            <IconButton label="Supprimer le contenu" onClick={remove} className="hover:text-danger">
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Colonne fichiers */}
          <div className="min-w-0 space-y-6">
            <div className="space-y-4">
              <Field label="Titre interne">
                <AutoField
                  value={content.title}
                  onCommit={(v) => updateContent(content.id, { title: v.trim() || "Sans titre" })}
                  className="h-11 text-base font-semibold"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Format" group>
                  <div className="flex flex-wrap gap-1.5">
                    {FORMAT_LIST.map((f) => (
                      <Chip key={f} active={content.format === f} onClick={() => updateContent(content.id, { format: f })}>
                        {FORMATS[f].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Rangé dans">
                  <FolderPicker value={content.folder_id} onChange={(v) => v && updateContent(content.id, { folder_id: v })} />
                </Field>
                <Field label="Qui le poste ?" hint="Laisse vide pour reprendre la personne du compte ou du projet.">
                  <PersonPicker
                    value={content.assignee_id}
                    onChange={(v) => updateContent(content.id, { assignee_id: v })}
                    inherited={inheritedLabel(effectiveAssignee(index, { ...content, assignee_id: null }), personById)}
                  />
                </Field>
              </div>
            </div>

            <div>
              <SectionTitle action={<SaveToDevice assets={live} />}>
                Fichiers
                {totalSize > 0 && <span className="ml-2 font-normal normal-case">· {formatBytes(totalSize)}</span>}
              </SectionTitle>
              <div className="space-y-6">
                <ArchiveNotice content={content} />
                {kindsFor(content.format, present).map((k) => (
                  <AssetsSection key={k} content={content} kind={k} />
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Notes</SectionTitle>
              <AutoField
                multiline
                value={content.notes}
                onCommit={(v) => updateContent(content.id, { notes: v })}
                placeholder="Brief, idées, musique à mettre, à qui l'envoyer…"
              />
            </div>
          </div>

          {/* Colonne publications */}
          <div className="min-w-0">
            <div className="space-y-3 lg:sticky lg:top-6">
              <SectionTitle>Publications</SectionTitle>
              {sortedAccounts.length ? (
                sortedAccounts.map((a) => (
                  <PublicationCard
                    key={a.id}
                    content={content}
                    account={a}
                    pub={content.publications.find((p) => p.account_id === a.id)}
                  />
                ))
              ) : (
                <EmptyState
                  title="Aucun compte dans ce projet"
                  action={
                    <Button onClick={() => router.push(`/projets/${chain[0]?.id ?? content.folder_id}`)}>Ajouter des comptes</Button>
                  }
                >
                  Ajoute les comptes Instagram, TikTok, YouTube… du projet pour écrire les descriptions et programmer.
                </EmptyState>
              )}
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
