import { ARCHIVE_DELAY_CHOICES, getArchiveDelay, setArchiveDelay } from "@/lib/archive";
import { jsonError, readBody, withMember } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/** Réglages partagés de l'app (lecture : membres). */
export const POST = withMember(async (req, member) => {
  const body = await readBody(req);
  const admin = getAdminClient();

  // modification (propriétaire uniquement)
  if ("archive_after_days" in body) {
    if (member.role !== "owner") return jsonError("Réservé au propriétaire du compte.", 403);
    const v = body.archive_after_days;
    const days = v === null ? null : Number(v);
    if (days !== null && !(ARCHIVE_DELAY_CHOICES as readonly number[]).includes(days)) {
      return jsonError("Délai invalide.");
    }
    await setArchiveDelay(admin, days);
  }
  return Response.json({ archive_after_days: await getArchiveDelay(admin) });
});
