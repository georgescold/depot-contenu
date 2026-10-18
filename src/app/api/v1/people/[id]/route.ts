import type { NextRequest } from "next/server";
import type { Person } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { checkPersonName, loadPeople, resolvePerson } from "@/lib/api/people";
import { decodeRefParam, normName } from "@/lib/api/resolve";
import { optColor, optText, parseBool } from "@/lib/api/validate";

// Type explicite (équivalent de RouteContext<"/api/v1/people/[id]">) : indépendant des types du dernier build.
type Ctx = { params: Promise<{ id: string }> };

const personOut = (p: Person) => ({ id: p.id, name: p.name, color: p.color, position: p.position, created_at: p.created_at });

/** `:id` = id ou nom (casse, accents et espaces ignorés). */
async function findPerson(raw: string): Promise<{ person: Person; people: Person[] }> {
  const sb = getAdminClient();
  const people = await loadPeople(sb);
  const id = resolvePerson(people, decodeRefParam(raw), "id");
  if (!id) throw new ApiError(400, "Précise la personne (nom ou id).");
  return { person: people.find((p) => p.id === id)!, people };
}

/** PATCH /api/v1/people/:id { name?, color? } → { person } ; doublon 409, « none » réservé 400. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const body = await readObject(req);
    const { person, people } = await findPerson((await ctx.params).id);
    const patch: Record<string, unknown> = {};
    const rawName = optText(body, "name", { max: 200 });
    if (rawName !== undefined) {
      const name = checkPersonName(rawName);
      const dup = people.find((p) => p.id !== person.id && normName(p.name) === normName(name));
      if (dup) throw new ApiError(409, `La personne « ${dup.name} » existe déjà.`);
      patch.name = name;
    }
    const color = optColor(body);
    if (color !== undefined) patch.color = color;
    if (!Object.keys(patch).length) throw new ApiError(400, "Rien à modifier : fournis name et/ou color (#rrggbb).");

    const { data, error } = await getAdminClient().from("people").update(patch).eq("id", person.id).select("*").single();
    if (error?.code === "23505") throw new ApiError(409, `La personne « ${patch.name} » existe déjà.`);
    if (error) throw dbFail(error, "mise à jour de la personne");
    return json({ person: personOut(data as Person), previous_name: person.name });
  });
}

/**
 * DELETE /api/v1/people/:id[?dry_run=true] : supprime la personne ; ses contenus, comptes et dossiers repassent
 * en « non attribué » (on delete set null). Renvoie combien d'attributions sont retirées.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return handle(req, async () => {
    const { person } = await findPerson((await ctx.params).id);
    const dryRun = parseBool(req.nextUrl.searchParams.get("dry_run") ?? "") === true;
    const sb = getAdminClient();
    const count = async (table: "contents" | "accounts" | "folders") => {
      const { count: n, error } = await sb.from(table).select("id", { count: "exact", head: true }).eq("assignee_id", person.id);
      if (error) throw dbFail(error, `comptage (${table})`);
      return n ?? 0;
    };
    const [contents, accounts, folders] = await Promise.all([count("contents"), count("accounts"), count("folders")]);
    const summary = { person: { id: person.id, name: person.name }, unassigned: { contents, accounts, folders } };
    if (dryRun) return json({ dry_run: true, deleted: false, ...summary });

    const { error } = await sb.from("people").delete().eq("id", person.id);
    if (error) throw dbFail(error, "suppression de la personne");
    return json({ deleted: true, ...summary });
  });
}
