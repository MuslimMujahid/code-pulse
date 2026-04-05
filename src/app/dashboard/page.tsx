import { Suspense } from "react";
import { DashboardShell } from "@/components/DashboardShell";

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardShell />
    </Suspense>
  );
}
