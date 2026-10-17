import { connection } from "next/server";
import { jsonError } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

async function memberCount() {
  const { count, error } = await getAdminClient()
    .from("team_members")
    .select("user_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

/** Indique si l'app attend la création du tout premier compte. */
export async function GET() {
  await connection();
  return Response.json({ needsSetup: (await memberCount()) === 0 });
}

/** Crée le premier compte (uniquement tant que l'équipe est vide). */
export async function POST(req: Request) {
  if ((await memberCount()) > 0) return jsonError("Le compte principal existe déjà.", 403);
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("E-mail invalide.");
  if (password.length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");

  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) return jsonError(error?.message ?? "Création impossible.", 400);
  const { error: mErr } = await admin.from("team_members").insert({ user_id: data.user.id, email });
  if (mErr) return jsonError(mErr.message, 500);
  return Response.json({ ok: true });
}
