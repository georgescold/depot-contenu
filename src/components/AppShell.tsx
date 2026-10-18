"use client";

import { BarChart3, CalendarDays, FolderTree, Library, LogOut, Plus, RefreshCw, Settings, WifiOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/browser";
import { DataProvider, useData } from "./data/DataProvider";
import { FolderTreeNav } from "./FolderTreeNav";
import { InstallBanner, InstallSidebarButton } from "./InstallApp";
import { NewContentModal } from "./NewContentModal";
import { ToastProvider } from "./Toast";
import { Button, cn, Spinner } from "./ui";
import { UploadProvider } from "./upload/UploadProvider";

const NAV = [
  { href: "/", label: "Planning", icon: CalendarDays },
  { href: "/projets", label: "Projets", icon: FolderTree },
  { href: "/contenus", label: "Contenus", icon: Library },
  { href: "/statistiques", label: "Stats", icon: BarChart3 },
  { href: "/reglages", label: "Réglages", icon: Settings },
] as const;

interface ShellApi {
  openNewContent: (folderId?: string | null) => void;
}
const ShellCtx = createContext<ShellApi>({ openNewContent: () => {} });
export const useShell = () => useContext(ShellCtx);

export function Splash({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted">
      <Spinner className="size-6" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

/** Déconnexion : rechargement complet pour vider l'état gardé en mémoire (pages cachées, envois…). */
export async function signOutAndLeave() {
  await supabase().auth.signOut().catch(() => {});
  window.location.assign("/login");
}

function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [email, setEmail] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const sb = supabase();
    let alive = true;
    (async () => {
      const { data, error } = await sb.auth.getSession();
      if (!alive) return;
      if (error) return setState("error");
      const session = data.session;
      if (!session) return window.location.replace("/login");
      setEmail(session.user.email ?? "");
      const { data: member, error: mErr } = await sb
        .from("team_members")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!alive) return;
      // une erreur réseau n'est pas un refus d'accès
      if (mErr) return setState("error");
      setState(member ? "ok" : "denied");
    })();
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.assign("/login");
    });
    const onOnline = () => setAttempt((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, [attempt]);

  if (state === "loading") return <Splash />;
  if (state === "error") return <OfflineScreen onRetry={() => (setState("loading"), setAttempt((n) => n + 1))} />;
  if (state === "denied") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Accès non autorisé</p>
        <p className="max-w-sm text-sm text-muted">
          Le compte {email} n&apos;est pas membre de l&apos;équipe. Demande au propriétaire de t&apos;ajouter depuis
          Réglages → Équipe.
        </p>
        <Button onClick={signOutAndLeave} icon={<LogOut className="size-4" />}>
          Se déconnecter
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function OfflineScreen({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <WifiOff className="size-8 text-muted" />
      <p className="text-lg font-semibold">Connexion impossible</p>
      <p className="max-w-sm text-sm text-muted">
        {message ?? "Vérifie ta connexion internet."} L&apos;app réessaie toute seule dès que le réseau revient.
      </p>
      <Button variant="primary" onClick={onRetry} icon={<RefreshCw className="size-4" />}>
        Réessayer
      </Button>
    </div>
  );
}

/** Tant que les données n'ont jamais été chargées : écran d'attente ou d'erreur (jamais une app « vide »). */
function DataGate({ children }: { children: ReactNode }) {
  const { ready, error, reload } = useData();
  if (ready) return <>{children}</>;
  if (error) return <OfflineScreen message={error} onRetry={() => reload()} />;
  return <Splash />;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ShellUI({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { contentById, online, error } = useData();
  const [newOpen, setNewOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const openNewContent = useCallback(
    (folderId?: string | null) => {
      // dossier proposé : celui de la page ouverte (dossier, ou dossier du contenu affiché)
      const seg = pathname.split("/");
      const fromPath =
        seg[1] === "projets" && seg[2] ? seg[2] : seg[1] === "contenus" && seg[2] ? contentById.get(seg[2])?.folder_id : null;
      setNewFolder(folderId ?? fromPath ?? null);
      setNewOpen(true);
    },
    [pathname, contentById],
  );

  return (
    <ShellCtx value={{ openNewContent }}>
      {(!online || error) && (
        <div className="pt-safe sticky top-0 z-40 bg-warning-soft text-warning">
          <p className="flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium">
            <WifiOff className="size-3.5 shrink-0" />
            {!online ? "Hors connexion : les modifications ne seront pas enregistrées." : `Synchronisation impossible (${error}).`}
          </p>
        </div>
      )}
      <InstallBanner />
      <div className="md:flex">
        {/* Barre latérale (ordinateur) */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">
          <Link href="/" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="font-semibold tracking-tight">Dépôt contenu</span>
          </Link>
          <div className="px-3">
            <Button variant="primary" className="w-full" icon={<Plus className="size-4" />} onClick={() => openNewContent()}>
              Nouveau contenu
            </Button>
          </div>
          <nav className="mt-4 space-y-0.5 px-3">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition",
                  isActive(pathname, href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="size-[18px]" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Arborescence</p>
            <FolderTreeNav compact />
          </div>
          <InstallSidebarButton />
        </aside>

        {/* Contenu */}
        <main className="min-w-0 flex-1 pb-28 md:pb-10">{children}</main>
      </div>

      {/* Barre d'onglets (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur pb-safe md:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {NAV.slice(0, 2).map((item) => (
            <TabLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label="Nouveau contenu"
              onClick={() => openNewContent()}
              className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg shadow-accent/30 active:scale-95"
            >
              <Plus className="size-6" />
            </button>
          </div>
          {NAV.slice(2, 4).map((item) => (
            <TabLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>

      <NewContentModal open={newOpen} onClose={() => setNewOpen(false)} defaultFolderId={newFolder} />
    </ShellCtx>
  );
}

function TabLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof CalendarDays;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
        active ? "text-accent" : "text-muted",
      )}
    >
      <Icon className="size-[22px]" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthGate>
        <DataProvider>
          <DataGate>
            <UploadProvider>
              <ShellUI>{children}</ShellUI>
            </UploadProvider>
          </DataGate>
        </DataProvider>
      </AuthGate>
    </ToastProvider>
  );
}

/** Accès aux Réglages sur téléphone (la barre d'onglets n'a pas la place). */
function SettingsLink() {
  const pathname = usePathname();
  if (pathname.startsWith("/reglages")) return null;
  return (
    <Link
      href="/reglages"
      aria-label="Réglages"
      title="Réglages"
      className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink md:hidden"
    >
      <Settings className="size-5" />
    </Link>
  );
}

/** En-tête de page commun. */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="pt-safe">
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-3 md:px-8 md:pt-8 md:pb-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="line-clamp-2 min-w-0 text-xl font-semibold tracking-tight break-words md:text-2xl">{title}</h1>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <SettingsLink />
          </div>
        </div>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
        {children && <div className="mt-3">{children}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 py-4 md:px-8", className)}>{children}</div>;
}
