"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/client-fetch";
import { buildFolderIndex, type FolderIndex } from "@/lib/folders";
import { forgetSignedUrl } from "@/lib/signed-urls";
import { supabase } from "@/lib/supabase/browser";
import type { Account, Asset, Content, ContentFull, Folder, Person, Publication } from "@/lib/types";
import { useToast } from "../Toast";

interface Data {
  folders: Folder[];
  accounts: Account[];
  contents: ContentFull[];
  people: Person[];
}

type PubPatch = Partial<
  Pick<Publication, "scheduled_date" | "scheduled_time" | "title" | "description" | "posted" | "post_url">
>;

export interface Store extends Data {
  /** true dès que les données ont été chargées au moins une fois */
  ready: boolean;
  /** erreur du dernier chargement (null si OK) */
  error: string | null;
  online: boolean;
  index: FolderIndex;
  contentById: Map<string, ContentFull>;
  accountById: Map<string, Account>;
  personById: Map<string, Person>;
  reload: () => Promise<void>;
  createPerson: (input: { name: string; color: string }) => Promise<Person | null>;
  updatePerson: (id: string, patch: Partial<Pick<Person, "name" | "color" | "position">>) => Promise<boolean>;
  deletePerson: (id: string) => Promise<boolean>;
  createFolder: (input: { name: string; parent_id: string | null; color?: string; description?: string; assignee_id?: string | null }) => Promise<Folder | null>;
  updateFolder: (id: string, patch: Partial<Pick<Folder, "name" | "color" | "description" | "parent_id" | "position" | "assignee_id">>) => Promise<boolean>;
  deleteFolder: (id: string) => Promise<boolean>;
  createAccount: (input: Pick<Account, "folder_id" | "platform" | "handle" | "url"> & { assignee_id?: string | null }) => Promise<Account | null>;
  updateAccount: (id: string, patch: Partial<Pick<Account, "platform" | "handle" | "url" | "folder_id" | "assignee_id">>) => Promise<boolean>;
  deleteAccount: (id: string) => Promise<boolean>;
  createContent: (input: Pick<Content, "folder_id" | "title" | "format"> & { assignee_id?: string | null }) => Promise<ContentFull | null>;
  updateContent: (id: string, patch: Partial<Pick<Content, "title" | "format" | "notes" | "folder_id" | "keep_files" | "assignee_id">>) => Promise<boolean>;
  /** retire tout de suite du stockage les fichiers d'un contenu posté partout */
  archiveNow: (contentId: string) => Promise<boolean>;
  /** délai (jours) avant l'archivage automatique ; null = jamais ; undefined = pas encore chargé */
  archiveAfterDays: number | null | undefined;
  setArchiveAfterDays: (days: number | null) => Promise<boolean>;
  deleteContent: (id: string) => Promise<boolean>;
  savePublication: (contentId: string, accountId: string, patch: PubPatch) => Promise<boolean>;
  deletePublication: (contentId: string, accountId: string) => Promise<boolean>;
  addAsset: (asset: Asset) => void;
  deleteAsset: (asset: Asset) => Promise<boolean>;
  reorderAssets: (contentId: string, orderedIds: string[]) => Promise<boolean>;
}

const Ctx = createContext<Store | null>(null);

export function useData(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useData doit être utilisé dans <DataProvider>");
  return s;
}

/* ------------------------------------------------------------------ */
/* Coordination des écritures (un seul DataProvider dans l'app)        */
/* ------------------------------------------------------------------ */

/**
 * Écritures en cours et horodatage de la dernière : un rechargement lancé avant une écriture
 * ne doit pas écraser l'état local.
 */
const RELOAD_EVENT = "depot:reload";
const writes = { pending: 0, last: 0, loading: false, retry: null as ReturnType<typeof setTimeout> | null };

/** Enveloppe une écriture pour la signaler au rechargement automatique. */
function tracked<A extends unknown[], R>(fn: (...args: A) => R) {
  return (...args: A): R => {
    writes.pending++;
    writes.last = Date.now();
    const done = () => {
      writes.pending--;
      writes.last = Date.now();
    };
    try {
      const out = fn(...args);
      if (out instanceof Promise) out.then(done, done);
      else done();
      return out;
    } catch (e) {
      done();
      throw e;
    }
  };
}

/** File d'attente par clé : deux écritures sur la même ligne partent dans l'ordre. */
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => queues.get(key) === next && queues.delete(key)).catch(() => {});
  return next;
}

function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "23505") return "Ce nom existe déjà à cet endroit";
  if (err?.code === "23503") return "Élément lié introuvable (supprimé entre-temps ?)";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Pas de connexion internet";
  if (/Failed to fetch|NetworkError|Load failed/i.test(err?.message ?? "")) return "Connexion impossible";
  return err?.message ?? "";
}

async function fetchAllContents(): Promise<ContentFull[]> {
  const out: ContentFull[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase()
      .from("contents")
      .select("*, publications(*), assets(*)")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as ContentFull[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [data, setData] = useState<Data>({ folders: [], accounts: [], contents: [], people: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [archiveAfterDays, setArchiveDays] = useState<number | null | undefined>(undefined);

  const fail = useCallback(
    (e: unknown, msg = "Pas enregistré") => {
      console.error(e);
      const detail = friendlyError(e);
      toast(detail ? `${msg} : ${detail}` : msg, "error");
    },
    [toast],
  );

  const reload = useCallback(async () => {
    if (writes.loading) return;
    writes.loading = true;
    const startedAt = Date.now();
    try {
      const sb = supabase();
      const [f, a, contents, pe] = await Promise.all([
        sb.from("folders").select("*").order("id"),
        sb.from("accounts").select("*").order("id"),
        fetchAllContents(),
        sb.from("people").select("*").order("position").order("name"),
      ]);
      if (f.error) throw f.error;
      if (a.error) throw a.error;
      if (pe.error) throw pe.error;
      if (writes.pending > 0 || writes.last >= startedAt) {
        // une modification a eu lieu pendant le chargement : instantané peut-être périmé, on recommence
        if (writes.retry) clearTimeout(writes.retry);
        writes.retry = setTimeout(() => window.dispatchEvent(new Event(RELOAD_EVENT)), 1500);
        return;
      }
      setData({ folders: f.data as Folder[], accounts: a.data as Account[], contents, people: pe.data as Person[] });
      setError(null);
      setReady(true);
    } catch (e) {
      console.error(e);
      setError(friendlyError(e) || "Chargement impossible");
    } finally {
      writes.loading = false;
    }
  }, []);

  useEffect(() => {
    // chargement initial + rafraîchissement au retour au premier plan, au retour du réseau et chaque minute
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    authedFetch<{ archive_after_days: number | null }>("/api/settings", { method: "POST", body: "{}" })
      .then((r) => setArchiveDays(r.archive_after_days))
      .catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && reload();
    const onRetry = () => reload();
    const onOnline = () => {
      setOnline(true);
      reload();
    };
    const onOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(RELOAD_EVENT, onRetry);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(RELOAD_EVENT, onRetry);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(timer);
    };
  }, [reload]);

  const index = useMemo(() => buildFolderIndex(data.folders), [data.folders]);
  const contentById = useMemo(() => new Map(data.contents.map((c) => [c.id, c])), [data.contents]);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const personById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);

  /* ---------------- mises à jour locales ---------------- */
  const patchContentLocal = useCallback((id: string, fn: (c: ContentFull) => ContentFull) => {
    setData((d) => ({ ...d, contents: d.contents.map((c) => (c.id === id ? fn(c) : c)) }));
  }, []);

  /* ---------------- personnes ---------------- */
  const createPerson: Store["createPerson"] = useCallback(
    async (input) => {
      const name = input.name.trim();
      const { data: row, error } = await supabase()
        .from("people")
        .insert({ name, color: input.color, position: data.people.length })
        .select()
        .single();
      if (error) {
        fail(error.code === "23505" ? { message: "Cette personne existe déjà" } : error, "Personne non ajoutée");
        return null;
      }
      setData((d) => ({ ...d, people: [...d.people, row as Person] }));
      return row as Person;
    },
    [data.people, fail],
  );

  const updatePerson: Store["updatePerson"] = useCallback(
    async (id, patch) => {
      const before = data.people.find((p) => p.id === id);
      setData((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
      const { error } = await supabase().from("people").update(patch).eq("id", id);
      if (error) {
        fail(error.code === "23505" ? { message: "Ce nom est déjà pris" } : error, "Personne non modifiée");
        if (before) setData((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? before : p)) }));
        return false;
      }
      return true;
    },
    [data.people, fail],
  );

  const deletePerson: Store["deletePerson"] = useCallback(
    async (id) => {
      const { error } = await supabase().from("people").delete().eq("id", id);
      if (error) {
        fail(error, "Suppression impossible");
        return false;
      }
      // la base remet les attributions à vide (on delete set null) : même chose en local
      const clear = <T extends { assignee_id: string | null }>(x: T): T => (x.assignee_id === id ? { ...x, assignee_id: null } : x);
      setData((d) => ({
        ...d,
        people: d.people.filter((p) => p.id !== id),
        folders: d.folders.map(clear),
        accounts: d.accounts.map(clear),
        contents: d.contents.map(clear),
      }));
      return true;
    },
    [fail],
  );

  /* ---------------- dossiers ---------------- */
  const createFolder: Store["createFolder"] = useCallback(
    async (input) => {
      const siblings = data.folders.filter((f) => f.parent_id === input.parent_id);
      const name = input.name.replace(/[/>]+/g, "-").trim();
      const { data: row, error } = await supabase()
        .from("folders")
        .insert({ ...input, name, position: siblings.length })
        .select()
        .single();
      if (error) {
        fail(error, "Dossier non créé");
        return null;
      }
      setData((d) => ({ ...d, folders: [...d.folders, row as Folder] }));
      return row as Folder;
    },
    [data.folders, fail],
  );

  const updateFolder: Store["updateFolder"] = useCallback(
    async (id, rawPatch) => {
      const patch = rawPatch.name ? { ...rawPatch, name: rawPatch.name.replace(/[/>]+/g, "-").trim() } : rawPatch;
      const before = data.folders.find((f) => f.id === id);
      setData((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
      const { error } = await supabase().from("folders").update(patch).eq("id", id);
      if (error) {
        fail(error, "Dossier non modifié");
        if (before) setData((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? before : f)) }));
        return false;
      }
      return true;
    },
    [data.folders, fail],
  );

  const deleteFolder: Store["deleteFolder"] = useCallback(
    async (id) => {
      if (data.folders.some((f) => f.parent_id === id) || data.contents.some((c) => c.folder_id === id)) {
        toast("Ce dossier n'est pas vide : déplace ou supprime d'abord son contenu.", "error");
        return false;
      }
      const { error } = await supabase().from("folders").delete().eq("id", id);
      if (error) {
        fail(error, "Suppression impossible");
        return false;
      }
      const goneAccounts = new Set(data.accounts.filter((a) => a.folder_id === id).map((a) => a.id));
      setData((d) => ({
        ...d,
        folders: d.folders.filter((f) => f.id !== id),
        accounts: d.accounts.filter((a) => a.folder_id !== id),
        contents: goneAccounts.size
          ? d.contents.map((c) => ({ ...c, publications: c.publications.filter((p) => !goneAccounts.has(p.account_id)) }))
          : d.contents,
      }));
      return true;
    },
    [data.folders, data.contents, data.accounts, fail, toast],
  );

  /* ---------------- comptes ---------------- */
  const createAccount: Store["createAccount"] = useCallback(
    async (input) => {
      const { data: row, error } = await supabase()
        .from("accounts")
        .insert({ ...input, position: data.accounts.filter((a) => a.folder_id === input.folder_id).length })
        .select()
        .single();
      if (error) {
        fail(error.code === "23505" ? { message: "Ce compte existe déjà dans ce dossier" } : error, "Compte non ajouté");
        return null;
      }
      setData((d) => ({ ...d, accounts: [...d.accounts, row as Account] }));
      return row as Account;
    },
    [data.accounts, fail],
  );

  const updateAccount: Store["updateAccount"] = useCallback(
    async (id, patch) => {
      const before = data.accounts.find((a) => a.id === id);
      setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
      const { error } = await supabase().from("accounts").update(patch).eq("id", id);
      if (error) {
        fail(error.code === "23505" ? { message: "Ce compte existe déjà dans ce dossier" } : error, "Compte non modifié");
        if (before) setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? before : a)) }));
        return false;
      }
      return true;
    },
    [data.accounts, fail],
  );

  const deleteAccount: Store["deleteAccount"] = useCallback(
    async (id) => {
      const { error } = await supabase().from("accounts").delete().eq("id", id);
      if (error) {
        fail(error, "Suppression impossible");
        return false;
      }
      setData((d) => ({
        ...d,
        accounts: d.accounts.filter((a) => a.id !== id),
        contents: d.contents.map((c) => ({
          ...c,
          publications: c.publications.filter((p) => p.account_id !== id),
        })),
      }));
      return true;
    },
    [fail],
  );

  /* ---------------- contenus ---------------- */
  const createContent: Store["createContent"] = useCallback(
    async (input) => {
      const { data: row, error } = await supabase().from("contents").insert(input).select().single();
      if (error) {
        fail(error, "Contenu non créé");
        return null;
      }
      const full: ContentFull = { ...(row as Content), publications: [], assets: [] };
      setData((d) => ({ ...d, contents: [full, ...d.contents] }));
      return full;
    },
    [fail],
  );

  const updateContent: Store["updateContent"] = useCallback(
    (id, patch) =>
      serialize(`content:${id}`, async () => {
        const before = data.contents.find((c) => c.id === id);
        patchContentLocal(id, (c) => ({ ...c, ...patch }));
        const { error } = await supabase().from("contents").update(patch).eq("id", id);
        if (error) {
          fail(error);
          if (before) {
            const keys = Object.keys(patch) as (keyof typeof patch)[];
            patchContentLocal(id, (c) => ({ ...c, ...Object.fromEntries(keys.map((k) => [k, before[k]])) }));
          }
          return false;
        }
        return true;
      }),
    [data.contents, fail, patchContentLocal],
  );

  const deleteContent: Store["deleteContent"] = useCallback(
    async (id) => {
      try {
        const res = await authedFetch<{ warning?: string }>("/api/storage/delete", {
          method: "POST",
          body: JSON.stringify({ content_id: id }),
        });
        if (res.warning) console.warn(res.warning);
      } catch (e) {
        fail(e, "Suppression impossible");
        return false;
      }
      const content = data.contents.find((c) => c.id === id);
      content?.assets.forEach((a) => forgetSignedUrl(a.storage_path));
      setData((d) => ({ ...d, contents: d.contents.filter((c) => c.id !== id) }));
      return true;
    },
    [data.contents, fail],
  );

  const archiveNow: Store["archiveNow"] = useCallback(
    async (contentId) => {
      try {
        const res = await authedFetch<{ archived_ids: string[]; archived_at: string | null; freed_bytes: number }>(
          "/api/storage/archive",
          { method: "POST", body: JSON.stringify({ content_id: contentId }) },
        );
        const ids = new Set(res.archived_ids);
        const at = res.archived_at ?? new Date().toISOString();
        const content = data.contents.find((c) => c.id === contentId);
        content?.assets.filter((a) => ids.has(a.id)).forEach((a) => forgetSignedUrl(a.storage_path));
        patchContentLocal(contentId, (c) => ({
          ...c,
          files_archived_at: res.archived_at ?? c.files_archived_at,
          assets: c.assets.map((a) => (ids.has(a.id) ? { ...a, archived_at: at } : a)),
        }));
        return true;
      } catch (e) {
        fail(e, "Fichiers non supprimés");
        return false;
      }
    },
    [data.contents, fail, patchContentLocal],
  );

  const setArchiveAfterDays: Store["setArchiveAfterDays"] = useCallback(
    async (days) => {
      try {
        const r = await authedFetch<{ archive_after_days: number | null }>("/api/settings", {
          method: "POST",
          body: JSON.stringify({ archive_after_days: days }),
        });
        setArchiveDays(r.archive_after_days);
        return true;
      } catch (e) {
        fail(e, "Réglage non enregistré");
        return false;
      }
    },
    [fail],
  );

  /* ---------------- publications ---------------- */
  const savePublication: Store["savePublication"] = useCallback(
    (contentId, accountId, patch) => {
      const now = new Date().toISOString();
      // état d'avant, pour revenir en arrière si l'enregistrement échoue
      const before = data.contents
        .find((c) => c.id === contentId)
        ?.publications.find((p) => p.account_id === accountId);

      patchContentLocal(contentId, (c) => {
        const existing = c.publications.find((p) => p.account_id === accountId);
        if (existing) {
          return {
            ...c,
            publications: c.publications.map((p) =>
              p.account_id === accountId
                ? {
                    ...p,
                    ...patch,
                    posted_at: patch.posted === undefined ? p.posted_at : patch.posted ? p.posted_at ?? now : null,
                  }
                : p,
            ),
          };
        }
        const draft: Publication = {
          id: `tmp-${contentId}-${accountId}`,
          content_id: contentId,
          account_id: accountId,
          scheduled_date: null,
          scheduled_time: null,
          title: "",
          description: "",
          posted: false,
          posted_at: null,
          post_url: "",
          created_at: now,
          updated_at: now,
          ...patch,
        };
        if (draft.posted) draft.posted_at = now;
        return { ...c, publications: [...c.publications, draft] };
      });

      return serialize(`pub:${contentId}:${accountId}`, async () => {
        const { data: row, error } = await supabase()
          .from("publications")
          .upsert({ content_id: contentId, account_id: accountId, ...patch }, { onConflict: "content_id,account_id" })
          .select("id, created_at, updated_at, posted_at")
          .single();
        if (error) {
          fail(error);
          patchContentLocal(contentId, (c) => {
            if (!before) return { ...c, publications: c.publications.filter((p) => p.account_id !== accountId) };
            const keys = [...Object.keys(patch), "posted_at"] as (keyof Publication)[];
            const restore = Object.fromEntries(keys.map((k) => [k, before[k]]));
            return {
              ...c,
              publications: c.publications.map((p) => (p.account_id === accountId ? { ...p, ...restore } : p)),
            };
          });
          return false;
        }
        patchContentLocal(contentId, (c) => ({
          ...c,
          publications: c.publications.map((p) => (p.account_id === accountId ? { ...p, ...row } : p)),
        }));
        return true;
      });
    },
    [data.contents, fail, patchContentLocal],
  );

  const deletePublication: Store["deletePublication"] = useCallback(
    (contentId, accountId) =>
      serialize(`pub:${contentId}:${accountId}`, async () => {
        const before = data.contents
          .find((c) => c.id === contentId)
          ?.publications.find((p) => p.account_id === accountId);
        patchContentLocal(contentId, (c) => ({
          ...c,
          publications: c.publications.filter((p) => p.account_id !== accountId),
        }));
        const { error } = await supabase()
          .from("publications")
          .delete()
          .eq("content_id", contentId)
          .eq("account_id", accountId);
        if (error) {
          fail(error, "Non retiré");
          if (before) patchContentLocal(contentId, (c) => ({ ...c, publications: [...c.publications, before] }));
          return false;
        }
        return true;
      }),
    [data.contents, fail, patchContentLocal],
  );

  /* ---------------- fichiers ---------------- */
  const addAsset: Store["addAsset"] = useCallback(
    (asset) =>
      patchContentLocal(asset.content_id, (c) =>
        c.assets.some((a) => a.id === asset.id) ? c : { ...c, assets: [...c.assets, asset] },
      ),
    [patchContentLocal],
  );

  const deleteAsset: Store["deleteAsset"] = useCallback(
    async (asset) => {
      try {
        const res = await authedFetch<{ warning?: string }>("/api/storage/delete", {
          method: "POST",
          body: JSON.stringify({ asset_id: asset.id }),
        });
        if (res.warning) console.warn(res.warning);
      } catch (e) {
        fail(e, "Fichier non supprimé");
        return false;
      }
      forgetSignedUrl(asset.storage_path);
      patchContentLocal(asset.content_id, (c) => ({ ...c, assets: c.assets.filter((a) => a.id !== asset.id) }));
      return true;
    },
    [fail, patchContentLocal],
  );

  const reorderAssets: Store["reorderAssets"] = useCallback(
    (contentId, orderedIds) =>
      serialize(`order:${contentId}`, async () => {
        const content = data.contents.find((c) => c.id === contentId);
        const current = new Map(content?.assets.map((a) => [a.id, a.position]) ?? []);
        const changed = orderedIds.map((id, i) => ({ id, position: i })).filter((x) => current.get(x.id) !== x.position);
        if (!changed.length) return true;
        const pos = new Map(changed.map((x) => [x.id, x.position]));
        patchContentLocal(contentId, (c) => ({
          ...c,
          assets: c.assets.map((a) => (pos.has(a.id) ? { ...a, position: pos.get(a.id)! } : a)),
        }));
        const results = await Promise.all(
          changed.map((x) => supabase().from("assets").update({ position: x.position }).eq("id", x.id)),
        );
        const err = results.find((r) => r.error)?.error;
        if (err) {
          fail(err, "Ordre non enregistré");
          patchContentLocal(contentId, (c) => ({
            ...c,
            assets: c.assets.map((a) => (current.has(a.id) ? { ...a, position: current.get(a.id)! } : a)),
          }));
          return false;
        }
        return true;
      }),
    [data.contents, fail, patchContentLocal],
  );

  const actions = useMemo(
    () => ({
      createPerson: tracked(createPerson),
      updatePerson: tracked(updatePerson),
      deletePerson: tracked(deletePerson),
      createFolder: tracked(createFolder),
      updateFolder: tracked(updateFolder),
      deleteFolder: tracked(deleteFolder),
      createAccount: tracked(createAccount),
      updateAccount: tracked(updateAccount),
      deleteAccount: tracked(deleteAccount),
      createContent: tracked(createContent),
      updateContent: tracked(updateContent),
      deleteContent: tracked(deleteContent),
      savePublication: tracked(savePublication),
      deletePublication: tracked(deletePublication),
      addAsset: tracked(addAsset),
      deleteAsset: tracked(deleteAsset),
      reorderAssets: tracked(reorderAssets),
      archiveNow: tracked(archiveNow),
      setArchiveAfterDays,
    }),
    [
      createPerson, updatePerson, deletePerson,
      createFolder, updateFolder, deleteFolder, createAccount, updateAccount, deleteAccount, createContent,
      updateContent, deleteContent, savePublication, deletePublication, addAsset, deleteAsset, reorderAssets,
      archiveNow, setArchiveAfterDays,
    ],
  );

  const store: Store = {
    ...data,
    ready,
    error,
    online,
    archiveAfterDays,
    index,
    contentById,
    accountById,
    personById,
    reload,
    ...actions,
  };

  return <Ctx value={store}>{children}</Ctx>;
}
