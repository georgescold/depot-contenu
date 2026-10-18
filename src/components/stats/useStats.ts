"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/client-fetch";
import { supabase } from "@/lib/supabase/browser";
import type { AccountStatsDay, PostStat } from "@/lib/types";

export interface CreditInfo {
  index: number;
  username: string | null;
  usedUsd: number;
  maxUsd: number;
  remainingUsd: number;
  cycleEnd: string | null;
  error?: string;
}

export interface RunInfo {
  platform: string;
  status: string;
  trigger: string;
  items: number | null;
  posts: number | null;
  cost_usd: number | null;
  error: string | null;
  started_at: string;
  ingested_at: string | null;
  token_index: number;
}

interface StatsState {
  posts: PostStat[];
  days: AccountStatsDay[];
  credits: CreditInfo[];
  runs: RunInfo[];
  loading: boolean;
  error: string | null;
}

/** Toutes les lignes d'une table, par pages de 1000 (tri stable sur l'id). */
async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase().from(table).select(select).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Statistiques collectées (lecture directe, protégée par la RLS) + état des collectes et du crédit Apify. */
export function useStats() {
  const [state, setState] = useState<StatsState>({ posts: [], days: [], credits: [], runs: [], loading: true, error: null });

  const load = useCallback(async (start = false) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // relève d'abord les collectes terminées (et en lance une si demandé)
      const status = await authedFetch<{ credits: CreditInfo[]; runs: RunInfo[] }>("/api/stats/refresh", {
        method: "POST",
        body: JSON.stringify(start ? { start: true } : {}),
      });
      const since = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const [posts, daysRes] = await Promise.all([
        fetchAll<PostStat>("post_stats", "*"),
        supabase().from("account_stats_daily").select("*").gte("day", since).order("day"),
      ]);
      if (daysRes.error) throw daysRes.error;
      setState({
        posts,
        days: (daysRes.data ?? []) as AccountStatsDay[],
        credits: status.credits,
        runs: status.runs,
        loading: false,
        error: null,
      });
      return true;
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Chargement impossible" }));
      return false;
    }
  }, []);

  useEffect(() => {
    // chargement initial
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { ...state, reload: () => load(false), refreshNow: () => load(true) };
}
