"use client";

import { flattenTree } from "@/lib/folders";
import { useData } from "./data/DataProvider";
import { Select } from "./ui";

/** Liste déroulante de tous les dossiers, indentée selon la hiérarchie. */
export function FolderPicker({
  value,
  onChange,
  allowEmpty,
  emptyLabel = "Tous les projets",
  exclude,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** dossiers à masquer (ex. le dossier lui-même et ses enfants quand on le déplace) */
  exclude?: Set<string>;
  className?: string;
}) {
  const { index } = useData();
  const rows = flattenTree(index).filter((r) => !exclude?.has(r.folder.id));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {!allowEmpty && !value && (
        <option value="" disabled>
          Choisir un dossier…
        </option>
      )}
      {rows.map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>
          {"   ".repeat(depth)}
          {depth > 0 ? "↳ " : ""}
          {folder.name}
        </option>
      ))}
    </Select>
  );
}
