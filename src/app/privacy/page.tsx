import { LegalPendingNotice } from "@/components/legal/LegalPendingNotice";

export const metadata = {
  title: "Privacy Notice | Cinefield",
  description: "Status of Cinefield's Privacy Notice.",
};

/**
 * /privacy — a STATUS page. It is NOT the Privacy Notice and must not be
 * mistaken for one.
 *
 * Phase 23 implements real technical privacy controls (retention resolution,
 * processor inventory, account deletion with profile anonymisation, deletion
 * tombstones). Those are engineering controls, not a legal privacy notice, and
 * this page deliberately does not present them as one — describing them here
 * would read as a disclosure that counsel has not reviewed.
 */
export default function PrivacyPage() {
  return (
    <LegalPendingNotice
      documentName="Privacy Notice"
      whatItWillCover="When published, it will explain what personal data Cinefield processes, on what legal basis, and for how long."
    />
  );
}
