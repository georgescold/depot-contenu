import { ancestorsOf, type FolderIndex } from "./folders";

/**
 * À qui revient un contenu / une publication (tags « Enzo », « Loys »…).
 * Ordre : personne du contenu, sinon celle du compte de publication, sinon celle du dossier le plus proche.
 * Partagé par l'interface et le serveur.
 */

export type AssigneeSource = "content" | "account" | "folder";

export interface EffectiveAssignee {
  personId: string;
  source: AssigneeSource;
  /** dossier d'où vient l'attribution (source = "folder") */
  folderId?: string;
}

interface WithAssignee {
  assignee_id?: string | null;
}

export function effectiveAssignee(
  index: FolderIndex,
  content: WithAssignee & { folder_id: string },
  account?: WithAssignee | null,
): EffectiveAssignee | null {
  if (content.assignee_id) return { personId: content.assignee_id, source: "content" };
  if (account?.assignee_id) return { personId: account.assignee_id, source: "account" };
  const chain = ancestorsOf(index, content.folder_id);
  for (let i = chain.length - 1; i >= 0; i--) {
    const f = chain[i] as (typeof chain)[number] & WithAssignee;
    if (f.assignee_id) return { personId: f.assignee_id, source: "folder", folderId: f.id };
  }
  return null;
}

/** Valeur spéciale des filtres : contenus attribués à personne. */
export const UNASSIGNED = "none";

/**
 * Le contenu correspond-il au filtre personne ?
 * Oui si sa personne (contenu ou dossier) correspond, ou si l'une de ses publications revient à cette personne
 * (via le compte). `filter` = id d'une personne, ou UNASSIGNED.
 */
export function contentMatchesAssignee(
  index: FolderIndex,
  content: WithAssignee & { folder_id: string; publications: { account_id: string }[] },
  accountsById: Map<string, WithAssignee>,
  filter: string,
): boolean {
  const own = effectiveAssignee(index, content)?.personId ?? null;
  const perPub = content.publications.map(
    (p) => effectiveAssignee(index, content, accountsById.get(p.account_id))?.personId ?? null,
  );
  const all = [own, ...perPub];
  return filter === UNASSIGNED ? all.every((x) => x === null) : all.includes(filter);
}
