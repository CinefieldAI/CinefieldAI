import { Suspense } from "react";
import Layout from "@/components/supercomputer/Layout";

export const metadata = {
  title: "Supercomputer | Higgsfield",
  description: "Create with Higgsfield Supercomputer",
};

export default function SupercomputerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <Layout />
    </Suspense>
  );
}
