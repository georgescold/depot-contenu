"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { FORMATS } from "@/lib/constants";
import { accountsForFolder, descendantIds, folderColor, folderPath } from "@/lib/folders";
import { longDate } from "@/lib/format";
import { contentStatus, STATUS_INFO } from "@/lib/status";
import { useData } from "../data/DataProvider";
import { Thumb } from "../Thumb";
import { Button, cn, Field, Input, Modal, PlatformBadge, Pill } from "../ui";

/** Programmer un contenu existant à une date, sur un ou plusieurs comptes. */
type Props = { date: string | null; onClose: () => void; folderFilter?: string };

export function ScheduleModal(props: Props) {
  return props.date ? <ScheduleForm key={props.date} {...props} /> : null;
}

function ScheduleForm({ date, onClose, folderFilter }: Props) {
  const { contents, index, accounts, savePublication } = useData();
  const [q, setQ] = useState("");
  const [contentId, setContentId] = useState("");
  const [day, setDay] = useState(date ?? "");
  const [time, setTime] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const scope = folderFilter && index.byId.has(folderFilter) ? descendantIds(index, folderFilter) : null;
  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rank = { draft: 0, partial: 1, scheduled: 2, late: 3, posted: 4 } as const;
    return contents
      .filter((c) => (!scope || scope.has(c.folder_id)) && (!needle || c.title.toLowerCase().includes(needle)))
      .map((c) => ({ c, status: contentStatus(c.publications) }))
      .filter((x) => x.status !== "posted")
      .sort((a, b) => rank[a.status] - rank[b.status] || b.c.created_at.localeCompare(a.c.created_at))
      .slice(0, 40);
  }, [contents, q, scope]);

  const content = contents.find((c) => c.id === contentId);
  const options = content ? accountsForFolder(index, accounts, content.folder_id) : [];

  const choose = (id: string) => {
    setContentId(id);
    const c = contents.find((x) => x.id === id);
    if (!c) return;
    const opts = accountsForFolder(index, accounts, c.folder_id);
    // présélection : les comptes pas encore programmés pour ce contenu
    const free = opts.filter((a) => !c.publications.some((p) => p.account_id === a.id && p.scheduled_date));
    setPicked((free.length ? free : opts).map((a) => a.id));
  };

  const submit = async () => {
    if (!content || !picked.length || !day) return;
    setBusy(true);
    await Promise.all(
      picked.map((accId) =>
        savePublication(content.id, accId, { scheduled_date: day, scheduled_time: time ? `${time}:00` : null }),
      ),
    );
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open={!!date}
      onClose={onClose}
      title={date ? `Programmer · ${longDate(day || date)}` : ""}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={busy} disabled={!content || !picked.length || !day} onClick={submit}>
            Programmer
          </Button>
        </>
      }
    >
      {!content ? (
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un contenu…" className="pl-9" />
          </div>
          {candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              Aucun contenu à programmer. Crée d&apos;abord un contenu avec le bouton +.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map(({ c, status }) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => choose(c.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line p-2 text-left transition hover:border-accent"
                  >
                    <Thumb content={c} color={folderColor(index, c.folder_id)} className="size-11 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="truncate text-xs text-muted">
                        {FORMATS[c.format].label} · {folderPath(index, c.folder_id)}
                      </p>
                    </div>
                    <Pill tone={STATUS_INFO[status].tone}>{STATUS_INFO[status].label}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
            <Thumb content={content} color={folderColor(index, content.folder_id)} className="size-11 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{content.title}</p>
              <p className="truncate text-xs text-muted">{folderPath(index, content.folder_id)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setContentId("")}>
              Changer
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jour">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Heure (facultatif)">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Sur quels comptes ?">
            {options.length ? (
              <div className="flex flex-wrap gap-2">
                {options.map((a) => {
                  const on = picked.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                      className={cn(
                        "flex h-10 items-center gap-2 rounded-xl border px-3 text-sm transition",
                        on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted",
                      )}
                    >
                      <PlatformBadge platform={a.platform} size="sm" />
                      {a.handle || a.platform}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Ce projet n&apos;a pas encore de compte. Ajoute-en un depuis la page du projet.
              </p>
            )}
          </Field>
        </div>
      )}
    </Modal>
  );
}
