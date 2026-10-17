"use client";

import { CalendarDays, FolderTree, Library, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/browser";
import { DataProvider } from "./data/DataProvider";
import { FolderTreeNav } from "./FolderTreeNav";
import { NewContentModal } from "./NewContentModal";
import { ToastProvider } from "./Toast";
import { Button, cn, Spinner } from "./ui";
import { UploadProvider } from "./upload/UploadProvider";

const NAV = [
  { href: "/", label: "Planning", icon: CalendarDays },
  { href: "/projets", label: "Projets", icon: FolderTree },
  { href: "/contenus", label: "Contenus", icon: Library },
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

function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const sb = supabase();
    let alive = true;
    sb.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session) {
        router.replace("/login");
        return;
      }
      setEmail(session.user.email ?? "");
      const { data: member } = await sb
        .from("team_members")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (alive) setState(member ? "ok" : "denied");
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (state === "loading") return <Splash />;
  if (state === "denied") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Accès non autorisé</p>
        <p className="max-w-sm text-sm text-muted">
          Le compte {email} n&apos;est pas membre de l&apos;équipe. Demande à un membre de t&apos;ajouter depuis
          Réglages → Équipe.
        </p>
        <Button onClick={() => supabase().auth.signOut()} icon={<LogOut className="size-4" />}>
          Se déconnecter
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ShellUI({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [newOpen, setNewOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const openNewContent = useCallback(
    (folderId?: string | null) => {
      const fromPath = pathname.startsWith("/projets/") ? pathname.split("/")[2] : null;
      setNewFolder(folderId ?? fromPath ?? null);
      setNewOpen(true);
    },
    [pathname],
  );

  return (
    <ShellCtx value={{ openNewContent }}>
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
          {NAV.slice(2).map((item) => (
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
          <UploadProvider>
            <ShellUI>{children}</ShellUI>
          </UploadProvider>
        </DataProvider>
      </AuthGate>
    </ToastProvider>
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
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 py-4 md:px-8", className)}>{children}</div>;
}
