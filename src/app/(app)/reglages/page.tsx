"use client";

import { Copy, HardDrive, KeyRound, LogOut, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { useData } from "@/components/data/DataProvider";
import { useToast } from "@/components/Toast";
import { Button, Card, Field, IconButton, Input, Modal, Pill, SectionTitle } from "@/components/ui";
import { apiKeyDisplayPrefix, generateApiKey, hashApiKey } from "@/lib/apikey";
import { authedFetch } from "@/lib/client-fetch";
import { copyText } from "@/lib/clipboard";
import { dateTimeLabel, formatBytes } from "@/lib/format";
import { supabase } from "@/lib/supabase/browser";
import type { ApiKey, TeamMember } from "@/lib/types";

const FREE_STORAGE = 1024 ** 3; // 1 Go (plan gratuit Supabase)

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Réglages" />
      <PageBody className="max-w-3xl space-y-10">
        <AccountSection />
        <TeamSection />
        <ApiKeysSection />
        <StorageSection />
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------ */

function AccountSection() {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const change = async () => {
    if (pwd.length < 8) return toast("8 caractères minimum", "error");
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) return toast(error.message, "error");
    setPwd("");
    toast("Mot de passe modifié", "success");
  };

  return (
    <section>
      <SectionTitle>Mon compte</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">Connecté en tant que</p>
            <p className="truncate font-medium">{email}</p>
          </div>
          <Button icon={<LogOut className="size-4" />} onClick={() => supabase().auth.signOut()}>
            Déconnexion
          </Button>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            change();
          }}
        >
          <Field label="Nouveau mot de passe" className="min-w-0 flex-1 basis-56">
            <Input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
          </Field>
          <Button type="submit" loading={busy} disabled={!pwd}>
            Changer
          </Button>
        </form>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TeamSection() {
  const toast = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [me, setMe] = useState("");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase().from("team_members").select("*").order("created_at");
    setMembers((data as TeamMember[]) ?? []);
  }, []);

  useEffect(() => {
    // chargement initial depuis Supabase
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    supabase()
      .auth.getUser()
      .then(({ data }) => setMe(data.user?.id ?? ""));
  }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      await authedFetch("/api/team", { method: "POST", body: JSON.stringify({ email, password: pwd }) });
      toast("Membre ajouté. Envoie-lui l'adresse de l'app et son mot de passe.", "success");
      setOpen(false);
      setEmail("");
      setPwd("");
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (m: TeamMember) => {
    const password = prompt(`Nouveau mot de passe pour ${m.email} (8 caractères minimum) :`);
    if (!password) return;
    try {
      await authedFetch("/api/team", { method: "PATCH", body: JSON.stringify({ user_id: m.user_id, password }) });
      toast("Mot de passe réinitialisé", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (m: TeamMember) => {
    if (!confirm(`Retirer ${m.email} de l'équipe ? Son compte de connexion sera supprimé.`)) return;
    try {
      await authedFetch(`/api/team?user_id=${encodeURIComponent(m.user_id)}`, { method: "DELETE" });
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <section>
      <SectionTitle
        action={
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Ajouter
          </Button>
        }
      >
        Équipe
      </SectionTitle>
      <Card className="divide-y divide-line">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-3 p-3 pl-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent uppercase">
              {m.email.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {m.email} {m.user_id === me && <span className="text-muted">(toi)</span>}
              </p>
              <p className="text-xs text-muted">Depuis le {dateTimeLabel(m.created_at)}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => reset(m)}>
              Mot de passe
            </Button>
            {m.user_id !== me && (
              <IconButton label="Retirer" onClick={() => remove(m)} className="hover:text-danger">
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </div>
        ))}
        {!members.length && (
          <p className="flex items-center gap-2 p-4 text-sm text-muted">
            <Users className="size-4" /> Chargement…
          </p>
        )}
      </Card>
      <p className="mt-2 text-xs text-muted">Tous les membres voient et modifient tous les projets.</p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ajouter un membre"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button variant="primary" loading={busy} disabled={!email || pwd.length < 8} onClick={add}>
              Ajouter
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoCapitalize="none" />
          </Field>
          <Field label="Mot de passe provisoire" hint="8 caractères minimum. La personne pourra le changer dans Réglages.">
            <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} autoCapitalize="none" autoComplete="off" />
          </Field>
        </div>
      </Modal>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ApiKeysSection() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(async () => {
    const { data } = await supabase().from("api_keys").select("*").order("created_at", { ascending: false });
    setKeys((data as ApiKey[]) ?? []);
  }, []);
  useEffect(() => {
    // chargement initial depuis Supabase
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    const key = generateApiKey();
    const { error } = await supabase()
      .from("api_keys")
      .insert({ name: name.trim() || "Clé API", prefix: apiKeyDisplayPrefix(key), key_hash: await hashApiKey(key) });
    setBusy(false);
    if (error) return toast(error.message, "error");
    setCreated(key);
    setName("");
    load();
  };

  const revoke = async (k: ApiKey) => {
    if (!confirm(`Révoquer la clé « ${k.name} » ? Les outils qui l'utilisent ne pourront plus se connecter.`)) return;
    const { error } = await supabase().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", k.id);
    if (error) return toast(error.message, "error");
    load();
  };

  const configCmd = created ? `node ~/.claude/skills/depot-contenu/depot.mjs config --url ${origin} --key ${created}` : "";

  return (
    <section>
      <SectionTitle
        action={
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nouvelle clé
          </Button>
        }
      >
        Clés API
      </SectionTitle>
      <Card className="divide-y divide-line">
        {keys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 p-3 pl-4">
            <KeyRound className="size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {k.name} <span className="font-mono text-xs text-muted">{k.prefix}…</span>
              </p>
              <p className="text-xs text-muted">
                Créée le {dateTimeLabel(k.created_at)}
                {k.last_used_at ? ` · utilisée le ${dateTimeLabel(k.last_used_at)}` : " · jamais utilisée"}
              </p>
            </div>
            {k.revoked_at ? (
              <Pill tone="danger">Révoquée</Pill>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => revoke(k)}>
                Révoquer
              </Button>
            )}
          </div>
        ))}
        {!keys.length && <p className="p-4 text-sm text-muted">Aucune clé pour l&apos;instant.</p>}
      </Card>
      <p className="mt-2 text-xs text-muted">
        Une clé permet à Claude (dans n&apos;importe quel dossier de ton ordinateur) ou à un script d&apos;envoyer des
        vidéos et carrousels ici et de les programmer, via le skill « depot-contenu » ou l&apos;API REST{" "}
        <code className="font-mono">{origin}/api/v1</code>.
      </p>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setCreated(null);
        }}
        title={created ? "Clé créée" : "Nouvelle clé API"}
        wide={!!created}
        footer={
          created ? (
            <Button variant="primary" onClick={() => (setOpen(false), setCreated(null))}>
              J&apos;ai copié la clé
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button variant="primary" loading={busy} onClick={create}>
                Créer
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div className="space-y-4 text-sm">
            <p className="rounded-xl bg-warning-soft p-3 text-warning">
              Copie-la maintenant : elle ne sera plus jamais affichée.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-xs">{created}</code>
              <IconButton label="Copier la clé" onClick={async () => toast((await copyText(created)) ? "Clé copiée" : "Copie impossible")}>
                <Copy className="size-4" />
              </IconButton>
            </div>
            <div>
              <p className="mb-1 text-muted">Pour la brancher sur Claude Code (une seule fois par ordinateur) :</p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-xs break-all">{configCmd}</code>
                <IconButton label="Copier la commande" onClick={async () => toast((await copyText(configCmd)) ? "Commande copiée" : "Copie impossible")}>
                  <Copy className="size-4" />
                </IconButton>
              </div>
            </div>
          </div>
        ) : (
          <Field label="Nom de la clé" hint="Pour savoir où elle sert, ex. « PC bureau – Claude Code ».">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
      </Modal>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StorageSection() {
  const { contents } = useData();
  const used = contents.reduce((s, c) => s + c.assets.reduce((t, a) => t + (a.size_bytes || 0), 0), 0);
  const files = contents.reduce((s, c) => s + c.assets.length, 0);
  const ratio = Math.min(1, used / FREE_STORAGE);
  return (
    <section>
      <SectionTitle>Stockage</SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <HardDrive className="size-5 text-muted" />
          <p className="flex-1 text-sm">
            <strong>{formatBytes(used)}</strong> utilisés sur 1 Go · {files} fichier{files > 1 ? "s" : ""}
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={ratio > 0.85 ? "h-full bg-danger" : "h-full bg-accent"}
            style={{ width: `${Math.max(2, ratio * 100)}%` }}
          />
        </div>
        <p className="text-xs text-muted">
          Plan gratuit Supabase : 1 Go au total et 50 Mo maximum par fichier. Pour des vidéos plus lourdes, passe
          l&apos;organisation Supabase « Dépôt contenu » en plan Pro (100 Go, gros fichiers).
        </p>
      </Card>
    </section>
  );
}
