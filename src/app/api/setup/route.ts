import { connection } from "next/server";
import { jsonError, readBody, str } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/** L'installation n'est proposée qu'une fois dans la vie du projet, tant qu'aucun membre n'existe. */
async function needsSetup(): Promise<boolean> {
  const admin = getAdminClient();
  const [flag, members] = await Promise.all([
    admin.from("app_settings").select("key").eq("key", "setup_done").maybeSingle(),
    admin.from("team_members").select("user_id", { count: "exact", head: true }),
  ]);
  if (flag.error) throw flag.error;
  if (members.error || members.count === null) throw members.error ?? new Error("Comptage impossible");
  return !flag.data && members.count === 0;
}

/** Indique si l'app attend la création du tout premier compte. */
export async function GET() {
  await connection();
  try {
    return Response.json({ needsSetup: await needsSetup() });
  } catch (e) {
    console.error(e);
    return jsonError("Vérification impossible.", 500);
  }
}

/** Crée le premier compte (propriétaire). Atomique : un seul appel peut réussir. */
export async function POST(req: Request) {
  try {
    if (!(await needsSetup())) return jsonError("Le compte principal existe déjà.", 403);
    const body = await readBody(req);
    const email = str(body, "email")?.toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("E-mail invalide.");
    if (password.length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");

    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return jsonError(error?.message ?? "Création impossible.", 400);

    const { error: claimErr } = await admin.rpc("claim_first_member", { p_user_id: data.user.id, p_email: email });
    if (claimErr) {
      // un autre appel a gagné la course (ou erreur) : on ne laisse pas de compte orphelin
      await admin.auth.admin.deleteUser(data.user.id);
      return jsonError(
        /setup_already_done/.test(claimErr.message) ? "Le compte principal existe déjà." : claimErr.message,
        403,
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error(e);
    return jsonError("Création impossible.", 500);
  }
}
