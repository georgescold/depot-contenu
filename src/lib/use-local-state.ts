"use client";

import { useCallback, useState } from "react";

function read<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial; // stockage indisponible : valeur par défaut
  }
}

/**
 * useState mémorisé dans le localStorage (préférences d'affichage uniquement).
 * Les écrans qui l'utilisent ne sont rendus que côté navigateur (après la vérification de connexion).
 */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, initial));

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key],
  );

  return [value, set];
}
