import type { NextRequest } from "next/server";
import { FOLDER_COLORS } from "@/lib/constants";
import type { Person } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail, handle, json, readObject } from "@/lib/api/http";
import { isNoneRef, loadPeople } from "@/lib/api/people";
import { normName } from "@/lib/api/resolve";
import { optColor, optText } from "@/lib/api/validate";

const personOut = (p: Person) => ({ id: p.id, name: p.name, color: p.color, position: p.position, created_at: p.created_at });

/** GET /api/v1/people : personnes (tags « Enzo », « Loys »…), triées par position puis nom. */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const people = await loadPeople(getAdminClient());
    return json({ people: people.map(personOut) });
  });
}

/** POST /api/v1/people { name, color? } → 201 { person } ; 409 si le nom existe déjà (casse, accents et espaces ignorés). */
export async function POST(req: NextRequest) {
  return handle(req, async () => {
    const body = await readObject(req);
    const name = (optText(body, "name", { max: 60 }) ?? "").replace(/\s+/g, " ");
    if (!name) throw new ApiError(400, "Le champ « name » est obligatoire (ex. « Enzo »).");
    if (/[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, "Le nom contient des caractères de contrôle.");
    if (isNoneRef(name)) throw new ApiError(400, `« ${name} » est réservé (il sert à retirer une attribution).`);
    const color = optColor(body);

    const sb = getAdminClient();
    const people = await loadPeople(sb);
    const dup = people.find((p) => normName(p.name) === normName(name));
    if (dup) throw new ApiError(409, `La personne « ${dup.name} » existe déjà.`, { person: personOut(dup) });

    const { data, error } = await sb
      .from("people")
      .insert({
        name,
        color: color ?? FOLDER_COLORS[people.length % FOLDER_COLORS.length],
        position: people.reduce((m, p) => Math.max(m, p.position + 1), 0),
      })
      .select("*")
      .single();
    if (error?.code === "23505") throw new ApiError(409, `La personne « ${name} » existe déjà.`);
    if (error) throw dbFail(error, "création de la personne");
    return json({ person: personOut(data as Person) }, 201);
  });
}
