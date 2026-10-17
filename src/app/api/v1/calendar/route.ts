import type { NextRequest } from "next/server";
import { isLate } from "@/lib/status";
import type { Account, Content, Publication } from "@/lib/types";
import { getAdminClient } from "@/lib/supabase/admin";
import { ApiError, fetchAll, handle, json } from "@/lib/api/http";
import { accountLabel, loadAccounts, loadFolderCtx, resolveAccountRef, resolveFolder, type FolderCtx } from "@/lib/api/resolve";
import { UNASSIGNED } from "@/lib/assignee";
import { loadPeople, peopleMap, personJson, resolvePersonFilter, type PeopleMap } from "@/lib/api/people";
import { appOrigin, comparePubs, contentUrl, hhmm, pubAssignee } from "@/lib/api/serialize";
import { addDays, parseBool, parseDate, parsePlatform, todayParis } from "@/lib/api/validate";

type PubRow = Pick<
  Publication,
  "id" | "content_id" | "account_id" | "scheduled_date" | "scheduled_time" | "title" | "description" | "posted" | "posted_at" | "post_url"
> & { contents: Pick<Content, "id" | "title" | "format" | "folder_id" | "assignee_id"> | null };

const SELECT =
  "id, content_id, account_id, scheduled_date, scheduled_time, title, description, posted, posted_at, post_url, contents(id, title, format, folder_id, assignee_id)";

/** Personne effective d'une publication du calendrier (contenu → compte → dossier). */
function assigneeOf(p: PubRow, accounts: Map<string, Account>, ctx: FolderCtx, people: PeopleMap) {
  return p.contents ? pubAssignee(ctx, people, p.contents, accounts.get(p.account_id)) : null;
}

function item(p: PubRow, accounts: Map<string, Account>, ctx: FolderCtx, people: PeopleMap, origin: string, today: string) {
  const a = accounts.get(p.account_id);
  const c = p.contents;
  return {
    publication_id: p.id,
    date: p.scheduled_date,
    time: hhmm(p.scheduled_time),
    posted: p.posted,
    posted_at: p.posted_at,
    late: isLate(p, today),
    title: p.title,
    description: p.description,
    post_url: p.post_url,
    account: a
      ? { id: a.id, platform: a.platform, handle: a.handle, ref: accountLabel(a) }
      : { id: p.account_id, platform: null, handle: null, ref: null },
    content: c
      ? { id: c.id, title: c.title, format: c.format, url: contentUrl(origin, c.id) }
      : { id: p.content_id, title: null, format: null, url: contentUrl(origin, p.content_id) },
    folder_id: c?.folder_id ?? null,
    folder_path: c ? ctx.path(c.folder_id) : "",
    assignee: assigneeOf(p, accounts, ctx, people),
  };
}

/** GET /api/v1/calendar?from=&to=&folder=&account=&assignee=&include_posted= */
export async function GET(req: NextRequest) {
  return handle(req, async () => {
    const sp = req.nextUrl.searchParams;
    const today = todayParis();
    const from = sp.get("from")?.trim() ? parseDate(sp.get("from"), "from") : today;
    const to = sp.get("to")?.trim() ? parseDate(sp.get("to"), "to") : addDays(from, 30);
    if (to < from) throw new ApiError(400, `« to » (${to}) doit être postérieur ou égal à « from » (${from}).`);
    const rawInclude = sp.get("include_posted");
    const includePosted = rawInclude === null ? false : parseBool(rawInclude);
    if (includePosted === undefined) throw new ApiError(400, "« include_posted » doit valoir true ou false.");

    const sb = getAdminClient();
    const [ctx, accountList, peopleList] = await Promise.all([loadFolderCtx(sb), loadAccounts(sb), loadPeople(sb)]);
    const accounts = new Map(accountList.map((a) => [a.id, a]));
    const people = peopleMap(peopleList);
    // Personne : id, nom ou « none » (publications attribuées à personne), d'après la personne effective.
    const assigneeRef = sp.get("assignee")?.trim();
    const assigneeFilter = assigneeRef ? resolvePersonFilter(peopleList, assigneeRef) : undefined;
    const keepAssignee = (p: PubRow) => {
      if (!assigneeFilter) return true;
      const who = assigneeOf(p, accounts, ctx, people)?.id ?? null;
      return assigneeFilter === UNASSIGNED ? who === null : who === assigneeFilter;
    };

    // Filtre dossier : le dossier et tous ses sous-dossiers.
    let folderIds: Set<string> | undefined;
    let scopeAccounts = accountList;
    const folderRef = sp.get("folder")?.trim();
    if (folderRef) {
      const { folder } = await resolveFolder(sb, ctx, folderRef);
      folderIds = ctx.subtree(folder.id);
      const visible = new Set([...folderIds, ...ctx.chain(folder.id).map((f) => f.id)]);
      scopeAccounts = accountList.filter((a) => visible.has(a.folder_id));
    }

    // Filtre compte : « instagram » = tous les comptes Instagram ; sinon un compte précis.
    let accountIds: string[] | undefined;
    const accountRef = sp.get("account")?.trim();
    if (accountRef) {
      const platform = !accountRef.includes(":") && !accountRef.startsWith("@") ? parsePlatform(accountRef) : undefined;
      if (platform && scopeAccounts.some((a) => a.platform === platform)) {
        accountIds = scopeAccounts.filter((a) => a.platform === platform).map((a) => a.id);
      } else {
        const acc = resolveAccountRef(
          ctx,
          scopeAccounts.map((a) => ({ account: a, depth: 0 })),
          accountRef,
          folderRef ? `dossier « ${folderRef} »` : "tous les comptes",
        );
        accountIds = [acc.id];
      }
    }

    const base = () => {
      const q = sb.from("publications").select(SELECT).not("scheduled_date", "is", null);
      return accountIds ? q.in("account_id", accountIds) : q;
    };
    const [inRange, overdueRows] = await Promise.all([
      fetchAll<PubRow>((f, t) => {
        let q = base().gte("scheduled_date", from).lte("scheduled_date", to);
        if (!includePosted) q = q.eq("posted", false);
        return q.order("scheduled_date").order("id").range(f, t) as never;
      }, "lecture du calendrier"),
      fetchAll<PubRow>(
        (f, t) => base().lt("scheduled_date", today).eq("posted", false).order("scheduled_date").order("id").range(f, t) as never,
        "lecture des retards",
      ),
    ]);

    const origin = appOrigin(req);
    const shape = (rows: PubRow[]) =>
      rows
        .filter((p) => !folderIds || (p.contents !== null && folderIds.has(p.contents.folder_id)))
        .filter(keepAssignee)
        .map((p) => item(p, accounts, ctx, people, origin, today))
        .sort((a, b) => comparePubs({ ...a, platform: a.account.platform ?? "" }, { ...b, platform: b.account.platform ?? "" }));

    return json({
      from,
      to,
      today,
      include_posted: includePosted,
      assignee: assigneeFilter ? (assigneeFilter === UNASSIGNED ? UNASSIGNED : personJson(people, assigneeFilter)) : null,
      publications: shape(inRange),
      overdue: shape(overdueRows),
    });
  });
}
