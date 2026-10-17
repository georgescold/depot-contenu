/**
 * Clés API : format `dpc_<43 caractères base64url>`.
 * On ne stocke en base que le hash SHA-256 (hex) et un préfixe lisible.
 * Fonctionne côté navigateur et côté serveur (Web Crypto).
 */

export const API_KEY_PREFIX = "dpc_";

export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return API_KEY_PREFIX + b64;
}

export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 6);
}

export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
