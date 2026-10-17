import { jsonError, requireMember } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/** Ajoute un membre : crée son compte (e-mail + mot de passe provisoire). */
export async function POST(req: Request) {
  const me = await requireMember(req);
  if (!me) return jsonError("Non autorisé.", 401);
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("E-mail invalide.");
  if (password.length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");

  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return jsonError(exists ? "Un compte existe déjà avec cet e-mail." : error?.message ?? "Création impossible.", exists ? 409 : 400);
  }
  const { error: mErr } = await admin.from("team_members").insert({ user_id: data.user.id, email });
  if (mErr) return jsonError(mErr.message, 500);
  return Response.json({ ok: true, user_id: data.user.id });
}

/** Change le mot de passe d'un membre. */
export async function PATCH(req: Request) {
  const me = await requireMember(req);
  if (!me) return jsonError("Non autorisé.", 401);
  const body = (await req.json().catch(() => ({}))) as { user_id?: string; password?: string };
  if (!body.user_id) return jsonError("Membre manquant.");
  if ((body.password ?? "").length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");
  const admin = getAdminClient();
  const { data: member } = await admin.from("team_members").select("user_id").eq("user_id", body.user_id).maybeSingle();
  if (!member) return jsonError("Membre introuvable.", 404);
  const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true });
}

/** Retire un membre (et supprime son compte de connexion). */
export async function DELETE(req: Request) {
  const me = await requireMember(req);
  if (!me) return jsonError("Non autorisé.", 401);
  const userId = new URL(req.url).searchParams.get("user_id");
  if (!userId) return jsonError("Membre manquant.");
  if (userId === me.id) return jsonError("Tu ne peux pas te retirer toi-même.");
  const admin = getAdminClient();
  const { data: member } = await admin.from("team_members").select("user_id").eq("user_id", userId).maybeSingle();
  if (!member) return jsonError("Membre introuvable.", 404);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true });
}
