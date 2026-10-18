/**
 * Accès à Apify côté serveur : plusieurs clés (APIFY_TOKENS, séparées par des virgules ou des retours à la ligne),
 * utilisées dans l'ordre ; on passe à la suivante quand le crédit mensuel de l'une est épuisé.
 * Les clés ne sont jamais stockées en base : on ne garde que leur numéro (0, 1, 2…).
 */

const API = "https://api.apify.com/v2";

export function apifyTokens(): string[] {
  return (process.env.APIFY_TOKENS ?? "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function tokenAt(index: number): string {
  const t = apifyTokens()[index];
  if (!t) throw new Error(`Clé Apify n°${index + 1} introuvable (APIFY_TOKENS)`);
  return t;
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T | null; error: string | null; errorType: string | null }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { type?: string; message?: string } } | T[] | null;
  if (Array.isArray(json)) return { status: res.status, data: json as unknown as T, error: null, errorType: null };
  if (!res.ok) {
    const err = (json as { error?: { type?: string; message?: string } } | null)?.error;
    return { status: res.status, data: null, error: err?.message ?? `HTTP ${res.status}`, errorType: err?.type ?? null };
  }
  return { status: res.status, data: ((json as { data?: T } | null)?.data ?? null) as T | null, error: null, errorType: null };
}

export interface CreditInfo {
  index: number;
  username: string | null;
  usedUsd: number;
  maxUsd: number;
  remainingUsd: number;
  cycleEnd: string | null;
  error?: string;
}

/** Crédit mensuel de chaque clé (sans jamais renvoyer la clé elle-même). */
export async function creditsOfAllTokens(): Promise<CreditInfo[]> {
  return Promise.all(
    apifyTokens().map(async (token, index) => {
      const [me, lim] = await Promise.all([
        call<{ username: string }>(token, "/users/me"),
        call<{ limits: { maxMonthlyUsageUsd: number }; current: { monthlyUsageUsd: number }; monthlyUsageCycle: { endAt: string } }>(
          token,
          "/users/me/limits",
        ),
      ]);
      if (!lim.data) {
        return { index, username: null, usedUsd: 0, maxUsd: 0, remainingUsd: 0, cycleEnd: null, error: lim.error ?? "clé refusée" };
      }
      const max = lim.data.limits?.maxMonthlyUsageUsd ?? 0;
      const used = lim.data.current?.monthlyUsageUsd ?? 0;
      return {
        index,
        username: me.data?.username ?? null,
        usedUsd: used,
        maxUsd: max,
        remainingUsd: Math.max(0, max - used),
        cycleEnd: lim.data.monthlyUsageCycle?.endAt ?? null,
      };
    }),
  );
}

export interface ApifyRun {
  id: string;
  status: string;
  statusMessage?: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
  startedAt?: string;
  finishedAt?: string;
}

const OUT_OF_CREDIT = /usage|credit|limit|payment|insufficient|not-enough/i;

/**
 * Lance un scraper avec la première clé qui a assez de crédit.
 * Si Apify refuse faute de crédit, on essaie la clé suivante.
 */
export async function startActorRun(
  actor: string,
  input: unknown,
  opts: { estimatedUsd: number; webhookUrl?: string },
): Promise<{ run: ApifyRun; tokenIndex: number } | { error: string }> {
  const credits = await creditsOfAllTokens();
  const reasons: string[] = [];
  const margin = 0.02;
  for (const c of credits) {
    if (c.error) {
      reasons.push(`clé ${c.index + 1} : ${c.error}`);
      continue;
    }
    if (c.remainingUsd < opts.estimatedUsd + margin) {
      reasons.push(`clé ${c.index + 1} : crédit insuffisant (${c.remainingUsd.toFixed(2)} $ restants)`);
      continue;
    }
    const params = new URLSearchParams();
    // plafond de dépense : jamais plus que le crédit restant de cette clé
    params.set("maxTotalChargeUsd", Math.max(0.01, Math.min(c.remainingUsd - 0.005, opts.estimatedUsd * 2 + 0.05)).toFixed(3));
    if (opts.webhookUrl) {
      const hooks = [
        {
          eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.ABORTED", "ACTOR.RUN.TIMED_OUT"],
          requestUrl: opts.webhookUrl,
        },
      ];
      params.set("webhooks", Buffer.from(JSON.stringify(hooks)).toString("base64"));
    }
    const res = await call<ApifyRun>(tokenAt(c.index), `/acts/${actor}/runs?${params}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (res.data) return { run: res.data, tokenIndex: c.index };
    reasons.push(`clé ${c.index + 1} : ${res.error}`);
    if (!(res.status === 402 || res.status === 403 || OUT_OF_CREDIT.test(`${res.errorType} ${res.error}`))) break;
  }
  return { error: reasons.length ? reasons.join(" · ") : "Aucune clé Apify configurée (APIFY_TOKENS)." };
}

export async function getRun(tokenIndex: number, runId: string): Promise<ApifyRun | null> {
  const res = await call<ApifyRun>(tokenAt(tokenIndex), `/actor-runs/${runId}`);
  return res.data;
}

export async function getDatasetItems<T>(tokenIndex: number, datasetId: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await call<T[]>(tokenAt(tokenIndex), `/datasets/${datasetId}/items?clean=true&format=json&limit=1000&offset=${offset}`);
    const page = (res.data ?? []) as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
