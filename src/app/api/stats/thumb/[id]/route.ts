import { connection } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Miniature d'un post collecté, relayée par le serveur : Instagram (et parfois TikTok) interdit d'afficher
 * ses images depuis un autre site. On ne relaie que l'URL enregistrée pour ce post, et seulement vers
 * les serveurs d'images des plateformes (pas de proxy ouvert).
 */
const ALLOWED_HOSTS = /(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ibyteimg\.com|ytimg\.com|ggpht\.com)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Introuvable", { status: 404 });

  const { data } = await getAdminClient().from("post_stats").select("thumbnail_url").eq("id", id).maybeSingle();
  const src = data?.thumbnail_url as string | undefined;
  let url: URL;
  try {
    url = new URL(src ?? "");
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.test(url.hostname)) return new Response("Introuvable", { status: 404 });

  const upstream = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) return new Response("Miniature expirée", { status: 404 });

  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      // les liens des plateformes expirent : on garde la copie un jour dans le cache du navigateur et de Vercel
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
