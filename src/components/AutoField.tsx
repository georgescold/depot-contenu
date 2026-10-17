"use client";

import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { cn } from "./ui";

const base =
  "w-full rounded-xl border border-line bg-surface px-3 text-ink placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * Champ texte qui s'enregistre tout seul (après une courte pause de frappe, et en quittant le champ).
 * Ne se fait pas écraser par un rechargement des données pendant qu'on tape.
 */
export function AutoField({
  value,
  onCommit,
  multiline,
  delay = 700,
  className,
  minRows = 3,
  ...props
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  delay?: number;
  minRows?: number;
} & Omit<InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement>, "value" | "onChange">) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);
  const localRef = useRef(value);
  const commitRef = useRef(onCommit);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  // valeur externe (rechargement, autre membre) : on la prend si on n'est pas en train d'écrire
  useEffect(() => {
    if (focused || timer.current) return;
    committed.current = value;
    localRef.current = value;
    setLocal(value);
  }, [value, focused]);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = localRef.current;
    if (v !== committed.current) {
      committed.current = v;
      commitRef.current(v);
    }
  };

  // enregistre ce qui reste en quittant la page
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [local, multiline]);

  const handlers = {
    value: local,
    onChange: (e: { target: { value: string } }) => {
      const v = e.target.value;
      localRef.current = v;
      setLocal(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      flush();
    },
  };

  if (multiline) {
    return (
      <textarea
        ref={areaRef}
        rows={minRows}
        {...(props as object)}
        {...handlers}
        className={cn(base, "resize-none overflow-hidden py-2.5 leading-relaxed", className)}
      />
    );
  }
  return <input {...props} {...handlers} className={cn(base, "h-10", className)} />;
}
