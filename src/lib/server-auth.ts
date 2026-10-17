import type { User } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase/admin";

/** Vérifie le jeton Supabase envoyé par l'app et que l'utilisateur fait partie de l'équipe. */
export async function requireMember(req: Request): Promise<User | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: member } = await admin
    .from("team_members")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return member ? data.user : null;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
