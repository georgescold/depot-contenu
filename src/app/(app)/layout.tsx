import { Suspense } from "react";
import { AppShell, Splash } from "@/components/AppShell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<Splash />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
