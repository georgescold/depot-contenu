"use client";

import { CheckCircle2, Download, Share, SquarePlus, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import {
  dismissBanner,
  getInstallState,
  getServerInstallState,
  iosBrowser,
  isBannerDismissed,
  promptInstall,
  subscribeDismiss,
  subscribeInstall,
  type InstallState,
} from "@/lib/install";
import { useToast } from "./Toast";
import { Button, Card, IconButton, SectionTitle } from "./ui";

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
}

/** Enregistre le service worker (app installable, page « hors connexion »), en production seulement. */
export function ServiceWorkerSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

function useInstall() {
  const toast = useToast();
  return async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast("App installée : retrouve-la sur ton écran d'accueil", "success");
  };
}

/** Étapes sur iPhone / iPad (pas d'invite automatique : on passe par le menu Partager). */
function IosSteps({ compact }: { compact?: boolean }) {
  const where =
    iosBrowser() === "chrome"
      ? "en haut, dans la barre d'adresse"
      : iosBrowser() === "safari"
        ? "en bas de l'écran, ou dans le menu « ••• »"
        : "dans le menu du navigateur";
  if (compact) {
    return (
      <>
        Touche <Share className="inline size-3.5 align-[-2px]" aria-label="Partager" /> Partager, puis « Sur l&apos;écran
        d&apos;accueil ».
      </>
    );
  }
  return (
    <ol className="list-decimal space-y-1 pl-5">
      <li>
        Touche le bouton <Share className="inline size-4 align-[-3px]" aria-label="Partager" /> <b>Partager</b> ({where}).
      </li>
      <li>
        Choisis <SquarePlus className="inline size-4 align-[-3px]" aria-hidden /> <b>Sur l&apos;écran d&apos;accueil</b>{" "}
        (fais défiler la liste si besoin).
      </li>
      <li>
        Touche <b>Ajouter</b> : l&apos;icône « Dépôt » apparaît avec tes autres apps.
      </li>
    </ol>
  );
}

/** Bandeau en haut de l'app sur téléphone, tant que l'app n'est pas installée (« Plus tard » le masque 30 jours). */
export function InstallBanner() {
  const state = useInstallState();
  const dismissed = useSyncExternalStore(subscribeDismiss, isBannerDismissed, () => true);
  const install = useInstall();
  if (dismissed || (state !== "prompt" && state !== "ios")) return null;

  return (
    <div className="border-b border-accent/15 bg-accent-soft md:hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <img src="/icons/icon-192.png" alt="" className="size-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 leading-snug">
          <p className="text-sm font-semibold">Installe l&apos;app sur ton téléphone</p>
          <p className="text-xs text-muted">
            {state === "ios" ? <IosSteps compact /> : "Ouverture en un geste, en plein écran, comme une vraie app."}
          </p>
        </div>
        {state === "prompt" && (
          <Button size="sm" variant="primary" onClick={install}>
            Installer
          </Button>
        )}
        <IconButton label="Plus tard" className="-mr-2 size-8 shrink-0" onClick={dismissBanner}>
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * Sur la page de connexion : proposer l'installation d'abord (sur iPhone, l'app installée a sa propre connexion,
 * autant s'y connecter directement).
 */
export function InstallLoginCard() {
  const state = useInstallState();
  const install = useInstall();
  if (state !== "prompt" && state !== "ios") return null;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left">
      <img src="/icons/icon-192.png" alt="" className="size-9 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-sm font-semibold">Installer l&apos;app</p>
        <p className="text-xs text-muted">
          {state === "ios" ? (
            <>
              <IosSteps compact /> Connecte-toi ensuite dans l&apos;app installée.
            </>
          ) : (
            "Une icône sur ton écran d'accueil, ouverture en plein écran."
          )}
        </p>
      </div>
      {state === "prompt" && (
        <Button size="sm" variant="primary" onClick={install}>
          Installer
        </Button>
      )}
    </div>
  );
}

/** Bouton discret dans la barre latérale (ordinateur), quand Chrome / Edge proposent l'installation. */
export function InstallSidebarButton() {
  const state = useInstallState();
  const install = useInstall();
  if (state !== "prompt") return null;
  return (
    <div className="border-t border-line p-3">
      <Button variant="ghost" size="sm" className="w-full justify-start" icon={<Download className="size-4" />} onClick={install}>
        Installer l&apos;app
      </Button>
    </div>
  );
}

/** Section « Application » des Réglages : toujours accessible, même après « Plus tard ». */
export function InstallSection() {
  const state = useInstallState();
  const install = useInstall();
  if (state === "unknown") return null;

  return (
    <section>
      <SectionTitle>Application</SectionTitle>
      <Card className="space-y-3 p-4 text-sm">
        {state === "installed" ? (
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-success" />
            L&apos;app est installée sur cet appareil.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-xl" />
              <p className="min-w-0 flex-1 text-muted">
                Installe Dépôt contenu sur ton téléphone ou ton ordinateur : une icône sur l&apos;écran d&apos;accueil, ouverture
                en plein écran, sans passer par le navigateur.
              </p>
            </div>
            {state === "prompt" && (
              <Button variant="primary" icon={<Download className="size-4" />} onClick={install}>
                Installer l&apos;application
              </Button>
            )}
            {state === "ios" && <IosSteps />}
            {state === "android" && (
              <p>
                Ouvre le menu <b>⋮</b> du navigateur, puis <b>Installer l&apos;application</b> (ou <b>Ajouter à l&apos;écran
                d&apos;accueil</b>).
              </p>
            )}
            {state === "desktop" && (
              <div className="space-y-1.5">
                <p>
                  <b>Chrome ou Edge</b> : icône d&apos;installation à droite de la barre d&apos;adresse (ou menu ⋮ → « Installer
                  Dépôt contenu »). <b>Safari sur Mac</b> : Fichier → « Ajouter au Dock ».
                </p>
                <p className="text-muted">
                  Sur téléphone : ouvre <b>{typeof window === "undefined" ? "" : window.location.host}</b> dans le navigateur,
                  connecte-toi, puis suis la proposition d&apos;installation.
                </p>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
