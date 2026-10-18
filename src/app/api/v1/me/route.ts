import type { NextRequest } from "next/server";
import { creditsOfAllTokens } from "@/lib/apify";
import { getArchiveDelay } from "@/lib/archive";
import { archiveDelayLabel } from "@/lib/archive-rules";
import { MAX_FILE_MB, MULTIPART_THRESHOLD } from "@/lib/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { handle, json } from "@/lib/api/http";
import { appOrigin } from "@/lib/api/serialize";
import { parseBool, todayParis } from "@/lib/api/validate";

/**
 * GET /api/v1/me : infos sur la clé utilisée et réglages utiles (lecture seule).
 * Le délai d'archivage ne se règle que dans l'app (Réglages) : l'API ne fait que le lire.
 */
export async function GET(req: NextRequest) {
  return handle(req, async (key) => {
    const withCredit = parseBool(req.nextUrl.searchParams.get("credit") ?? "true") !== false;
    const [archiveDays, credit] = await Promise.all([getArchiveDelay(getAdminClient()), withCredit ? apifyCredit() : null]);
    return json({
      key: {
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        created_at: key.created_at,
        last_used_at: key.last_used_at,
      },
      app: {
        url: appOrigin(req),
        max_file_mb: MAX_FILE_MB,
        multipart_threshold_bytes: MULTIPART_THRESHOLD,
        max_files_per_request: 100,
        today: todayParis(),
        /** Jours entre la dernière publication et le retrait des fichiers ; null = jamais. Lecture seule. */
        archive_after_days: archiveDays,
        archive_after_label: archiveDelayLabel(archiveDays),
        // Crédit Apify (collecte des statistiques) : total restant et nombre de clés, jamais les clés elles-mêmes.
        ...(credit ?? {}),
      },
    });
  });
}

/** Total du crédit Apify restant ce mois-ci, toutes clés confondues (délai max 8 s). */
async function apifyCredit() {
  try {
    const credits = await Promise.race([
      creditsOfAllTokens(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("délai dépassé")), 8000)),
    ]);
    const ok = credits.filter((c) => !c.error);
    return {
      apify_credit_remaining_usd: ok.length ? Math.round(ok.reduce((n, c) => n + c.remainingUsd, 0) * 100) / 100 : null,
      apify_keys: credits.length,
      apify_keys_ok: ok.length,
    };
  } catch (e) {
    return {
      apify_credit_remaining_usd: null,
      apify_keys: null,
      apify_keys_ok: null,
      apify_credit_error: e instanceof Error ? e.message : String(e),
    };
  }
}
