"use client";

import { supabase } from "./supabase/browser";

/** fetch vers nos routes /api avec le jeton de session de l'utilisateur. */
export async function authedFetch<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Erreur ${res.status}`);
  return json as T;
}
