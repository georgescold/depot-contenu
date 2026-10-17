import type { User } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase/admin";

export type TeamRole = "owner" | "member";

export interface Member {
  user: User;
  role: TeamRole;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** uuid normalisé en minuscules, ou erreur 400. */
export function parseUuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) throw new HttpError(400, `${what} invalide.`);
  return value.trim().toLowerCase();
}

/** Vérifie le jeton Supabase envoyé par l'app et que l'utilisateur fait partie de l'équipe. */
export async function requireMember(req: Request): Promise<Member | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: member } = await admin
    .from("team_members")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return member ? { user: data.user, role: (member.role as TeamRole) ?? "member" } : null;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Corps JSON sous forme d'objet (jamais null ni tableau). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v.trim() : undefined;
}

/**
 * Route réservée aux membres de l'équipe (ou au propriétaire avec `owner: true`) :
 * toujours une réponse JSON, même en cas d'exception.
 */
export function withMember(
  handler: (req: Request, member: Member) => Promise<Response>,
  opts: { owner?: boolean } = {},
) {
  return async (req: Request): Promise<Response> => {
    try {
      const member = await requireMember(req);
      if (!member) return jsonError("Non autorisé.", 401);
      if (opts.owner && member.role !== "owner") {
        return jsonError("Réservé au propriétaire du compte.", 403);
      }
      return await handler(req, member);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.message, e.status);
      console.error(e);
      return jsonError(e instanceof Error ? e.message : "Erreur interne.", 500);
    }
  };
}
