import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/lib/types";
import { chunk, fetchAll } from "./http";
import { accountLabel, candidatesForFolder, type FolderCtx } from "./resolve";

const MAX_WARNINGS = 20;

/**
 * Après un déplacement : publications des contenus de ces dossiers dont le compte n'est plus rattaché
 * au dossier du contenu ni à ses parents (`ctx` = arborescence APRÈS déplacement). Elles sont gardées, on prévient.
 */
export async function publicationsOutsideChain(
  sb: SupabaseClient,
  ctx: FolderCtx,
  accounts: Account[],
  folderIds: string[],
): Promise<string[]> {
  if (!folderIds.length) return [];
  const contents: { id: string; title: string; folder_id: string }[] = [];
  for (const part of chunk(folderIds, 100)) {
    contents.push(
      ...(await fetchAll<{ id: string; title: string; folder_id: string }>(
        (from, to) => sb.from("contents").select("id, title, folder_id").in("folder_id", part).order("id").range(from, to),
        "lecture des contenus",
      )),
    );
  }
  if (!contents.length) return [];
  const pubs: { content_id: string; account_id: string }[] = [];
  for (const part of chunk(contents.map((c) => c.id), 100)) {
    pubs.push(
      ...(await fetchAll<{ content_id: string; account_id: string }>(
        (from, to) => sb.from("publications").select("content_id, account_id").in("content_id", part).order("id").range(from, to),
        "lecture des publications",
      )),
    );
  }
  const byContent = new Map(contents.map((c) => [c.id, c]));
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const allowedCache = new Map<string, Set<string>>();
  const allowed = (folderId: string) => {
    let s = allowedCache.get(folderId);
    if (!s) {
      s = new Set(candidatesForFolder(ctx, accounts, folderId).map((c) => c.account.id));
      allowedCache.set(folderId, s);
    }
    return s;
  };
  const out: string[] = [];
  let extra = 0;
  for (const p of pubs) {
    const c = byContent.get(p.content_id);
    if (!c || allowed(c.folder_id).has(p.account_id)) continue;
    if (out.length >= MAX_WARNINGS) {
      extra++;
      continue;
    }
    const a = byAccount.get(p.account_id);
    out.push(
      `« ${c.title} » : la publication sur ${a ? accountLabel(a) : p.account_id} est conservée, mais ce compte n'est plus rattaché au dossier du contenu ni à ses parents.`,
    );
  }
  if (extra) out.push(`… et ${extra} autre(s) publication(s) dans le même cas.`);
  return out;
}
