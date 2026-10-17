"use client";

import Link from "next/link";
import { folderColor, folderPath } from "@/lib/folders";
import { formatTime } from "@/lib/format";
import type { Account, ContentFull, Publication } from "@/lib/types";
import { useData } from "../data/DataProvider";
import { Thumb } from "../Thumb";
import { cn, PlatformBadge, PostedCheck } from "../ui";

export interface PlanItem {
  pub: Publication;
  content: ContentFull;
  account?: Account;
}

export function itemKey(i: PlanItem) {
  return `${i.content.id}|${i.pub.account_id}`;
}

export function PlanningRow({ item, showDate }: { item: PlanItem; showDate?: string }) {
  const { savePublication, index } = useData();
  const { pub, content, account } = item;
  const color = folderColor(index, content.folder_id);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-surface p-2.5 pr-3 transition",
        pub.posted ? "border-line opacity-70" : "border-line hover:border-accent/40",
      )}
    >
      <PostedCheck
        checked={pub.posted}
        onChange={(v) => savePublication(content.id, pub.account_id, { posted: v })}
      />
      <Link href={`/contenus/${content.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Thumb content={content} color={color} className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[14px] font-semibold", pub.posted && "text-muted line-through")}>
            {content.title}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
            {account && <PlatformBadge platform={account.platform} size="sm" />}
            <span className="truncate">
              {account?.handle ? `${account.handle} · ` : ""}
              {folderPath(index, content.folder_id)}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          {showDate && <p className="text-xs text-muted">{showDate}</p>}
          {pub.scheduled_time && (
            <p className="text-sm font-semibold tabular-nums">{formatTime(pub.scheduled_time)}</p>
          )}
        </div>
      </Link>
    </div>
  );
}
