"use client";

import Link from "next/link";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useAuthModal } from "@/context/AuthModalContext";
import { FolderClosed, Rocket, Search } from "lucide-react";

/**
 * The navbar's top-right action group: Search, Pricing, Assets and the user
 * avatar when signed in; Pricing / Login / Sign up when signed out.
 *
 * Extracted from Navbar so a page that deliberately renders no navbar can
 * still surface these actions — /marketing-studio/product does exactly
 * that. Both call sites render this same component, so their behaviour
 * cannot drift apart. The markup is unchanged from what Navbar rendered
 * inline before.
 */

function SearchButton() {
  return (
    <button
      type="button"
      className="hidden items-center gap-2 rounded-[10px] bg-white/5 px-2.5 h-9 text-neutral-400 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-neutral-200 sm:flex"
    >
      <Search className="h-4 w-4" />
      <span className="text-sm">Search</span>
      <span className="ml-1 flex items-center gap-0.5">
        <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          Ctrl
        </kbd>
        <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
          K
        </kbd>
      </span>
    </button>
  );
}

function PricingUpgradeLink() {
  return (
    <a
      href="/pricing"
      className="relative hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 h-9 text-sm font-medium text-white transition-colors hover:bg-white/10 sm:flex"
    >
      <Rocket className="h-4 w-4 text-magenta-400" />
      Pricing
    </a>
  );
}

/**
 * Logged-out Pricing entry. Login and Sign up open the auth modal; they do
 * not navigate.
 */
function PricingAction() {
  return (
    <Link
      href="/pricing"
      title="View Cinefield AI pricing plans and subscription options"
      className="relative hidden items-center gap-1.5 rounded-[10px] bg-white/5 px-3 h-9 text-sm font-medium text-white transition-colors hover:bg-white/10 active:bg-white/15 sm:flex"
    >
      <svg
        className="size-4"
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M6.56218 3.52331C6.89119 3.18855 7.34089 3 7.81027 3H16.186C16.6554 3 17.1051 3.18855 17.4341 3.52331L22.5881 8.76722C23.2614 9.45231 23.2567 10.5521 22.5774 11.2313L13.2356 20.5732C12.5521 21.2566 11.4441 21.2566 10.7607 20.5732L1.41881 11.2313C0.73957 10.5521 0.734815 9.45231 1.40816 8.76722L6.56218 3.52331ZM9.02845 7.21967C9.32135 7.51256 9.32135 7.98744 9.02845 8.28033L7.30878 10L9.02845 11.7197C9.32135 12.0126 9.32135 12.4874 9.02845 12.7803C8.73556 13.0732 8.26069 13.0732 7.96779 12.7803L5.71779 10.5303C5.4249 10.2374 5.4249 9.76256 5.71779 9.46967L7.96779 7.21967C8.26069 6.92678 8.73556 6.92678 9.02845 7.21967Z"
          fill="currentColor"
        />
      </svg>
      Pricing
    </Link>
  );
}

function AssetsButton() {
  return (
    <a
      href="/asset/all"
      className="relative hidden items-center gap-2 overflow-hidden rounded-[10px] h-9 px-3 text-sm text-neutral-300 backdrop-blur-md transition-colors hover:text-white md:flex"
    >
      <span
        className="absolute inset-0 rounded-[10px]"
        style={{ background: "rgba(255,255,255,0.05)" }}
      />
      <FolderClosed className="relative z-10 h-4 w-4" />
      <span className="relative z-10">Assets</span>
    </a>
  );
}

export default function NavbarActions() {
  const { isSignedIn } = useAuth();
  const { openModal } = useAuthModal();

  if (isSignedIn) {
    return (
      <>
        <SearchButton />
        <PricingUpgradeLink />
        <AssetsButton />
        <UserButton
          appearance={{
            elements: {
              userButtonAvatarBox: "h-9 w-9",
              userButtonTrigger: "rounded-full hover:opacity-80 transition-opacity",
            },
          }}
        />
      </>
    );
  }

  return (
    <div className="flex items-center">
      <PricingAction />
      <span
        aria-hidden="true"
        className="mx-2.5 hidden h-5 w-px bg-white/10 sm:block"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => openModal("signin")}
          className="hidden h-9 items-center rounded-[10px] px-3.5 text-sm font-medium text-white transition-colors hover:bg-white/10 md:inline-flex"
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => openModal("signup")}
          className="inline-flex h-9 items-center rounded-[10px] bg-white px-3.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 active:bg-white/80"
        >
          Sign up
        </button>
      </div>
    </div>
  );
}
