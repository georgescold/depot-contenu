"use client";

import { addDays, format } from "date-fns";
import { Copy, ExternalLink, Plus, X } from "lucide-react";
import { useState } from "react";
import { PLATFORMS } from "@/lib/constants";
import { copyText } from "@/lib/clipboard";
import { dateTimeLabel } from "@/lib/format";
import { isLate } from "@/lib/status";
import type { Account, ContentFull, Publication } from "@/lib/types";
import { AutoField } from "../AutoField";
import { useData } from "../data/DataProvider";
import { useToast } from "../Toast";
import { Button, cn, IconButton, Input, PlatformBadge, PostedCheck, Select } from "../ui";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function PublicationCard({
  content,
  account,
  pub,
}: {
  content: ContentFull;
  account: Account;
  pub?: Publication;
}) {
  const { savePublication, deletePublication, accountById } = useData();
  const toast = useToast();
  const info = PLATFORMS[account.platform];
  const save = (patch: Parameters<typeof savePublication>[2]) => savePublication(content.id, account.id, patch);
  const [copiedFrom, setCopiedFrom] = useState("");

  const copy = async (text: string, what: string) => {
    if (!text.trim()) return toast(`${what} vide`, "error");
    const ok = await copyText(text);
    toast(ok ? `${what} copié` : "Copie impossible", ok ? "success" : "error");
  };

  if (!pub) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-3">
        <PlatformBadge platform={account.platform} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.handle || info.label}</p>
          <p className="text-xs text-muted">Pas prévu sur ce compte</p>
        </div>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => save({})}>
          Publier ici
        </Button>
      </div>
    );
  }

  const late = isLate(pub);
  const others = content.publications.filter((p) => p.account_id !== account.id && p.description.trim());
  const descLen = pub.description.length;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface",
        pub.posted ? "border-success/40" : late ? "border-danger/40" : "border-line",
      )}
    >
      <div className="flex items-center gap-3 p-3 pb-2">
        <PlatformBadge platform={account.platform} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.handle || info.label}</p>
          <p className={cn("text-xs", pub.posted ? "text-success" : late ? "text-danger" : "text-muted")}>
            {pub.posted
              ? `Posté${pub.posted_at ? ` le ${dateTimeLabel(pub.posted_at)}` : ""}`
              : late
                ? "En retard"
                : pub.scheduled_date
                  ? "Programmé"
                  : "Pas encore de date"}
          </p>
        </div>
        <PostedCheck size="lg" checked={pub.posted} onChange={(v) => save({ posted: v })} />
        <IconButton
          label="Ne plus publier sur ce compte"
          onClick={() => {
            if (pub.description.trim() && !confirm("Retirer ce compte ? La description saisie sera perdue.")) return;
            deletePublication(content.id, account.id);
          }}
        >
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={pub.scheduled_date ?? ""}
              onChange={(e) => save({ scheduled_date: e.target.value || null })}
              className="h-9 min-w-0 flex-1"
              aria-label="Date de publication"
            />
            <Input
              type="time"
              value={pub.scheduled_time?.slice(0, 5) ?? ""}
              onChange={(e) => save({ scheduled_time: e.target.value ? `${e.target.value}:00` : null })}
              className="h-9 w-28 shrink-0"
              aria-label="Heure"
            />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => save({ scheduled_date: iso(new Date()) })}>
              Auj.
            </Button>
            <Button size="sm" variant="ghost" onClick={() => save({ scheduled_date: iso(addDays(new Date(), 1)) })}>
              Demain
            </Button>
          </div>
        </div>

        {info.hasTitle && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Titre</span>
              <div className="flex items-center gap-1">
                <span className={cn("text-xs tabular-nums", pub.title.length > 100 ? "text-danger" : "text-muted")}>
                  {pub.title.length}/100
                </span>
                <IconButton label="Copier le titre" className="size-7" onClick={() => copy(pub.title, "Titre")}>
                  <Copy className="size-3.5" />
                </IconButton>
              </div>
            </div>
            <AutoField value={pub.title} onCommit={(v) => save({ title: v })} placeholder="Titre de la vidéo" />
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">{account.platform === "youtube" ? "Description" : "Légende"}</span>
            <div className="flex items-center gap-1">
              <span className={cn("text-xs tabular-nums", descLen > info.limit ? "text-danger" : "text-muted")}>
                {descLen}/{info.limit}
              </span>
            </div>
          </div>
          <AutoField
            multiline
            minRows={4}
            value={pub.description}
            onCommit={(v) => save({ description: v })}
            placeholder={`Texte à publier sur ${info.label}… (hashtags compris)`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Copy className="size-4" />}
              onClick={() => copy(pub.description, account.platform === "youtube" ? "Description" : "Légende")}
            >
              Copier le texte
            </Button>
            {others.length > 0 && (
              <Select
                value={copiedFrom}
                onChange={(e) => {
                  const src = content.publications.find((p) => p.id === e.target.value);
                  setCopiedFrom("");
                  if (!src) return;
                  if (pub.description.trim() && !confirm("Remplacer le texte actuel ?")) return;
                  save({ description: src.description });
                }}
                className="h-8 w-auto text-[13px]"
              >
                <option value="">Reprendre le texte de…</option>
                {others.map((p) => {
                  const a = accountById.get(p.account_id);
                  return (
                    <option key={p.id} value={p.id}>
                      {a ? `${PLATFORMS[a.platform].label} ${a.handle}` : "Autre compte"}
                    </option>
                  );
                })}
              </Select>
            )}
          </div>
        </div>

        {pub.posted && (
          <div className="flex items-center gap-2">
            <AutoField
              type="url"
              value={pub.post_url}
              onCommit={(v) => save({ post_url: v.trim() })}
              placeholder="Lien du post (facultatif)"
              className="h-9"
            />
            {pub.post_url && (
              <a
                href={pub.post_url}
                target="_blank"
                rel="noreferrer"
                aria-label="Ouvrir le post"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
