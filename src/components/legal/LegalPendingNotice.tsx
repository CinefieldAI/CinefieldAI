import Link from "next/link";

/**
 * The shared shell for a legal surface that does not exist yet.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A LEGAL DOCUMENT, AND IT MUST NEVER BECOME ONE BY ACCIDENT
 * ---------------------------------------------------------------------------
 * Cinefield has no counsel-approved Terms of Use and no counsel-approved
 * Privacy Notice today. Phase 29 owns both and is deliberately parked pending
 * legal counsel. The honest thing a visitor can be told is the status, and
 * nothing more.
 *
 * So this component states availability and stops. It contains no clause, no
 * jurisdiction, no liability language, no retention promise, no processor
 * commitment, no cookie regime, no age requirement and no company registration
 * data — every one of those is a decision a lawyer has to make, and inventing
 * any of them here would replace one false statement with a worse one.
 *
 * It also carries no acceptance language. Nothing on this page may suggest
 * that reading it, continuing, signing up or purchasing forms an agreement.
 * No versioned legal acceptance is recorded anywhere in this product.
 */
export function LegalPendingNotice({
  documentName,
  whatItWillCover,
}: {
  /** The document's real name, e.g. "Terms of Use". Never "this agreement". */
  readonly documentName: string;
  /** One neutral sentence about scope. Descriptive only — never a commitment. */
  readonly whatItWillCover: string;
}) {
  return (
    <main className="min-h-screen bg-black px-6 py-24 text-gray-300">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-gray-500">Cinefield</p>

        <h1 className="mt-3 text-3xl font-semibold text-white">{documentName}</h1>

        <p className="mt-8 text-base leading-relaxed">
          Cinefield’s {documentName} has not been published yet.
        </p>

        <p className="mt-4 text-base leading-relaxed text-gray-400">{whatItWillCover}</p>

        <p className="mt-4 text-base leading-relaxed text-gray-400">
          The document is being prepared with legal counsel. Until it is published here, no
          version of it is in force, and nothing in this product asks you to accept it.
        </p>

        <div className="mt-10 border-t border-gray-800 pt-6">
          <p className="text-sm leading-relaxed text-gray-500">
            If you need this document before it is published, please contact Cinefield directly
            and we will tell you where the work stands.
          </p>
        </div>

        <Link
          href="/"
          className="mt-10 inline-block text-sm text-[#D97757] transition-colors hover:text-[#e98566]"
        >
          ← Back to Cinefield
        </Link>
      </div>
    </main>
  );
}
