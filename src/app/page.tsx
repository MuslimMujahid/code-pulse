import { Suspense } from "react";
import { RepoLoader } from "@/components/RepoLoader";

export default function Home() {
  return (
    <Suspense>
      <RepoLoader />
    </Suspense>
  );
}
