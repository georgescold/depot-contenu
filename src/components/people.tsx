"use client";

import { UserRound } from "lucide-react";
import type { EffectiveAssignee } from "@/lib/assignee";
import { UNASSIGNED } from "@/lib/assignee";
import type { Person } from "@/lib/types";
import { useData } from "./data/DataProvider";
import { Chip, cn, Select } from "./ui";

/** Pastille ronde avec l'initiale d'une personne (et son nom si `withName`). */
export function PersonBadge({
  person,
  withName,
  size = "sm",
  muted,
  className,
}: {
  person: Person | undefined | null;
  withName?: boolean;
  size?: "xs" | "sm" | "md";
  /** attribution héritée (compte ou dossier) : affichage atténué */
  muted?: boolean;
  className?: string;
}) {
  if (!person) return null;
  const initial = (Array.from(person.name.trim())[0] ?? "?").toUpperCase();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={person.name}>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
          size === "xs" && "size-4 text-[9px]",
          size === "sm" && "size-5 text-[10px]",
          size === "md" && "size-7 text-xs",
          muted && "opacity-60",
        )}
        style={{ background: person.color }}
      >
        {initial}
      </span>
      {withName && <span className={cn("truncate", muted && "text-muted")}>{person.name}</span>}
    </span>
  );
}

const SOURCE_LABEL: Record<EffectiveAssignee["source"], string> = {
  content: "",
  account: "via le compte",
  folder: "via le dossier",
};

/**
 * Choix de la personne responsable. `inherited` : ce qui s'applique si on laisse vide
 * (affiché dans l'option « — »), pour qu'on voie d'où vient l'attribution.
 */
export function PersonPicker({
  value,
  onChange,
  inherited,
  emptyLabel = "Personne",
  className,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  inherited?: { person: Person; label: string } | null;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { people } = useData();
  return (
    <Select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className={className}
    >
      <option value="">{inherited ? `— ${inherited.person.name} (${inherited.label})` : `— ${emptyLabel}`}</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export function inheritedLabel(eff: EffectiveAssignee | null, people: Map<string, Person>) {
  if (!eff || eff.source === "content") return null;
  const person = people.get(eff.personId);
  return person ? { person, label: SOURCE_LABEL[eff.source] } : null;
}

/** Puces de filtre par personne : Tous / Enzo / Loys / Non attribué. */
export function PersonFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { people } = useData();
  if (!people.length) return null;
  return (
    <>
      <Chip active={!value} onClick={() => onChange("")}>
        <UserRound className="size-3.5" />
        Tout le monde
      </Chip>
      {people.map((p) => (
        <Chip key={p.id} active={value === p.id} onClick={() => onChange(value === p.id ? "" : p.id)} color={p.color}>
          {p.name}
        </Chip>
      ))}
      <Chip active={value === UNASSIGNED} onClick={() => onChange(value === UNASSIGNED ? "" : UNASSIGNED)}>
        Non attribué
      </Chip>
    </>
  );
}
