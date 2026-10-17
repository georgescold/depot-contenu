"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FOLDER_COLORS } from "@/lib/constants";
import { descendantIds } from "@/lib/folders";
import type { Folder } from "@/lib/types";
import { useData } from "./data/DataProvider";
import { FolderPicker } from "./FolderPicker";
import { Button, cn, Field, Input, Modal, Textarea } from "./ui";

/** Création ou modification d'un dossier (projet, sous-projet, angle…). */
type Props = {
  open: boolean;
  onClose: () => void;
  /** dossier à modifier ; absent = création */
  folder?: Folder | null;
  /** parent pour une création (null = nouveau projet racine) */
  parentId?: string | null;
  onSaved?: (f: Folder) => void;
};

export function FolderFormModal(props: Props) {
  return props.open ? <FolderForm {...props} /> : null;
}

function FolderForm({ open, onClose, folder, parentId, onSaved }: Props) {
  const { index, createFolder, updateFolder } = useData();
  const initialParent = folder ? folder.parent_id : parentId ?? null;
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(() => {
    const inherited = initialParent ? index.byId.get(initialParent)?.color : undefined;
    const nextRootColor = FOLDER_COLORS[(index.children.get("")?.length ?? 0) % FOLDER_COLORS.length];
    return folder?.color ?? inherited ?? nextRootColor;
  });
  const [description, setDescription] = useState(folder?.description ?? "");
  const [parent, setParent] = useState(initialParent ?? "");
  const [busy, setBusy] = useState(false);

  const isRoot = !parent;
  const parentName = parent ? index.byId.get(parent)?.name : null;
  const title = folder ? "Modifier le dossier" : isRoot ? "Nouveau projet" : `Nouveau dossier dans « ${parentName} »`;
  const exclude = folder ? descendantIds(index, folder.id) : undefined;

  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const submit = async () => {
    const n = name.trim();
    if (!n || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let saved: Folder | null = null;
    if (folder) {
      const ok = await updateFolder(folder.id, { name: n, color, description, parent_id: parent || null });
      if (ok) saved = { ...folder, name: n, color, description, parent_id: parent || null };
    } else {
      saved = await createFolder({ name: n, color, description, parent_id: parent || null });
    }
    busyRef.current = false;
    if (!alive.current) return; // fenêtre fermée pendant l'enregistrement : on ne navigue pas
    setBusy(false);
    if (!saved) return; // erreur affichée : la fenêtre reste ouverte pour corriger
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>
            {folder ? "Enregistrer" : "Créer"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Nom">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isRoot ? "Ex. Compaatible" : "Ex. Angle jalousie"}
          />
        </Field>
        <Field label="Couleur" group>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition",
                  color === c && "ring-2 ring-ink",
                )}
                style={{ background: c }}
              >
                {color === c && <Check className="size-4 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description (facultatif)" hint="Cible, promesse, ton… pour te rappeler l'angle.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20" />
        </Field>
        {folder && (
          <Field label="Rangé dans">
            <FolderPicker allowEmpty emptyLabel="— Racine (projet principal)" value={parent} onChange={setParent} exclude={exclude} />
          </Field>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
