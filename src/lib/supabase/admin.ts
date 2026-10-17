import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client « service role » : contourne la RLS.
 * À n'utiliser QUE dans les route handlers (jamais dans un composant client).
 */
let admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Variables Supabase manquantes (URL ou SERVICE_ROLE_KEY)");
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
