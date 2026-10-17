import type { NextRequest } from "next/server";
import { MAX_FILE_MB } from "@/lib/constants";
import { handle, json } from "@/lib/api/http";
import { appOrigin } from "@/lib/api/serialize";
import { todayParis } from "@/lib/api/validate";

/** GET /api/v1/me : infos sur la clé utilisée. */
export async function GET(req: NextRequest) {
  return handle(req, async (key) =>
    json({
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
        today: todayParis(),
      },
    }),
  );
}
