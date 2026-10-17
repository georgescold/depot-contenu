"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Client navigateur : session gardée dans le localStorage, protégé par la RLS. */
export function supabase(): SupabaseClient {
  if (client) return client;
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: true, autoRefreshToken: true, storageKey: "depot-contenu-auth" } },
  );
  return client;
}
