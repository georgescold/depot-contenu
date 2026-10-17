"use client";

import { addDays, addWeeks, format, isSameMonth, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { dayLabel } from "@/lib/format";
import { todayISO } from "@/lib/status";
import { Button, cn, IconButton } from "../ui";
import { itemKey, PlanningRow, type PlanItem } from "./PlanningRow";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Une semaine du lundi au dimanche, jour par jour. */
export function WeekView({
  items,
  hidePosted,
  onSchedule,
}: {
  items: PlanItem[];
  hidePosted: boolean;
  onSchedule: (date: string) => void;
}) {
  const today = todayISO();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const first = iso(days[0]);
  const last = iso(days[6]);

  const byDate = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const i of items) {
      const d = i.pub.scheduled_date!;
      if (d < first || d > last) continue;
      if (hidePosted && i.pub.posted) continue;
      const list = map.get(d) ?? [];
      list.push(i);
      map.set(d, list);
    }
    return map;
  }, [items, first, last, hidePosted]);

  const all = [...byDate.values()].flat();
  const done = all.filter((i) => i.pub.posted).length;
  const range = isSameMonth(days[0], days[6])
    ? `${format(days[0], "d", { locale: fr })} au ${format(days[6], "d MMMM", { locale: fr })}`
    : `${format(days[0], "d MMM", { locale: fr })} au ${format(days[6], "d MMM", { locale: fr })}`;
  const isCurrent = first <= today && today <= last;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Semaine du {range}</h2>
          <p className="text-xs text-muted">
            {all.length
              ? `${all.length} publication${all.length > 1 ? "s" : ""} · ${done} postée${done > 1 ? "s" : ""}`
              : "Rien de prévu cette semaine"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isCurrent && (
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
              Cette semaine
            </Button>
          )}
          <IconButton label="Semaine précédente" onClick={() => setWeekStart((w) => addWeeks(w, -1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Semaine suivante" onClick={() => setWeekStart((w) => addWeeks(w, 1))}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </div>

      {days.map((d) => {
        const key = iso(d);
        const list = byDate.get(key) ?? [];
        const posted = list.filter((i) => i.pub.posted).length;
        if (!list.length && key < today) return null; // jours passés sans rien : on ne les affiche pas
        return (
          <section key={key}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className={cn("text-sm font-semibold", key === today && "text-accent", key < today && "text-muted")}>
                {dayLabel(key)}
                {(key === today || dayLabel(key) === "Demain" || dayLabel(key) === "Hier") && (
                  <span className="ml-2 font-normal text-muted">{format(d, "d MMM", { locale: fr })}</span>
                )}
              </h3>
              {list.length > 0 && (
                <span className="text-xs text-muted tabular-nums">
                  {posted}/{list.length} posté{list.length > 1 ? "s" : ""}
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
                onClick={() => onSchedule(key)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2.5 text-xs text-muted transition hover:border-accent hover:text-accent"
              >
                <CalendarPlus className="size-3.5" />
                Programmer
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
