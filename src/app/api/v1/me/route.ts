import type { NextRequest } from "next/server";
import { getArchiveDelay } from "@/lib/archive";
import { archiveDelayLabel } from "@/lib/archive-rules";
import { MAX_FILE_MB, MULTIPART_THRESHOLD } from "@/lib/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { handle, json } from "@/lib/api/http";
import { appOrigin } from "@/lib/api/serialize";
import { todayParis } from "@/lib/api/validate";

/**
 * GET /api/v1/me : infos sur la clé utilisée et réglages utiles (lecture seule).
 * Le délai d'archivage ne se règle que dans l'app (Réglages) : l'API ne fait que le lire.
 */
export async function GET(req: NextRequest) {
  return handle(req, async (key) => {
    const archiveDays = await getArchiveDelay(getAdminClient());
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
      },
    });
  });
}
