import type { SupabaseClient } from "@supabase/supabase-js";
import type { EffectiveAssignee } from "@/lib/assignee";
import { UNASSIGNED } from "@/lib/assignee";
import type { Person } from "@/lib/types";
import { ApiError } from "./errors";
import { fetchAll } from "./http";
import { normName } from "./resolve";
import { isUuid } from "./validate";

/** Personnes (tags « Enzo », « Loys »…), triées par position puis nom. */
export async function loadPeople(sb: SupabaseClient): Promise<Person[]> {
  const rows = await fetchAll<Person>(
    (from, to) => sb.from("people").select("*").order("position").order("name").order("id").range(from, to),
    "lecture des personnes",
  );
  return rows;
}

export type PeopleMap = Map<string, Person>;
export const peopleMap = (people: Person[]): PeopleMap => new Map(people.map((p) => [p.id, p]));

/** { id, name } de la personne attribuée, ou null (aussi si elle a été supprimée entre-temps). */
export function personJson(people: PeopleMap, id: string | null | undefined): { id: string; name: string } | null {
  if (!id) return null;
  const p = people.get(id);
  return p ? { id: p.id, name: p.name } : null;
}

/** Personne effective (contenu → compte → dossier) : { id, name, source[, folder_id] } ou null. */
export function effectiveJson(people: PeopleMap, eff: EffectiveAssignee | null) {
  if (!eff) return null;
  const p = people.get(eff.personId);
  if (!p) return null;
  return { id: p.id, name: p.name, source: eff.source, ...(eff.folderId ? { folder_id: eff.folderId } : {}) };
}

const NONE_WORDS = new Set([UNASSIGNED, "aucun", "aucune", "null", "personne"]);

/** « none », null, "" → retirer l'attribution. */
export function isNoneRef(ref: unknown): boolean {
  if (ref === null) return true;
  return typeof ref === "string" && (ref.trim() === "" || NONE_WORDS.has(ref.trim().toLowerCase()));
}

function listNames(people: Person[]): string {
  return people.length ? people.map((p) => p.name).join(", ") : "(aucune)";
}

/**
 * Résout une personne par id ou par nom (sans casse, accents ni espaces en trop).
 * undefined → non fourni ; null → retirer l'attribution ; sinon l'id. Jamais de création implicite.
 */
export function resolvePerson(people: Person[], ref: unknown, label = "assignee"): string | null | undefined {
  if (ref === undefined) return undefined;
  if (isNoneRef(ref)) return null;
  if (typeof ref !== "string") throw new ApiError(400, `« ${label} » doit être un nom de personne, un id ou "none".`);
  const raw = ref.trim();
  if (isUuid(raw)) {
    const p = people.find((x) => x.id === raw.toLowerCase());
    if (!p) throw new ApiError(404, `Aucune personne avec l'id ${raw}. Personnes existantes : ${listNames(people)}.`, { people: people.map((x) => ({ id: x.id, name: x.name })) });
    return p.id;
  }
  const matches = people.filter((p) => normName(p.name) === normName(raw));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new ApiError(409, `Plusieurs personnes correspondent à « ${raw} » : utilise l'id.`, {
      choices: matches.map((p) => ({ id: p.id, name: p.name })),
    });
  }
  throw new ApiError(
    404,
    `Personne « ${raw} » inconnue. Personnes existantes : ${listNames(people)}. ` +
      `Pour en ajouter une : POST /api/v1/people { "name": "${raw}" } (CLI : people add "${raw}").`,
    { people: people.map((p) => ({ id: p.id, name: p.name })) },
  );
}

/** Pour les filtres : id de la personne, ou UNASSIGNED (« none »). */
export function resolvePersonFilter(people: Person[], ref: string): string {
  const id = resolvePerson(people, ref, "assignee");
  return id ?? UNASSIGNED;
}
