"use client";

import { useState } from "react";
import { PLATFORM_LIST, PLATFORMS } from "@/lib/constants";
import type { Account, Platform } from "@/lib/types";
import { effectiveAssignee } from "@/lib/assignee";
import { useData } from "./data/DataProvider";
import { inheritedLabel, PersonPicker } from "./people";
import { Button, cn, Field, Input, Modal, PlatformBadge } from "./ui";

type Props = { open: boolean; onClose: () => void; folderId: string; account?: Account | null };

export function AccountFormModal(props: Props) {
  return props.open ? <AccountForm {...props} /> : null;
}

function AccountForm({ open, onClose, folderId, account }: Props) {
  const { createAccount, updateAccount, deleteAccount, index, personById } = useData();
  const [platform, setPlatform] = useState<Platform>(account?.platform ?? "instagram");
  const [handle, setHandle] = useState(account?.handle ?? "");
  const [url, setUrl] = useState(account?.url ?? "");
  const [assignee, setAssignee] = useState<string | null>(account?.assignee_id ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const h = handle.trim();
    const normalized = h && !h.startsWith("@") && platform !== "youtube" && platform !== "other" ? `@${h}` : h;
    const cleanUrl = /^https?:\/\//i.test(url.trim()) || !url.trim() ? url.trim() : `https://${url.trim()}`;
    const ok = account
      ? await updateAccount(account.id, { platform, handle: normalized, url: cleanUrl, assignee_id: assignee })
      : !!(await createAccount({ folder_id: folderId, platform, handle: normalized, url: cleanUrl, assignee_id: assignee }));
    setBusy(false);
    if (ok) onClose();
  };

  const remove = async () => {
    if (!account) return;
    if (!confirm("Supprimer ce compte ? Les publications prévues sur ce compte seront supprimées (les contenus restent).")) return;
    if (await deleteAccount(account.id)) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? "Modifier le compte" : "Ajouter un compte"}
      footer={
        <>
          {account && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Supprimer
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {account ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Plateforme" group>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PLATFORM_LIST.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-xl border px-2.5 text-sm transition",
                  platform === p ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink",
                )}
              >
                <PlatformBadge platform={p} size="sm" />
                {PLATFORMS[p].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nom du compte" hint="Ex. @didier.immo, ou le nom de la chaîne YouTube">
          <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@moncompte" autoCapitalize="none" />
        </Field>
        <Field label="Qui poste sur ce compte ?" hint="Les publications sur ce compte lui reviennent, sauf si le contenu est attribué à quelqu'un d'autre.">
          <PersonPicker
            value={assignee}
            onChange={setAssignee}
            inherited={inheritedLabel(effectiveAssignee(index, { folder_id: folderId, assignee_id: null }), personById)}
          />
        </Field>
        <Field label="Lien du profil (facultatif)">
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoCapitalize="none" />
        </Field>
      </div>
    </Modal>
  );
}
