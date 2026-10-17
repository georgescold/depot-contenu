"use client";

import { Eye, EyeOff, Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageBody, PageHeader, Splash } from "@/components/AppShell";
import { useData } from "@/components/data/DataProvider";
import { FolderPicker } from "@/components/FolderPicker";
import { Agenda } from "@/components/planning/Agenda";
import { MonthView } from "@/components/planning/MonthView";
import type { PlanItem } from "@/components/planning/PlanningRow";
import { ScheduleModal } from "@/components/planning/ScheduleModal";
import { Chip, Segmented, Select } from "@/components/ui";
import { PLATFORMS } from "@/lib/constants";
import { ancestorsOf, descendantIds, folderPath } from "@/lib/folders";
import { longDate } from "@/lib/format";
import { contentStatus, todayISO } from "@/lib/status";
import { useLocalState } from "@/lib/use-local-state";

export default function PlanningPage() {
  const { contents, accounts, accountById, index, ready } = useData();
  const [view, setView] = useLocalState<"agenda" | "mois">("planning.view", "agenda");
  const [folderId, setFolderId] = useLocalState("planning.folder", "");
  const [accountId, setAccountId] = useLocalState("planning.account", "");
  const [hidePosted, setHidePosted] = useLocalState("planning.hidePosted", false);
  const [scheduleDate, setScheduleDate] = useState<string | null>(null);

  const scope = useMemo(
    () => (folderId && index.byId.has(folderId) ? descendantIds(index, folderId) : null),
    [folderId, index],
  );

  // comptes proposés dans le filtre : ceux du périmètre choisi (et de ses parents)
  const accountOptions = useMemo(() => {
    if (!scope) return accounts;
    const chain = new Set([...scope, ...ancestorsOf(index, folderId).map((f) => f.id)]);
    return accounts.filter((a) => chain.has(a.folder_id));
  }, [accounts, scope, index, folderId]);
  const activeAccount = accountOptions.some((a) => a.id === accountId) ? accountId : "";

  const items = useMemo(() => {
    const out: PlanItem[] = [];
    for (const c of contents) {
      if (scope && !scope.has(c.folder_id)) continue;
      for (const p of c.publications) {
        if (!p.scheduled_date) continue;
        if (activeAccount && p.account_id !== activeAccount) continue;
        out.push({ pub: p, content: c, account: accountById.get(p.account_id) });
      }
    }
    return out.sort(
      (a, b) =>
        a.pub.scheduled_date!.localeCompare(b.pub.scheduled_date!) ||
        (a.pub.scheduled_time ?? "99").localeCompare(b.pub.scheduled_time ?? "99") ||
        a.content.title.localeCompare(b.content.title, "fr"),
    );
  }, [contents, scope, activeAccount, accountById]);

  const today = todayISO();
  const todayItems = items.filter((i) => i.pub.scheduled_date === today);
  const todayLeft = todayItems.filter((i) => !i.pub.posted).length;
  const unplanned = useMemo(
    () => contents.filter((c) => (!scope || scope.has(c.folder_id)) && contentStatus(c.publications) === "draft").length,
    [contents, scope],
  );

  if (!ready) return <Splash />;

  return (
    <>
      <PageHeader
        title="Planning"
        subtitle={
          <>
            {longDate(today)}
            {todayItems.length > 0 &&
              (todayLeft ? ` · ${todayLeft} à poster aujourd'hui` : " · tout est posté aujourd'hui 🎉")}
          </>
        }
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "agenda", label: "Agenda" },
              { value: "mois", label: "Mois" },
            ]}
          />
        }
      >
        <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          <FolderPicker
            allowEmpty
            value={folderId && index.byId.has(folderId) ? folderId : ""}
            onChange={(v) => {
              setFolderId(v);
              setAccountId("");
            }}
            className="h-9 w-auto max-w-56 shrink-0 md:max-w-xs"
          />
          <Select
            value={activeAccount}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-9 w-auto max-w-56 shrink-0 md:max-w-xs"
          >
            <option value="">Tous les comptes</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {PLATFORMS[a.platform].label} {a.handle} — {folderPath(index, a.folder_id)}
              </option>
            ))}
          </Select>
          <Chip active={hidePosted} onClick={() => setHidePosted(!hidePosted)}>
            {hidePosted ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {hidePosted ? "Postés masqués" : "Masquer les postés"}
          </Chip>
        </div>
      </PageHeader>

      <PageBody>
        {unplanned > 0 && (
          <Link
            href="/contenus?statut=draft"
            className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-sm transition hover:border-accent"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-warning-soft text-warning">
              <Inbox className="size-4" />
            </span>
            <span className="flex-1">
              <strong>{unplanned}</strong> contenu{unplanned > 1 ? "s" : ""} pas encore programmé
              {unplanned > 1 ? "s" : ""}
            </span>
            <span className="text-accent">Voir →</span>
          </Link>
        )}

        {view === "agenda" ? (
          <Agenda items={items} hidePosted={hidePosted} onSchedule={setScheduleDate} />
        ) : (
          <MonthView items={items} hidePosted={hidePosted} onSchedule={setScheduleDate} />
        )}
      </PageBody>

      <ScheduleModal date={scheduleDate} onClose={() => setScheduleDate(null)} folderFilter={folderId} />
    </>
  );
}
