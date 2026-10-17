"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { effectiveAssignee } from "@/lib/assignee";
import { FOLDER_COLORS, FORMAT_LIST, FORMATS } from "@/lib/constants";
import { useLocalState } from "@/lib/use-local-state";
import type { Format } from "@/lib/types";
import { useData } from "./data/DataProvider";
import { FolderPicker } from "./FolderPicker";
import { inheritedLabel, PersonPicker } from "./people";
import { Button, Chip, Field, Input, Modal } from "./ui";

type Props = { open: boolean; onClose: () => void; defaultFolderId: string | null };

/** Le formulaire n'est monté qu'à l'ouverture : il repart toujours de valeurs fraîches. */
export function NewContentModal(props: Props) {
  return props.open ? <NewContentForm {...props} /> : null;
}

function NewContentForm({ open, onClose, defaultFolderId }: Props) {
  const router = useRouter();
  const { folders, index, people, personById, createContent, createFolder } = useData();
  const [lastFolder, setLastFolder] = useLocalState<string>("new.lastFolder", "");
  const [lastFormat, setLastFormat] = useLocalState<Format>("new.lastFormat", "short");
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState(() => {
    const candidate = defaultFolderId ?? lastFolder;
    return candidate && index.byId.has(candidate) ? candidate : "";
  });
  const [format, setFormat] = useState<Format>(lastFormat);
  const [projectName, setProjectName] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const submit = async () => {
    if (busyRef.current) return; // double appui / double Entrée
    busyRef.current = true;
    setBusy(true);
    const done = () => {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    };
    let target = folderId;
    if (!folders.length) {
      const name = projectName.trim();
      if (!name) return done();
      const f = await createFolder({ name, parent_id: null, color: FOLDER_COLORS[0] });
      if (!f) return done();
      target = f.id;
    }
    if (!target) return done();
    const c = await createContent({ folder_id: target, title: title.trim() || "Sans titre", format, assignee_id: assignee });
    done();
    if (!c) return;
    setLastFolder(target);
    setLastFormat(format);
    if (!alive.current) return; // fenêtre fermée entre-temps : le contenu existe, on ne navigue pas
    onClose();
    router.push(`/contenus/${c.id}`);
  };

  const canSubmit = folders.length ? !!folderId : !!projectName.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nouveau contenu"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!canSubmit}>
            Créer et ajouter les fichiers
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <Field label="Titre (pour t'y retrouver)">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Didier visite un T3 à Lyon"
          />
        </Field>
        {folders.length ? (
          <Field label="Dossier (projet, sous-projet ou angle)">
            <FolderPicker value={folderId} onChange={setFolderId} />
          </Field>
        ) : (
          <Field label="Nom de ton premier projet" hint="Tu pourras créer des sous-projets et des angles ensuite.">
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Ex. Compaatible" />
          </Field>
        )}
        {people.length > 0 && (
          <Field label="Pour qui ?">
            <PersonPicker
              value={assignee}
              onChange={setAssignee}
              inherited={folderId ? inheritedLabel(effectiveAssignee(index, { folder_id: folderId, assignee_id: null }), personById) : null}
            />
          </Field>
        )}
        <Field label="Format" group>
          <div className="flex flex-wrap gap-2">
            {FORMAT_LIST.map((f) => (
              <Chip key={f} active={format === f} onClick={() => setFormat(f)}>
                {FORMATS[f].label}
              </Chip>
            ))}
          </div>
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
