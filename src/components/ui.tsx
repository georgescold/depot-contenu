"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { twMerge } from "tailwind-merge";
import { PLATFORMS } from "@/lib/constants";
import type { Platform } from "@/lib/types";

/** Concatène des classes Tailwind ; en cas de conflit (w-full / w-28…), la dernière gagne. */
export function cn(...parts: (string | false | null | undefined)[]) {
  return twMerge(parts.filter(Boolean).join(" "));
}

/* ------------------------------------------------------------------ */
/* Boutons                                                             */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger-soft text-danger hover:opacity-90",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition select-none",
        "disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Champs                                                              */
/* ------------------------------------------------------------------ */

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3 text-ink placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, "h-10", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(fieldBase, "h-10 appearance-auto pr-8", className)}>
      {children}
    </select>
  );
}

/**
 * Libellé + champ. `group` pour un groupe de boutons/puces : on n'utilise alors pas de <label>
 * (toucher le libellé ou un espace activerait le premier bouton).
 */
export function Field({
  label,
  hint,
  children,
  className,
  group,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  group?: boolean;
}) {
  const inner = (
    <>
      <span className="block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </>
  );
  return group ? (
    <div role="group" className={cn("block space-y-1.5", className)}>
      {inner}
    </div>
  ) : (
    <label className={cn("block space-y-1.5", className)}>{inner}</label>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre modale (feuille du bas sur mobile)                          */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface shadow-2xl md:rounded-3xl",
          wide ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Fermer" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Petits éléments                                                     */
/* ------------------------------------------------------------------ */

const TONES: Record<string, string> = {
  neutral: "bg-surface-2 text-muted",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        TONES[tone] ?? TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PlatformBadge({
  platform,
  size = "md",
  posted,
  className,
}: {
  platform: Platform;
  size?: "sm" | "md" | "lg";
  posted?: boolean;
  className?: string;
}) {
  const p = PLATFORMS[platform] ?? PLATFORMS.other;
  return (
    <span
      title={p.label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-md font-bold tracking-tight ring-1 ring-black/5",
        size === "sm" && "size-5 text-[9px]",
        size === "md" && "size-7 text-[11px]",
        size === "lg" && "size-9 text-xs",
        className,
      )}
      style={{ background: p.color, color: p.ink }}
    >
      {p.short}
      {posted && (
        <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-success text-white ring-2 ring-surface">
          <Check className="size-2.5" strokeWidth={4} />
        </span>
      )}
    </span>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-5 animate-spin text-muted", className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Case « posté » ronde, grande zone tactile. */
export function PostedCheck({
  checked,
  onChange,
  label = "Posté",
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  size?: "md" | "lg";
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={checked ? "Posté (cliquer pour annuler)" : "Marquer comme posté"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90",
        size === "md" ? "size-7" : "size-9",
        checked
          ? "border-success bg-success text-white"
          : "border-line bg-surface text-transparent hover:border-success hover:text-success/40",
      )}
    >
      <Check className={size === "md" ? "size-4" : "size-5"} strokeWidth={3.5} />
    </button>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

/** Sélecteur segmenté (onglets compacts). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-lg px-3 text-[13px] font-medium transition",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Puce cliquable (filtres). */
export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition",
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-ink",
      )}
    >
      {color && <ColorDot color={color} />}
      {children}
    </button>
  );
}
