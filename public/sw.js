/*
 * Service worker de l'app installable « Dépôt contenu ».
 * Rôle volontairement minimal : rendre l'app installable et afficher une page « hors connexion »
 * au lieu de l'erreur du navigateur. Rien d'autre n'est mis en cache (jamais les données ni les fichiers).
 */
const CACHE = "depot-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // pages de l'app seulement : le réseau d'abord, la page « hors connexion » s'il ne répond pas
  if (req.method !== "GET" || req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
