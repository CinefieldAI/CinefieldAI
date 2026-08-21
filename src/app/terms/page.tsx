import { LegalPendingNotice } from "@/components/legal/LegalPendingNotice";

export const metadata = {
  title: "Terms of Use | Cinefield",
  description: "Status of Cinefield's Terms of Use.",
};

/**
 * /terms — a STATUS page, not a contract.
 *
 * This page must never imply that continuing, signing up or purchasing
 * constitutes acceptance of anything. No versioned terms acceptance exists in
 * this product; Phase 29 owns both the document and the acceptance record.
 */
export default function TermsPage() {
  return (
    <LegalPendingNotice
      documentName="Terms of Use"
      whatItWillCover="When published, it will describe the rules for using Cinefield and what may and may not be generated on the platform."
    />
  );
}
