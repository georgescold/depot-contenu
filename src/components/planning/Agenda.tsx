"use client";

import { addDays, format, parseISO } from "date-fns";
import { CalendarPlus, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { dayLabel, shortDate } from "@/lib/format";
import { isLate, todayISO } from "@/lib/status";
import { Button, cn } from "../ui";
import { itemKey, PlanningRow, type PlanItem } from "./PlanningRow";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function Agenda({
  items,
  hidePosted,
  onSchedule,
}: {
  items: PlanItem[];
  hidePosted: boolean;
  onSchedule: (date: string) => void;
}) {
  const today = todayISO();
  const [horizon, setHorizon] = useState(14);

  const { overdue, days, later } = useMemo(() => {
    const end = iso(addDays(parseISO(today), horizon));
    const overdue = items.filter((i) => isLate(i.pub, today));
    const groups = new Map<string, PlanItem[]>();
    groups.set(today, []);
    groups.set(iso(addDays(parseISO(today), 1)), []);
    let later = 0;
    for (const i of items) {
      const d = i.pub.scheduled_date!;
      if (d < today) continue;
      if (hidePosted && i.pub.posted) continue;
      if (d >= end) {
        later++;
        continue;
      }
      const list = groups.get(d) ?? [];
      list.push(i);
      groups.set(d, list);
    }
    const days = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { overdue, days, later };
  }, [items, today, horizon, hidePosted]);

  return (
    <div className="space-y-6">
      {overdue.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
            <TriangleAlert className="size-4" />
            En retard · {overdue.length}
          </h2>
          <div className="space-y-2">
            {overdue.map((i) => (
              <PlanningRow key={itemKey(i)} item={i} showDate={shortDate(i.pub.scheduled_date!)} />
            ))}
          </div>
        </section>
      )}

      {days.map(([date, list]) => {
        const done = list.filter((i) => i.pub.posted).length;
        return (
          <section key={date}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className={cn("text-sm font-semibold", date === today && "text-accent")}>
                {dayLabel(date)}
                {date !== today && date !== iso(addDays(parseISO(today), 1)) ? null : (
                  <span className="ml-2 font-normal text-muted">{shortDate(date)}</span>
                )}
              </h2>
              {list.length > 0 && (
                <span className="text-xs text-muted tabular-nums">
                  {done}/{list.length} posté{list.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {list.length ? (
              <div className="space-y-2">
                {list.map((i) => (
                  <PlanningRow key={itemKey(i)} item={i} />
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSchedule(date)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-4 text-sm text-muted transition hover:border-accent hover:text-accent"
              >
                <CalendarPlus className="size-4" />
                Rien de prévu · programmer un contenu
              </button>
            )}
          </section>
        );
      })}

      <div className="flex flex-col items-center gap-2 pt-2">
        {later > 0 && (
          <p className="text-sm text-muted">
            {later} publication{later > 1 ? "s" : ""} prévue{later > 1 ? "s" : ""} plus tard
          </p>
        )}
        <Button variant="secondary" onClick={() => setHorizon((h) => h + 14)}>
          Voir 2 semaines de plus
        </Button>
      </div>
    </div>
  );
}
