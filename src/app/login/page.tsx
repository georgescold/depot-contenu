"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallLoginCard } from "@/components/InstallApp";
import { Button, Field, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "login" | "setup">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (data.session) return router.replace("/");
        const res = await fetch("/api/setup").then((r) => r.json()).catch(() => ({ needsSetup: false }));
        setMode(res.needsSetup ? "setup" : "login");
      });
  }, [router]);

  const login = async () => {
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError("E-mail ou mot de passe incorrect.");
    router.replace("/");
  };

  const setup = async () => {
    if (password.length < 8) return setError("Le mot de passe doit faire au moins 8 caractères.");
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(json.error ?? "Création impossible.");
    }
    await login();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="" className="mb-4 size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">Dépôt contenu</h1>
          <p className="mt-1 text-sm text-muted">Tes vidéos, carrousels et descriptions, prêts à poster.</p>
        </div>

        {mode === "loading" ? null : (
          <form
            className="space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "setup") setup();
              else login();
            }}
          >
            {mode === "setup" && (
              <div className="rounded-2xl bg-accent-soft p-3 text-sm text-accent">
                Première connexion : crée le compte principal. Tu pourras ajouter ton équipe ensuite.
              </div>
            )}
            <Field label="E-mail">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Mot de passe">
              <Input
                type="password"
                autoComplete={mode === "setup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {mode === "setup" && (
              <Field label="Confirme le mot de passe">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {mode === "setup" ? "Créer mon compte" : "Se connecter"}
            </Button>
            {mode === "login" && (
              <p className="text-center text-xs text-muted">
                Mot de passe oublié ? Un membre de l&apos;équipe peut le réinitialiser dans Réglages → Équipe.
              </p>
            )}
          </form>
        )}
        {mode === "login" && <InstallLoginCard />}
      </div>
    </div>
  );
}
