/**
 * Installation de l'app (écran d'accueil du téléphone, app de bureau) : état de l'appareil
 * et invite d'installation du navigateur (Chrome, Edge, Samsung Internet).
 */

/**
 * - installed : l'app tourne déjà installée (plein écran)
 * - prompt : le navigateur propose son invite d'installation (bouton « Installer »)
 * - ios : iPhone / iPad, installation par le menu Partager
 * - android / desktop : pas d'invite disponible, installation par le menu du navigateur
 * - unknown : rendu serveur
 */
export type InstallState = "unknown" | "installed" | "prompt" | "ios" | "android" | "desktop";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __depotInstall?: BeforeInstallPromptEvent | null;
  }
}

export const INSTALL_EVENT = "depot:install";

/**
 * Script chargé avant React : le navigateur peut proposer l'installation avant que l'app soit prête,
 * on garde donc son invite de côté (et on masque sa petite barre, remplacée par la nôtre).
 */
export const CAPTURE_INSTALL_SCRIPT = `
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  window.__depotInstall = e;
  window.dispatchEvent(new Event("${INSTALL_EVENT}"));
});
window.addEventListener("appinstalled", function () {
  window.__depotInstall = null;
  window.dispatchEvent(new Event("${INSTALL_EVENT}"));
});
`;

export function subscribeInstall(onChange: () => void): () => void {
  const standalone = window.matchMedia("(display-mode: standalone)");
  window.addEventListener(INSTALL_EVENT, onChange);
  standalone.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_EVENT, onChange);
    standalone.removeEventListener("change", onChange);
  };
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // les iPad récents se présentent comme un Mac : on les reconnaît à l'écran tactile
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function getInstallState(): InstallState {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true) return "installed";
  if (window.__depotInstall) return "prompt";
  if (isIos()) return "ios";
  if (/Android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

export const getServerInstallState = (): InstallState => "unknown";

/** Navigateur sur iPhone / iPad : le bouton Partager n'est pas au même endroit. */
export function iosBrowser(): "safari" | "chrome" | "other" {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS/.test(ua)) return "other";
  return "safari";
}

/** Ouvre l'invite d'installation du navigateur (une seule fois par invite). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = window.__depotInstall;
  if (!event) return "unavailable";
  window.__depotInstall = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  window.dispatchEvent(new Event(INSTALL_EVENT));
  return outcome;
}

/* Bandeau « Installer l'app » masqué pour un temps quand on clique sur « Plus tard » (sur cet appareil). */

const DISMISS_KEY = "depot-install-dismissed-until";
const DISMISS_DAYS = 30;
const DISMISS_EVENT = "depot:install-dismiss";
/** repli si le stockage du navigateur est indisponible (navigation privée) : masqué jusqu'au prochain chargement */
let dismissedThisSession = false;

export function subscribeDismiss(onChange: () => void): () => void {
  window.addEventListener(DISMISS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function isBannerDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

export function dismissBanner(): void {
  dismissedThisSession = true;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 3600 * 1000));
  } catch {
    // stockage indisponible : le repli en mémoire suffit
  }
  window.dispatchEvent(new Event(DISMISS_EVENT));
}
