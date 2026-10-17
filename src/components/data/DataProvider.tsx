"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { STORAGE_BUCKET } from "@/lib/constants";
import { buildFolderIndex, type FolderIndex } from "@/lib/folders";
import { forgetSignedUrl } from "@/lib/signed-urls";
import { supabase } from "@/lib/supabase/browser";
import type { Account, Asset, Content, ContentFull, Folder, Publication } from "@/lib/types";
import { useToast } from "../Toast";

interface Data {
  folders: Folder[];
  accounts: Account[];
  contents: ContentFull[];
}

type PubPatch = Partial<
  Pick<Publication, "scheduled_date" | "scheduled_time" | "title" | "description" | "posted" | "post_url">
>;

export interface Store extends Data {
  ready: boolean;
  error: string | null;
  index: FolderIndex;
  contentById: Map<string, ContentFull>;
  accountById: Map<string, Account>;
  reload: () => Promise<void>;
  createFolder: (input: { name: string; parent_id: string | null; color?: string; description?: string }) => Promise<Folder | null>;
  updateFolder: (id: string, patch: Partial<Pick<Folder, "name" | "color" | "description" | "parent_id" | "position">>) => Promise<void>;
  deleteFolder: (id: string) => Promise<boolean>;
  createAccount: (input: Pick<Account, "folder_id" | "platform" | "handle" | "url">) => Promise<Account | null>;
  updateAccount: (id: string, patch: Partial<Pick<Account, "platform" | "handle" | "url" | "folder_id">>) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  createContent: (input: Pick<Content, "folder_id" | "title" | "format">) => Promise<ContentFull | null>;
  updateContent: (id: string, patch: Partial<Pick<Content, "title" | "format" | "notes" | "folder_id">>) => Promise<void>;
  deleteContent: (id: string) => Promise<void>;
  savePublication: (contentId: string, accountId: string, patch: PubPatch) => Promise<void>;
  deletePublication: (contentId: string, accountId: string) => Promise<void>;
  addAsset: (asset: Asset) => void;
  updateAsset: (id: string, patch: Partial<Pick<Asset, "kind" | "position">>) => Promise<void>;
  deleteAsset: (asset: Asset) => Promise<void>;
  reorderAssets: (contentId: string, orderedIds: string[]) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useData(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useData doit être utilisé dans <DataProvider>");
  return s;
}

async function fetchAllContents(): Promise<ContentFull[]> {
  const out: ContentFull[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase()
      .from("contents")
      .select("*, publications(*), assets(*)")
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as ContentFull[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [data, setData] = useState<Data>({ folders: [], accounts: [], contents: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const fail = useCallback(
    (e: unknown, msg = "Oups, l'enregistrement a échoué") => {
      console.error(e);
      const detail = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "";
      toast(detail ? `${msg} : ${detail}` : msg, "error");
    },
    [toast],
  );

  const reload = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const sb = supabase();
      const [f, a, contents] = await Promise.all([
        sb.from("folders").select("*"),
        sb.from("accounts").select("*"),
        fetchAllContents(),
      ]);
      if (f.error) throw f.error;
      if (a.error) throw a.error;
      setData({ folders: f.data as Folder[], accounts: a.data as Account[], contents });
      setError(null);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      loading.current = false;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // chargement initial + rafraîchissement quand l'app revient au premier plan
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [reload]);

  const index = useMemo(() => buildFolderIndex(data.folders), [data.folders]);
  const contentById = useMemo(() => new Map(data.contents.map((c) => [c.id, c])), [data.contents]);
  const accountById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);

  /* ---------------- mises à jour locales ---------------- */
  const patchContentLocal = useCallback((id: string, fn: (c: ContentFull) => ContentFull) => {
    setData((d) => ({ ...d, contents: d.contents.map((c) => (c.id === id ? fn(c) : c)) }));
  }, []);

  /* ---------------- dossiers ---------------- */
  const createFolder: Store["createFolder"] = useCallback(
    async (input) => {
      const siblings = data.folders.filter((f) => f.parent_id === input.parent_id);
      const { data: row, error } = await supabase()
        .from("folders")
        .insert({ ...input, position: siblings.length })
        .select()
        .single();
      if (error) {
        fail(error, "Impossible de créer le dossier");
        return null;
      }
      setData((d) => ({ ...d, folders: [...d.folders, row as Folder] }));
      return row as Folder;
    },
    [data.folders, fail],
  );

  const updateFolder: Store["updateFolder"] = useCallback(
    async (id, patch) => {
      setData((d) => ({ ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
      const { error } = await supabase().from("folders").update(patch).eq("id", id);
      if (error) {
        fail(error);
        reload();
      }
    },
    [fail, reload],
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
      setData((d) => ({
        ...d,
        folders: d.folders.filter((f) => f.id !== id),
        accounts: d.accounts.filter((a) => a.folder_id !== id),
      }));
      return true;
    },
    [data.folders, data.contents, fail, toast],
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
        fail(error, "Impossible d'ajouter le compte");
        return null;
      }
      setData((d) => ({ ...d, accounts: [...d.accounts, row as Account] }));
      return row as Account;
    },
    [data.accounts, fail],
  );

  const updateAccount: Store["updateAccount"] = useCallback(
    async (id, patch) => {
      setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
      const { error } = await supabase().from("accounts").update(patch).eq("id", id);
      if (error) {
        fail(error);
        reload();
      }
    },
    [fail, reload],
  );

  const deleteAccount: Store["deleteAccount"] = useCallback(
    async (id) => {
      const { error } = await supabase().from("accounts").delete().eq("id", id);
      if (error) return fail(error, "Suppression impossible");
      setData((d) => ({
        ...d,
        accounts: d.accounts.filter((a) => a.id !== id),
        contents: d.contents.map((c) => ({
          ...c,
          publications: c.publications.filter((p) => p.account_id !== id),
        })),
      }));
    },
    [fail],
  );

  /* ---------------- contenus ---------------- */
  const createContent: Store["createContent"] = useCallback(
    async (input) => {
      const { data: row, error } = await supabase().from("contents").insert(input).select().single();
      if (error) {
        fail(error, "Impossible de créer le contenu");
        return null;
      }
      const full: ContentFull = { ...(row as Content), publications: [], assets: [] };
      setData((d) => ({ ...d, contents: [full, ...d.contents] }));
      return full;
    },
    [fail],
  );

  const updateContent: Store["updateContent"] = useCallback(
    async (id, patch) => {
      patchContentLocal(id, (c) => ({ ...c, ...patch }));
      const { error } = await supabase().from("contents").update(patch).eq("id", id);
      if (error) {
        fail(error);
        reload();
      }
    },
    [fail, patchContentLocal, reload],
  );

  const deleteContent: Store["deleteContent"] = useCallback(
    async (id) => {
      const content = data.contents.find((c) => c.id === id);
      const paths = content?.assets.map((a) => a.storage_path) ?? [];
      if (paths.length) {
        const { error } = await supabase().storage.from(STORAGE_BUCKET).remove(paths);
        if (error) return fail(error, "Impossible de supprimer les fichiers");
      }
      const { error } = await supabase().from("contents").delete().eq("id", id);
      if (error) return fail(error, "Suppression impossible");
      setData((d) => ({ ...d, contents: d.contents.filter((c) => c.id !== id) }));
    },
    [data.contents, fail],
  );

  /* ---------------- publications ---------------- */
  const savePublication: Store["savePublication"] = useCallback(
    async (contentId, accountId, patch) => {
      const now = new Date().toISOString();
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
                    posted_at:
                      patch.posted === undefined ? p.posted_at : patch.posted ? p.posted_at ?? now : null,
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

      const { data: row, error } = await supabase()
        .from("publications")
        .upsert({ content_id: contentId, account_id: accountId, ...patch }, { onConflict: "content_id,account_id" })
        .select("id, created_at, updated_at, posted_at")
        .single();
      if (error) {
        fail(error);
        reload();
        return;
      }
      patchContentLocal(contentId, (c) => ({
        ...c,
        publications: c.publications.map((p) => (p.account_id === accountId ? { ...p, ...row } : p)),
      }));
    },
    [fail, patchContentLocal, reload],
  );

  const deletePublication: Store["deletePublication"] = useCallback(
    async (contentId, accountId) => {
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
        fail(error);
        reload();
      }
    },
    [fail, patchContentLocal, reload],
  );

  /* ---------------- fichiers ---------------- */
  const addAsset: Store["addAsset"] = useCallback(
    (asset) => patchContentLocal(asset.content_id, (c) => ({ ...c, assets: [...c.assets, asset] })),
    [patchContentLocal],
  );

  const updateAsset: Store["updateAsset"] = useCallback(
    async (id, patch) => {
      setData((d) => ({
        ...d,
        contents: d.contents.map((c) =>
          c.assets.some((a) => a.id === id)
            ? { ...c, assets: c.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
            : c,
        ),
      }));
      const { error } = await supabase().from("assets").update(patch).eq("id", id);
      if (error) {
        fail(error);
        reload();
      }
    },
    [fail, reload],
  );

  const deleteAsset: Store["deleteAsset"] = useCallback(
    async (asset) => {
      const { error: sErr } = await supabase().storage.from(STORAGE_BUCKET).remove([asset.storage_path]);
      if (sErr) return fail(sErr, "Impossible de supprimer le fichier");
      const { error } = await supabase().from("assets").delete().eq("id", asset.id);
      if (error) return fail(error, "Impossible de supprimer le fichier");
      forgetSignedUrl(asset.storage_path);
      patchContentLocal(asset.content_id, (c) => ({ ...c, assets: c.assets.filter((a) => a.id !== asset.id) }));
    },
    [fail, patchContentLocal],
  );

  const reorderAssets: Store["reorderAssets"] = useCallback(
    async (contentId, orderedIds) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      patchContentLocal(contentId, (c) => ({
        ...c,
        assets: c.assets.map((a) => (pos.has(a.id) ? { ...a, position: pos.get(a.id)! } : a)),
      }));
      const results = await Promise.all(
        orderedIds.map((id, i) => supabase().from("assets").update({ position: i }).eq("id", id)),
      );
      const err = results.find((r) => r.error)?.error;
      if (err) {
        fail(err);
        reload();
      }
    },
    [fail, patchContentLocal, reload],
  );

  const store: Store = {
    ...data,
    ready,
    error,
    index,
    contentById,
    accountById,
    reload,
    createFolder,
    updateFolder,
    deleteFolder,
    createAccount,
    updateAccount,
    deleteAccount,
    createContent,
    updateContent,
    deleteContent,
    savePublication,
    deletePublication,
    addAsset,
    updateAsset,
    deleteAsset,
    reorderAssets,
  };

  return <Ctx value={store}>{children}</Ctx>;
}
