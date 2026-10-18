"use client";

import { Bookmark, Eye, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useEffect, useState } from "react";
import { dateTimeLabel } from "@/lib/format";
import { postIdFromUrl } from "@/lib/post-id";
import { compactNumber, fullNumber } from "@/lib/stats-format";
import { supabase } from "@/lib/supabase/browser";
import type { Account, PostStat, Publication } from "@/lib/types";

/**
 * Statistiques du post publié (collectées chaque nuit), retrouvé par son lien
 * ou par la publication reliée lors de la collecte.
 */
export function PostStatsLine({ account, pub }: { account: Account; pub: Publication }) {
  const externalId = postIdFromUrl(account.platform, pub.post_url);
  const [stat, setStat] = useState<PostStat | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let q = supabase().from("post_stats").select("*").eq("account_id", account.id).limit(1);
      q = externalId ? q.eq("external_id", externalId) : q.eq("publication_id", pub.id);
      const { data } = await q.maybeSingle();
      if (alive) setStat((data as PostStat | null) ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [account.id, externalId, pub.id]);

  if (!stat) return null;
  const items = [
    { icon: Eye, value: stat.views, label: "vues" },
    { icon: Heart, value: stat.likes, label: "likes" },
    { icon: MessageCircle, value: stat.comments, label: "commentaires" },
    { icon: Repeat2, value: stat.shares, label: "partages" },
    { icon: Bookmark, value: stat.saves, label: "enregistrements" },
  ].filter((i) => i.value !== null);

  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {items.map(({ icon: Icon, value, label }) => (
          <span key={label} className="flex items-center gap-1 tabular-nums" title={`${fullNumber(value)} ${label}`}>
            <Icon className="size-3.5 text-muted" />
            {compactNumber(value)}
          </span>
        ))}
      </div>
      <p className="mt-0.5 text-[11px] text-muted">Relevé le {dateTimeLabel(stat.updated_at)}</p>
    </div>
  );
}
