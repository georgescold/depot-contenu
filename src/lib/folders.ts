import type { Account, Folder } from "./types";

export interface FolderIndex {
  byId: Map<string, Folder>;
  /** clé "" = racine */
  children: Map<string, Folder[]>;
}

const sortFolders = (a: Folder, b: Folder) =>
  a.position - b.position || a.name.localeCompare(b.name, "fr");

export function buildFolderIndex(folders: Folder[]): FolderIndex {
  const byId = new Map<string, Folder>();
  const children = new Map<string, Folder[]>();
  for (const f of folders) {
    byId.set(f.id, f);
    const key = f.parent_id ?? "";
    const list = children.get(key) ?? [];
    list.push(f);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort(sortFolders);
  return { byId, children };
}

export function childrenOf(index: FolderIndex, id: string | null): Folder[] {
  return index.children.get(id ?? "") ?? [];
}

/** De la racine jusqu'au dossier lui-même. */
export function ancestorsOf(index: FolderIndex, id: string | null | undefined): Folder[] {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let cur = id ? index.byId.get(id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_id ? index.byId.get(cur.parent_id) : undefined;
  }
  return chain;
}

export function rootOf(index: FolderIndex, id: string | null | undefined): Folder | undefined {
  return ancestorsOf(index, id)[0];
}

/** Le dossier et tous ses sous-dossiers. */
export function descendantIds(index: FolderIndex, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of childrenOf(index, cur)) stack.push(c.id);
  }
  return out;
}

export function folderPath(index: FolderIndex, id: string | null | undefined, sep = " › "): string {
  return ancestorsOf(index, id)
    .map((f) => f.name)
    .join(sep);
}

/** Couleur héritée : celle du projet racine. */
export function folderColor(index: FolderIndex, id: string | null | undefined): string {
  return rootOf(index, id)?.color ?? "#64748b";
}

/** Comptes utilisables pour un dossier : ceux du dossier et de ses parents. */
export function accountsForFolder(
  index: FolderIndex,
  accounts: Account[],
  folderId: string | null | undefined,
): Account[] {
  const chain = ancestorsOf(index, folderId);
  const depth = new Map(chain.map((f, i) => [f.id, i]));
  return accounts
    .filter((a) => depth.has(a.folder_id))
    .sort(
      (a, b) =>
        depth.get(a.folder_id)! - depth.get(b.folder_id)! ||
        a.position - b.position ||
        a.platform.localeCompare(b.platform),
    );
}

/** Liste à plat triée en profondeur, pratique pour les <select>. */
export function flattenTree(index: FolderIndex): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of childrenOf(index, parent)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
