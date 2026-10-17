"use client";

import { CalendarClock, Film, GalleryHorizontalEnd } from "lucide-react";
import Link from "next/link";
import { FORMATS } from "@/lib/constants";
import { folderColor, folderPath } from "@/lib/folders";
import { formatTime, shortDate } from "@/lib/format";
import { contentStatus, STATUS_INFO, todayISO } from "@/lib/status";
import type { ContentFull } from "@/lib/types";
import { useData } from "./data/DataProvider";
import { Thumb } from "./Thumb";
import { cn, PlatformBadge, Pill } from "./ui";

export function nextPublication(c: ContentFull) {
  const today = todayISO();
  return c.publications
    .filter((p) => !p.posted && p.scheduled_date)
    .sort((a, b) =>
      `${a.scheduled_date}${a.scheduled_time ?? ""}`.localeCompare(`${b.scheduled_date}${b.scheduled_time ?? ""}`),
    )
    .find((p) => p.scheduled_date! >= today) ?? null;
}

export function ContentCard({ content, showPath = true }: { content: ContentFull; showPath?: boolean }) {
  const { index, accountById } = useData();
  const status = contentStatus(content.publications);
  const info = STATUS_INFO[status];
  const color = folderColor(index, content.folder_id);
  const next = nextPublication(content);
  const live = content.assets.filter((a) => !a.archived_at);
  const videos = live.filter((a) => a.kind === "video").length;
  const photos = live.filter((a) => a.kind === "photo").length;

  return (
    <Link
      href={`/contenus/${content.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative">
        <Thumb content={content} color={color} className="aspect-[4/3] w-full" />
        <div className="absolute top-2 left-2 flex gap-1">
          <Pill tone={info.tone} className="shadow-sm">
            {info.label}
          </Pill>
        </div>
        {(videos > 0 || photos > 1) && (
          <div className="absolute right-2 bottom-2 flex gap-1 text-[11px] font-medium text-white">
            {videos > 0 && (
              <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5">
                <Film className="size-3" />
                {videos}
              </span>
            )}
            {photos > 1 && (
              <span className="flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5">
                <GalleryHorizontalEnd className="size-3" />
                {photos}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14px] leading-snug font-semibold">{content.title}</p>
          {showPath && (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="truncate">{folderPath(index, content.folder_id)}</span>
            </p>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex -space-x-1">
            {content.publications.slice(0, 5).map((p) => {
              const acc = accountById.get(p.account_id);
              return acc ? <PlatformBadge key={p.id} platform={acc.platform} size="sm" posted={p.posted} /> : null;
            })}
          </div>
          <span className={cn("flex items-center gap-1 text-xs", next ? "text-ink" : "text-muted")}>
            {next ? (
              <>
                <CalendarClock className="size-3.5" />
                {shortDate(next.scheduled_date!)}
                {next.scheduled_time && ` ${formatTime(next.scheduled_time)}`}
              </>
            ) : (
              FORMATS[content.format].label
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
