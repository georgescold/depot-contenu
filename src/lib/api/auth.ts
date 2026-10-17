import { after } from "next/server";
import { API_KEY_PREFIX, hashApiKey } from "@/lib/apikey";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, dbFail } from "./errors";

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const HOW_TO_GET_KEY = "Crée une clé dans l'app (Réglages → Clés API).";

/** Extrait la clé de `Authorization: Bearer …` ou de `X-API-Key`. */
export function extractApiKey(req: Request): string {
  const auth = req.headers.get("authorization")?.trim();
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return (m ? m[1] : auth).trim();
  }
  return req.headers.get("x-api-key")?.trim() ?? "";
}

export async function authenticate(req: Request): Promise<ApiKeyInfo> {
  const key = extractApiKey(req);
  if (!key) {
    throw new ApiError(
      401,
      `Clé API manquante : envoie l'en-tête « Authorization: Bearer dpc_… » (ou « X-API-Key »). ${HOW_TO_GET_KEY}`,
    );
  }
  if (!key.startsWith(API_KEY_PREFIX)) {
    throw new ApiError(401, `Clé API invalide : elle doit commencer par « ${API_KEY_PREFIX} ». ${HOW_TO_GET_KEY}`);
  }

  const sb = getAdminClient();
  const hash = await hashApiKey(key);
  const { data, error } = await sb
    .from("api_keys")
    .select("id, name, prefix, created_at, last_used_at, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw dbFail(error, "vérification de la clé API");
  if (!data) throw new ApiError(401, `Clé API inconnue. ${HOW_TO_GET_KEY}`);
  if (data.revoked_at) throw new ApiError(401, `Cette clé API a été révoquée. ${HOW_TO_GET_KEY}`);

  // Mise à jour de « dernière utilisation » après l'envoi de la réponse.
  after(async () => {
    const { error: e } = await sb
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    if (e) console.error("[api/v1] last_used_at :", e.message);
  });

  return {
    id: data.id,
    name: data.name,
    prefix: data.prefix,
    created_at: data.created_at,
    last_used_at: data.last_used_at,
  };
}
