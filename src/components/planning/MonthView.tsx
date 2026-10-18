"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { folderColor } from "@/lib/folders";
import { dayLabel, monthLabel } from "@/lib/format";
import { todayISO } from "@/lib/status";
import { useData } from "../data/DataProvider";
import { Button, cn, IconButton, PlatformBadge } from "../ui";
import { itemKey, PlanningRow, type PlanItem } from "./PlanningRow";

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function MonthView({
  items,
  hidePosted,
  onSchedule,
}: {
  items: PlanItem[];
  hidePosted: boolean;
  onSchedule: (date: string) => void;
}) {
  const { index, savePublication } = useData();
  const today = todayISO();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(today);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(month, { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const i of items) {
      if (hidePosted && i.pub.posted) continue;
      const d = i.pub.scheduled_date!;
      const list = map.get(d) ?? [];
      list.push(i);
      map.set(d, list);
    }
    return map;
  }, [items, hidePosted]);

  const selectedItems = byDate.get(selected) ?? [];

  const onDrop = (date: string, data: string) => {
    setDragOver(null);
    const [contentId, accountId] = data.split("|");
    if (contentId && accountId) savePublication(contentId, accountId, { scheduled_date: date });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setMonth(startOfMonth(new Date()));
              setSelected(today);
            }}
          >
            Aujourd&apos;hui
          </Button>
          <IconButton label="Mois précédent" onClick={() => setMonth((m) => addMonths(m, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Mois suivant" onClick={() => setMonth((m) => addMonths(m, 1))}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const key = iso(d);
            const list = byDate.get(key) ?? [];
            const inMonth = isSameMonth(d, month);
            const isToday = key === today;
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(key)}
                onKeyDown={(e) => e.key === "Enter" && setSelected(key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(key);
                }}
                onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(key, e.dataTransfer.getData("text/plain"));
                }}
                className={cn(
                  "relative min-h-16 cursor-pointer border-r border-b border-line p-1 text-left transition last:border-r-0 md:min-h-28 md:p-1.5 [&:nth-child(7n)]:border-r-0",
                  !inMonth && "bg-surface-2/40 text-muted",
                  selected === key && "bg-accent-soft/60",
                  dragOver === key && "bg-accent-soft ring-2 ring-accent ring-inset",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                    isToday && "bg-accent text-accent-ink",
                  )}
                >
                  {d.getDate()}
                </span>
                {/* mobile : pastilles */}
                <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                  {list.slice(0, 6).map((i) => (
                    <span
                      key={itemKey(i)}
                      className={cn("size-1.5 rounded-full", i.pub.posted && "opacity-35")}
                      style={{ background: folderColor(index, i.content.folder_id) }}
                    />
                  ))}
                </div>
                {/* ordinateur : étiquettes déplaçables */}
                <div className="mt-1 hidden space-y-0.5 md:block">
                  {list.slice(0, 3).map((i) => (
                    <div
                      key={itemKey(i)}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", itemKey(i))}
                      title={`${i.content.title} — glisser pour changer de jour`}
                      className={cn(
                        "flex cursor-grab items-center gap-1 rounded-md px-1 py-0.5 text-[11px] leading-tight active:cursor-grabbing",
                        i.pub.posted ? "text-muted line-through" : "text-ink",
                      )}
                      style={{
                        background: `color-mix(in srgb, ${folderColor(index, i.content.folder_id)} 14%, transparent)`,
                      }}
                    >
                      {i.account && <PlatformBadge platform={i.account.platform} size="sm" className="size-3.5" />}
                      <span className="truncate">{i.content.title}</span>
                    </div>
                  ))}
                  {list.length > 3 && <p className="px-1 text-[11px] text-muted">+{list.length - 3}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{dayLabel(selected)}</h3>
          <Button size="sm" variant="ghost" icon={<CalendarPlus className="size-4" />} onClick={() => onSchedule(selected)}>
            Programmer
          </Button>
        </div>
        {selectedItems.length ? (
          <div className="space-y-2">
            {selectedItems.map((i) => (
              <PlanningRow key={itemKey(i)} item={i} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line py-6 text-center text-sm text-muted">
            Rien de prévu ce jour-là.
          </p>
        )}
        <p className="mt-3 hidden text-xs text-muted md:block">
          Astuce : glisse une publication sur un autre jour du calendrier pour la décaler.
        </p>
      </section>
    </div>
  );
}

export function parseDay(isoDate: string) {
  return parseISO(isoDate);
}
