"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./ui";

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 2600);
  }, []);

  return (
    <ToastCtx value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg",
              t.tone === "error" ? "bg-danger text-white" : "bg-ink text-bg",
            )}
          >
            {t.tone === "error" ? (
              <TriangleAlert className="size-4 shrink-0" />
            ) : (
              <CircleCheck className="size-4 shrink-0" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx>
  );
}
