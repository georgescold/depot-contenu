"use client";

import { BarChart3, Bookmark, ExternalLink, Eye, Heart, MessageCircle, RefreshCw, Repeat2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageBody, PageHeader, Splash } from "@/components/AppShell";
import { useData } from "@/components/data/DataProvider";
import { FolderPicker } from "@/components/FolderPicker";
import { PersonBadge, PersonFilter } from "@/components/people";
import { useStats, type CreditInfo, type RunInfo } from "@/components/stats/useStats";
import { useToast } from "@/components/Toast";
import { Button, Card, cn, EmptyState, PlatformBadge, Segmented, SectionTitle } from "@/components/ui";
import { effectiveAssignee, UNASSIGNED } from "@/lib/assignee";
import { PLATFORMS } from "@/lib/constants";
import { descendantIds, folderPath } from "@/lib/folders";
import { dateTimeLabel, shortDate } from "@/lib/format";
import { postIdFromUrl } from "@/lib/post-id";
import { compactNumber, engagementRate, fullNumber, percent, signedCompact } from "@/lib/stats-format";
import { scraperInput } from "@/lib/stats-input";
import type { Account, AccountStatsDay, PostStat } from "@/lib/types";
import { useLocalState } from "@/lib/use-local-state";

const STATS_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
const DAY = 24 * 3600 * 1000;
/** coût approximatif d'une collecte par compte (Apify), pour prévenir avant « Actualiser » */
const COST_PER_ACCOUNT: Record<string, number> = { tiktok: 0.045, instagram: 0.003, youtube: 0.056 };
const KIND_LABEL: Record<string, string> = { video: "Vidéo", short: "Short", reel: "Reel", carousel: "Carrousel", photo: "Photo" };

type Period = "7" | "30" | "90" | "all";

function sum(posts: PostStat[], key: "views" | "likes" | "comments" | "shares" | "saves") {
  let total = 0;
  let any = false;
  for (const p of posts) {
    if (p[key] !== null) {
      total += p[key]!;
      any = true;
    }
  }
  return any ? total : null;
}

/** Abonnés actuels et variation sur ~7 jours (si l'historique le permet). */
function followerTrend(days: AccountStatsDay[]) {
  const withValue = days.filter((d) => d.followers !== null).sort((a, b) => a.day.localeCompare(b.day));
  const last = withValue.at(-1);
  if (!last) return { followers: null, delta: null, since: null };
  const target = new Date(Date.parse(last.day) - 7 * DAY).toISOString().slice(0, 10);
  const base = [...withValue].reverse().find((d) => d.day <= target) ?? (withValue[0] !== last ? withValue[0] : undefined);
  return { followers: last.followers, delta: base ? last.followers! - base.followers! : null, since: base?.day ?? null };
}

export default function StatsPage() {
  const { accounts, index, personById, contents, ready } = useData();
  const stats = useStats();
  const toast = useToast();
  const [period, setPeriod] = useLocalState<Period>("stats.period", "30");
  const [folderId, setFolderId] = useLocalState("stats.folder", "");
  const [personId, setPersonId] = useLocalState("stats.person", "");
  const [sort, setSort] = useLocalState<"recent" | "views">("stats.sort", "recent");
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);
  const [refreshing, setRefreshing] = useState(false);
  // heure de référence de l'écran (mise à jour à chaque actualisation)
  const [now, setNow] = useState(() => Date.now());

  const activePerson = personId === UNASSIGNED || personById.has(personId) ? personId : "";
  const scope = useMemo(() => (folderId && index.byId.has(folderId) ? descendantIds(index, folderId) : null), [folderId, index]);

  const accountPerson = (a: Account) => effectiveAssignee(index, { folder_id: a.folder_id, assignee_id: null }, a);

  const scopedAccounts = useMemo(
    () =>
      accounts
        .filter((a) => (STATS_PLATFORMS as readonly string[]).includes(a.platform))
        .filter((a) => !scope || scope.has(a.folder_id))
        .filter((a) => !activePerson || (accountPerson(a)?.personId ?? UNASSIGNED) === activePerson),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, scope, activePerson, index],
  );
  const scopedIds = useMemo(() => new Set(scopedAccounts.map((a) => a.id)), [scopedAccounts]);
  const cutoff = period === "all" ? null : new Date(now - Number(period) * DAY).toISOString();

  const periodPosts = useMemo(
    () =>
      stats.posts.filter(
        (p) => scopedIds.has(p.account_id) && (!cutoff || (p.published_at !== null && p.published_at >= cutoff)),
      ),
    [stats.posts, scopedIds, cutoff],
  );

  const daysByAccount = useMemo(() => {
    const m = new Map<string, AccountStatsDay[]>();
    for (const d of stats.days) {
      const list = m.get(d.account_id) ?? [];
      list.push(d);
      m.set(d.account_id, list);
    }
    return m;
  }, [stats.days]);

  // lien post collecté -> contenu de l'app (par publication reliée, ou par l'identifiant du « Lien du post »)
  const contentForPost = useMemo(() => {
    const byPub = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const c of contents) {
      for (const p of c.publications) {
        byPub.set(p.id, c.id);
        const acc = accounts.find((a) => a.id === p.account_id);
        const pid = acc ? postIdFromUrl(acc.platform, p.post_url) : null;
        if (pid) byKey.set(`${p.account_id}|${pid}`, c.id);
      }
    }
    return (p: PostStat) => (p.publication_id ? byPub.get(p.publication_id) : undefined) ?? byKey.get(`${p.account_id}|${p.external_id}`);
  }, [contents, accounts]);

  if (!ready) return <Splash />;

  const totals = {
    posts: periodPosts.length,
    views: sum(periodPosts, "views"),
    likes: sum(periodPosts, "likes"),
    comments: sum(periodPosts, "comments"),
    shares: sum(periodPosts, "shares"),
    engagement: engagementRate({
      views: sum(periodPosts, "views"),
      likes: sum(periodPosts, "likes"),
      comments: sum(periodPosts, "comments"),
      shares: sum(periodPosts, "shares"),
      saves: sum(periodPosts, "saves"),
    }),
  };
  const followerRows = scopedAccounts.map((a) => followerTrend(daysByAccount.get(a.id) ?? []));
  const followersTotal = followerRows.some((r) => r.followers !== null) ? followerRows.reduce((n, r) => n + (r.followers ?? 0), 0) : null;
  const followersDelta = followerRows.some((r) => r.delta !== null) ? followerRows.reduce((n, r) => n + (r.delta ?? 0), 0) : null;

  const lastUpdate = stats.runs.find((r) => r.status === "INGESTED")?.ingested_at ?? null;
  const running = stats.runs.some((r) => r.status !== "INGESTED" && r.status !== "FAILED" && now - Date.parse(r.started_at) < 30 * 60 * 1000);

  const listed = periodPosts
    .filter((p) => !accountFilter || p.account_id === accountFilter)
    .sort((a, b) =>
      sort === "views" ? (b.views ?? -1) - (a.views ?? -1) : (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    );

  const refresh = async () => {
    const all = accounts.filter((a) => (STATS_PLATFORMS as readonly string[]).includes(a.platform));
    const cost = all.reduce((n, a) => n + (COST_PER_ACCOUNT[a.platform] ?? 0), 0);
    if (!confirm(`Lancer une collecte maintenant pour ${all.length} compte(s) ?\n\nCoût estimé : ~${cost.toFixed(2)} $ de crédit Apify. Résultats dans 1 à 2 minutes.`)) return;
    setRefreshing(true);
    const ok = await stats.refreshNow();
    setRefreshing(false);
    if (!ok) return toast(stats.error ?? "Collecte impossible", "error");
    setNow(Date.now());
    toast("Collecte lancée : les chiffres arrivent dans 1 à 2 minutes.", "success");
    const later = () => stats.reload().then(() => setNow(Date.now()));
    setTimeout(later, 70_000);
    setTimeout(later, 150_000);
  };

  const statsAccounts = accounts.filter((a) => (STATS_PLATFORMS as readonly string[]).includes(a.platform));

  return (
    <>
      <PageHeader
        title="Statistiques"
        subtitle={
          running
            ? "Collecte en cours…"
            : lastUpdate
              ? `Mis à jour le ${dateTimeLabel(lastUpdate)} · collecte automatique chaque nuit vers minuit`
              : "Collecte automatique chaque nuit vers minuit"
        }
        actions={
          statsAccounts.length > 0 && (
            <Button size="sm" icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={running} onClick={refresh}>
              <span className="hidden sm:inline">Actualiser</span>
            </Button>
          )
        }
      >
        <div className="space-y-2">
          <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            <PersonFilter value={activePerson} onChange={setPersonId} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FolderPicker
              allowEmpty
              value={folderId && index.byId.has(folderId) ? folderId : ""}
              onChange={setFolderId}
              className="h-9 w-auto max-w-56"
            />
            <Segmented
              value={period}
              onChange={setPeriod}
              options={[
                { value: "7", label: "7 j" },
                { value: "30", label: "30 j" },
                { value: "90", label: "90 j" },
                { value: "all", label: "Tout" },
              ]}
            />
          </div>
        </div>
      </PageHeader>

      <PageBody className="space-y-8">
        {stats.error && (
          <p className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            <TriangleAlert className="size-4 shrink-0" /> {stats.error}
          </p>
        )}

        {!statsAccounts.length ? (
          <EmptyState icon={<BarChart3 className="size-8" />} title="Aucun compte à suivre">
            Ajoute tes comptes TikTok, Instagram ou YouTube dans un projet (avec leur @pseudo ou le lien du profil) : leurs
            statistiques seront relevées chaque nuit.
          </EmptyState>
        ) : !stats.posts.length && !stats.loading ? (
          <EmptyState
            icon={<BarChart3 className="size-8" />}
            title="Pas encore de statistiques"
            action={
              <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={refreshing} disabled={running} onClick={refresh}>
                Lancer une première collecte
              </Button>
            }
          >
            {running
              ? "Une collecte est en cours : les chiffres arrivent dans 1 à 2 minutes."
              : "La première collecte aura lieu cette nuit vers minuit, ou maintenant si tu préfères."}
          </EmptyState>
        ) : (
          <>
            {/* Chiffres clés */}
            <section>
              <SectionTitle>
                {period === "all" ? "Tous les posts suivis" : `Posts publiés ces ${period} derniers jours`}
              </SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label="Abonnés" value={compactNumber(followersTotal)} delta={followersDelta} deltaLabel="en 7 j" />
                <StatTile label="Posts" value={fullNumber(totals.posts)} />
                <StatTile label="Vues" value={compactNumber(totals.views)} />
                <StatTile label="Likes" value={compactNumber(totals.likes)} />
                <StatTile label="Commentaires" value={compactNumber(totals.comments)} />
                <StatTile label="Engagement" value={percent(totals.engagement)} hint="(likes + commentaires + partages + enregistrements) ÷ vues" />
              </div>
            </section>

            {/* Comptes */}
            <section>
              <SectionTitle
                action={
                  accountFilter && (
                    <Button size="sm" variant="ghost" onClick={() => setAccountFilter(null)}>
                      Tous les comptes
                    </Button>
                  )
                }
              >
                Comptes · {scopedAccounts.length}
              </SectionTitle>
              {scopedAccounts.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {scopedAccounts.map((a, i) => {
                    const posts = periodPosts.filter((p) => p.account_id === a.id);
                    const views = sum(posts, "views");
                    const eff = accountPerson(a);
                    const trend = followerRows[i];
                    const missing = !scraperInput(a);
                    const active = accountFilter === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAccountFilter(active ? null : a.id)}
                        className={cn(
                          "rounded-2xl border bg-surface p-3 text-left transition",
                          active ? "border-accent ring-2 ring-accent/20" : "border-line hover:border-accent/50",
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <PlatformBadge platform={a.platform} size="lg" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{a.handle || PLATFORMS[a.platform].label}</p>
                            <p className="truncate text-xs text-muted">{folderPath(index, a.folder_id)}</p>
                          </div>
                          {eff && <PersonBadge person={personById.get(eff.personId)} size="sm" muted={eff.source !== "account"} />}
                        </div>
                        {missing || a.stats_error ? (
                          <p className="mt-3 flex items-start gap-1.5 text-xs text-warning">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                            {missing
                              ? "Pseudo ou lien du profil manquant : modifie le compte dans son projet pour suivre ses stats."
                              : a.stats_error}
                          </p>
                        ) : (
                          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                            <div>
                              <dt className="text-[11px] text-muted">Abonnés</dt>
                              <dd className="text-sm font-semibold">{compactNumber(trend.followers)}</dd>
                              {trend.delta !== null && (
                                <dd className={cn("text-[11px]", trend.delta > 0 ? "text-success" : trend.delta < 0 ? "text-danger" : "text-muted")}>
                                  {signedCompact(trend.delta)}
                                </dd>
                              )}
                            </div>
                            <div>
                              <dt className="text-[11px] text-muted">Posts</dt>
                              <dd className="text-sm font-semibold">{posts.length}</dd>
                            </div>
                            <div>
                              <dt className="text-[11px] text-muted">Vues moy.</dt>
                              <dd className="text-sm font-semibold">
                                {posts.length && views !== null ? compactNumber(Math.round(views / posts.length)) : "–"}
                              </dd>
                            </div>
                          </dl>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted">Aucun compte ne correspond aux filtres.</p>
              )}
            </section>

            {/* Posts */}
            <section>
              <SectionTitle
                action={
                  <Segmented
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "recent", label: "Récents" },
                      { value: "views", label: "Plus vus" },
                    ]}
                  />
                }
              >
                Posts · {listed.length}
              </SectionTitle>
              {listed.length ? (
                <div className="space-y-2">
                  {listed.slice(0, limit).map((p) => (
                    <PostRow
                      key={p.id}
                      post={p}
                      account={accounts.find((a) => a.id === p.account_id)}
                      contentId={contentForPost(p)}
                    />
                  ))}
                  {listed.length > limit && (
                    <div className="pt-2 text-center">
                      <Button variant="secondary" onClick={() => setLimit((l) => l + 40)}>
                        Voir plus ({listed.length - limit})
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">Aucun post publié sur cette période pour ces comptes.</p>
              )}
            </section>
          </>
        )}

        {statsAccounts.length > 0 && <CollectInfo credits={stats.credits} runs={stats.runs} />}
      </PageBody>
    </>
  );
}

function StatTile({
  label,
  value,
  delta,
  deltaLabel,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  hint?: string;
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted" title={hint}>
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {delta !== undefined && delta !== null && (
        <p className={cn("text-xs", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted")}>
          {signedCompact(delta)} {deltaLabel}
        </p>
      )}
    </Card>
  );
}

function PostRow({ post, account, contentId }: { post: PostStat; account?: Account; contentId?: string }) {
  const [imgOk, setImgOk] = useState(!!post.thumbnail_url);
  const metrics: { icon: typeof Eye; value: number | null; label: string }[] = [
    { icon: Eye, value: post.views, label: "vues" },
    { icon: Heart, value: post.likes, label: "likes" },
    { icon: MessageCircle, value: post.comments, label: "commentaires" },
    { icon: Repeat2, value: post.shares, label: "partages" },
    { icon: Bookmark, value: post.saves, label: "enregistrements" },
  ];
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-surface p-2.5">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
        {imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/stats/thumb/${post.id}`}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PlatformBadge platform={post.platform} size="md" />
          </div>
        )}
        {imgOk && <PlatformBadge platform={post.platform} size="sm" className="absolute bottom-1 left-1" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug">{post.caption || <span className="text-muted">(sans légende)</span>}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          {account?.handle} · {KIND_LABEL[post.kind] ?? post.kind}
          {post.published_at && ` · ${shortDate(post.published_at.slice(0, 10))}`}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {metrics
            .filter((m) => m.value !== null)
            .map(({ icon: Icon, value, label }) => (
              <span key={label} className="flex items-center gap-1 tabular-nums" title={`${fullNumber(value)} ${label}`}>
                <Icon className="size-3.5 text-muted" />
                {compactNumber(value)}
              </span>
            ))}
          {engagementRate(post) !== null && <span className="text-muted">· {percent(engagementRate(post))}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        {/^https?:\/\//.test(post.url) && (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Ouvrir le post"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
        {contentId && (
          <Link href={`/contenus/${contentId}`} className="text-xs font-medium text-accent">
            Contenu
          </Link>
        )}
      </div>
    </div>
  );
}

function CollectInfo({ credits, runs }: { credits: CreditInfo[]; runs: RunInfo[] }) {
  const remaining = credits.reduce((n, c) => n + (c.error ? 0 : c.remainingUsd), 0);
  const max = credits.reduce((n, c) => n + (c.error ? 0 : c.maxUsd), 0);
  return (
    <details className="rounded-2xl border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer list-none font-medium">
        Crédit Apify : {remaining.toFixed(2).replace(".", ",")} $ restants ce mois sur {max.toFixed(0)} $ ({credits.length} clé
        {credits.length > 1 ? "s" : ""})
      </summary>
      <div className="mt-3 space-y-3 text-xs text-muted">
        <ul className="space-y-1">
          {credits.map((c) => (
            <li key={c.index}>
              Clé {c.index + 1} :{" "}
              {c.error
                ? `erreur (${c.error})`
                : `${c.remainingUsd.toFixed(2).replace(".", ",")} $ restants${c.cycleEnd ? ` · renouvelé le ${shortDate(c.cycleEnd.slice(0, 10))}` : ""}`}
            </li>
          ))}
        </ul>
        <p>Les clés sont utilisées dans l&apos;ordre : quand le crédit de l&apos;une est épuisé, la suivante prend le relais.</p>
        {runs.length > 0 && (
          <ul className="space-y-1">
            {runs.map((r, i) => (
              <li key={i}>
                {dateTimeLabel(r.started_at)} · {PLATFORMS[r.platform as keyof typeof PLATFORMS]?.label ?? r.platform} ·{" "}
                {r.status === "INGESTED"
                  ? `${r.posts ?? 0} posts${r.cost_usd !== null ? ` · ${Number(r.cost_usd).toFixed(3).replace(".", ",")} $` : ""}`
                  : r.status === "FAILED"
                    ? "échec"
                    : "en cours"}
                {r.token_index >= 0 && ` · clé ${r.token_index + 1}`}
                {r.trigger === "manual" && " · manuelle"}
                {r.error && <span className="text-danger"> · {r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
