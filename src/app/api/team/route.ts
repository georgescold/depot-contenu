import { HttpError, jsonError, parseUuid, readBody, str, withMember } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase/admin";

/** Ajoute un membre (propriétaire uniquement) : crée son compte avec un mot de passe provisoire. */
export const POST = withMember(
  async (req) => {
    const body = await readBody(req);
    const email = str(body, "email")?.toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return jsonError("E-mail invalide.");
    if (password.length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");

    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) {
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return jsonError(
        exists ? "Un compte existe déjà avec cet e-mail." : error?.message ?? "Création impossible.",
        exists ? 409 : 400,
      );
    }
    const { error: mErr } = await admin.from("team_members").insert({ user_id: data.user.id, email, role: "member" });
    if (mErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      return jsonError(mErr.message, 500);
    }
    return Response.json({ ok: true, user_id: data.user.id });
  },
  { owner: true },
);

/** Change un mot de passe : le sien, ou celui d'un membre si on est propriétaire. */
export const PATCH = withMember(async (req, me) => {
  const body = await readBody(req);
  const userId = parseUuid(body.user_id, "Membre");
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) return jsonError("Le mot de passe doit faire au moins 8 caractères.");
  if (userId !== me.user.id && me.role !== "owner") {
    return jsonError("Seul le propriétaire peut changer le mot de passe d'un autre membre.", 403);
  }
  const admin = getAdminClient();
  const { data: member } = await admin.from("team_members").select("user_id").eq("user_id", userId).maybeSingle();
  if (!member) return jsonError("Membre introuvable.", 404);
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return jsonError(error.message, 400);
  return Response.json({ ok: true });
});

/** Retire un membre (propriétaire uniquement) : révoque ses clés API puis supprime son compte. */
export const DELETE = withMember(
  async (req, me) => {
    const userId = parseUuid(new URL(req.url).searchParams.get("user_id"), "Membre");
    if (userId === me.user.id) return jsonError("Tu ne peux pas te retirer toi-même.");
    const admin = getAdminClient();
    const { error } = await admin.rpc("remove_team_member", { p_user_id: userId });
    if (error) {
      if (/member_not_found/.test(error.message)) throw new HttpError(404, "Membre introuvable.");
      if (/last_member/.test(error.message)) throw new HttpError(409, "Impossible de retirer le dernier membre.");
      throw new HttpError(500, error.message);
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) console.error("Compte retiré de l'équipe mais non supprimé :", delErr.message);
    return Response.json({ ok: true });
  },
  { owner: true },
);
