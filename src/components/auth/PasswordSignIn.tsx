"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useSignIn, useSignUp, useClerk } from "@clerk/nextjs";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useAuthModal } from "@/context/AuthModalContext";

type Screen =
  | "providers"
  | "email-signin"
  | "email-signup"
  | "signup-verify"
  | "forgot-email"
  | "forgot-code"
  | "forgot-new-password";

type OAuthProviderId = "oauth_google" | "oauth_apple" | "oauth_microsoft";

interface PasswordSignInProps {
  mode: "signin" | "signup";
  onSuccess?: () => void;
}

const OAUTH_CALLBACK_PATH = "/sign-in/sso-callback";

// Static helper components — declared at module scope (not inside
// PasswordSignIn) so they aren't recreated every render.

/**
 * The auth surface must not assert an agreement that does not exist.
 *
 * This previously read "By continuing, you agree to our Privacy Policy and
 * Terms of Use" and linked to /privacy and /terms — neither of which existed,
 * and neither of which has counsel-approved content today. That sentence
 * claimed a contract had been formed by reference to documents nobody could
 * read. Creating the pages alone would not have fixed it: the false part was
 * the assertion of acceptance, not the broken link.
 *
 * So the claim is gone and the status is stated plainly instead. No versioned
 * legal acceptance is recorded anywhere in this product, and nothing here may
 * imply that continuing, signing up or purchasing constitutes acceptance.
 *
 * Phase 29 (DEFERRED_PENDING_LEGAL_COUNSEL) owns the real documents and the
 * acceptance record. When counsel-approved text exists, this component is
 * where the genuine consent language belongs — not before.
 *
 * Scope note: this is the one function unlocked from the otherwise locked auth
 * modal, for this correction only. Layout, styling, Clerk flow, OAuth and error
 * handling are untouched.
 */
function LegalFooter() {
  return (
    <p className="text-xs text-gray-500 text-center">
      Cinefield’s{" "}
      <Link href="/terms" className="text-[#D97757] hover:text-[#e98566]">
        Terms of Use
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="text-[#D97757] hover:text-[#e98566]">
        Privacy Notice
      </Link>{" "}
      are being prepared and are not published yet.
    </p>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-gray-400 hover:text-gray-300 text-sm font-medium transition-colors motion-reduce:transition-none"
    >
      <ArrowLeft className="w-4 h-4" />
      Back
    </button>
  );
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
      <p className="text-red-400 text-sm font-medium">{message}</p>
    </div>
  );
}

function ResendBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-emerald-400 text-xs text-center">{message}</p>;
}

// Wraps screen content in a keyed container so switching screens cross-fades
// with a small vertical shift — the modal shell itself never unmounts or
// resizes, only this inner content transitions.
function ScreenTransition({
  screenKey,
  children,
}: {
  screenKey: string;
  children: React.ReactNode;
}) {
  return (
    <div
      key={screenKey}
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none"
    >
      {children}
    </div>
  );
}

/**
 * Single unified auth panel for the Cinefield modal. One fixed shell,
 * multiple internal screens (provider select, email sign-in, email sign-up
 * + verification, forgot-password 3-step flow) — the modal never closes and
 * reopens while moving between them, only this component's inner content
 * changes.
 */
export default function PasswordSignIn({ mode, onSuccess }: PasswordSignInProps) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { setActive } = useClerk();
  const { openModal } = useAuthModal();

  const [screen, setScreen] = useState<Screen>("providers");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sign in
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sign up
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupCode, setSignupCode] = useState("");

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Switching intent (Login <-> Sign up) always returns to the shared
  // provider-selection screen. Derived during render (React's recommended
  // "adjusting state when a prop changes" pattern) rather than in an effect,
  // avoiding an extra render-then-setState cascade.
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setScreen("providers");
    setError(null);
  }

  // Focus the first relevant input after a screen transition.
  useEffect(() => {
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 220);
    return () => window.clearTimeout(id);
  }, [screen]);

  const goTo = (next: Screen) => {
    setError(null);
    setResendMessage(null);
    setScreen(next);
  };

  // ---- OAuth (popup-based, stays inside the current modal) ----------------

  const handleOAuth = useCallback(
    async (strategy: OAuthProviderId) => {
      if (!signIn || !signUp || loading) return;

      // Popup must be opened synchronously inside the click handler, before
      // any await, or browsers will block it.
      const popup = window.open("about:blank", "clerk_oauth_popup", "width=520,height=680");
      if (!popup) {
        setError("Popup was blocked. Please allow popups for this site and try again.");
        return;
      }

      setError(null);
      setLoading(true);

      const callbackUrl = `${window.location.origin}${OAUTH_CALLBACK_PATH}`;

      try {
        if (mode === "signup") {
          const { error: ssoError } = await signUp.sso({
            strategy,
            redirectUrl: callbackUrl,
            redirectCallbackUrl: callbackUrl,
            popup,
          });
          if (ssoError) {
            setError(ssoError.message || "Sign up failed");
            return;
          }

          if (signUp.status === "complete") {
            await setActive({ session: signUp.createdSessionId });
            onSuccess?.();
            return;
          }

          if (signUp.isTransferable) {
            const { error: transferError } = await signIn.create({ transfer: true });
            if (transferError) {
              setError(transferError.message || "Sign in failed");
              return;
            }
            if (signIn.status === "complete") {
              await setActive({ session: signIn.createdSessionId });
              onSuccess?.();
              return;
            }
          }

          setError("Additional verification is required to finish signing up.");
        } else {
          const { error: ssoError } = await signIn.sso({
            strategy,
            redirectUrl: callbackUrl,
            redirectCallbackUrl: callbackUrl,
            popup,
          });
          if (ssoError) {
            setError(ssoError.message || "Sign in failed");
            return;
          }

          if (signIn.status === "complete") {
            await setActive({ session: signIn.createdSessionId });
            onSuccess?.();
            return;
          }

          if (signIn.isTransferable) {
            const { error: transferError } = await signUp.create({ transfer: true });
            if (transferError) {
              setError(transferError.message || "Sign up failed");
              return;
            }
            if (signUp.status === "complete") {
              await setActive({ session: signUp.createdSessionId });
              onSuccess?.();
              return;
            }
          }

          setError("Additional verification is required to finish signing in.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
      } finally {
        setLoading(false);
        if (popup && !popup.closed) popup.close();
      }
    },
    [signIn, signUp, setActive, mode, loading, onSuccess]
  );

  // ---- Email sign-in -------------------------------------------------------

  const handlePasswordSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || loading) return;

      setError(null);
      setLoading(true);

      try {
        const result = await signIn.password({ identifier, password });

        if (result.error) {
          setError(result.error.message || "Sign in failed");
          return;
        }

        if (signIn.status === "complete") {
          await setActive({ session: signIn.createdSessionId });
          setIdentifier("");
          setPassword("");
          onSuccess?.();
        } else if (
          signIn.status === "needs_first_factor" ||
          signIn.status === "needs_second_factor"
        ) {
          setError("Verification required. Check your email.");
        } else if (signIn.status === "needs_new_password") {
          setError("Password reset required.");
        } else {
          setError("Sign in incomplete. Please try again.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
      } finally {
        setLoading(false);
      }
    },
    [signIn, setActive, identifier, password, loading, onSuccess]
  );

  // ---- Email sign-up + verification ----------------------------------------

  const handleEmailSignUp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signUp || loading) return;

      setError(null);
      setLoading(true);

      try {
        const { error: createError } = await signUp.password({
          emailAddress: signupEmail,
          password: signupPassword,
        });

        if (createError) {
          setError(createError.message || "Sign up failed");
          return;
        }

        if (signUp.status === "complete") {
          await setActive({ session: signUp.createdSessionId });
          onSuccess?.();
          return;
        }

        const { error: codeError } = await signUp.verifications.sendEmailCode();
        if (codeError) {
          setError(codeError.message || "Failed to send verification code");
          return;
        }
        goTo("signup-verify");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign up failed");
      } finally {
        setLoading(false);
      }
    },
    [signUp, setActive, signupEmail, signupPassword, loading, onSuccess]
  );

  const handleSignUpVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signUp || loading) return;

      setError(null);
      setLoading(true);

      try {
        const { error: verifyError } = await signUp.verifications.verifyEmailCode({
          code: signupCode,
        });

        if (verifyError) {
          setError(verifyError.message || "Invalid code");
          return;
        }

        if (signUp.status === "complete") {
          await setActive({ session: signUp.createdSessionId });
          setSignupCode("");
          onSuccess?.();
        } else {
          setError("Verification incomplete. Please try again.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Verification failed");
      } finally {
        setLoading(false);
      }
    },
    [signUp, setActive, signupCode, loading, onSuccess]
  );

  const handleResendSignUpCode = async () => {
    if (!signUp) return;
    setError(null);
    setResendMessage(null);
    try {
      const { error: codeError } = await signUp.verifications.sendEmailCode();
      if (codeError) {
        setError(codeError.message || "Failed to resend code");
      } else {
        setResendMessage("A new code has been sent.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    }
  };

  // ---- Forgot password ------------------------------------------------------

  const handleForgotSendCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || loading) return;

      setError(null);
      setLoading(true);

      try {
        const { error: createError } = await signIn.create({ identifier: forgotEmail });
        if (createError) {
          setError(createError.message || "Failed to start password reset");
          return;
        }

        const { error: codeError } = await signIn.resetPasswordEmailCode.sendCode();
        if (codeError) {
          setError(codeError.message || "Failed to send reset code");
          return;
        }

        goTo("forgot-code");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send reset code");
      } finally {
        setLoading(false);
      }
    },
    [signIn, forgotEmail, loading]
  );

  const handleForgotVerifyCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || loading) return;

      setError(null);
      setLoading(true);

      try {
        const { error: verifyError } = await signIn.resetPasswordEmailCode.verifyCode({
          code: forgotCode,
        });

        if (verifyError) {
          setError(verifyError.message || "Invalid code");
          return;
        }

        goTo("forgot-new-password");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Verification failed");
      } finally {
        setLoading(false);
      }
    },
    [signIn, forgotCode, loading]
  );

  const handleForgotResendCode = async () => {
    if (!signIn) return;
    setError(null);
    setResendMessage(null);
    try {
      const { error: codeError } = await signIn.resetPasswordEmailCode.sendCode();
      if (codeError) {
        setError(codeError.message || "Failed to resend code");
      } else {
        setResendMessage("A new code has been sent.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    }
  };

  const handleForgotSubmitPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || loading) return;

      if (newPassword !== confirmNewPassword) {
        setError("Passwords don't match");
        return;
      }

      setError(null);
      setLoading(true);

      try {
        const { error: submitError } = await signIn.resetPasswordEmailCode.submitPassword({
          password: newPassword,
          signOutOfOtherSessions: true,
        });

        if (submitError) {
          setError(submitError.message || "Failed to reset password");
          return;
        }

        if (signIn.status === "complete") {
          await setActive({ session: signIn.createdSessionId });
          setNewPassword("");
          setConfirmNewPassword("");
          onSuccess?.();
        } else {
          setError("Password reset incomplete. Please try again.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reset password");
      } finally {
        setLoading(false);
      }
    },
    [signIn, setActive, newPassword, confirmNewPassword, loading, onSuccess]
  );

  // ---- Screens -----------------------------------------------------------

  if (screen === "providers") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-6">
          <div className="flex justify-center">
            <img
              src="/cinefield-logo.png"
              alt="CinefieldAI"
              className="h-10 w-10 rounded-lg object-cover"
            />
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-2">Welcome to CinefieldAI</h2>
            <p className="text-sm text-gray-400">Sign up and start creating with AI</p>
          </div>

          <ErrorBanner message={error} />

          <div className="space-y-3">
            <button
              onClick={() => handleOAuth("oauth_google")}
              disabled={loading}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path
                  d="M18.8 10.209C18.8 9.55898 18.7417 8.93398 18.6333 8.33398H10V11.8798H14.9333C14.7208 13.0257 14.075 13.9965 13.1042 14.6465V16.9465H16.0667C17.8 15.3507 18.8 13.0007 18.8 10.209Z"
                  fill="#4285F4"
                />
                <path
                  d="M10.0003 19.1672C12.4753 19.1672 14.5503 18.3464 16.0669 16.9464L13.1044 14.6464C12.2836 15.1964 11.2336 15.5214 10.0003 15.5214C7.61276 15.5214 5.59193 13.9089 4.87109 11.7422H1.80859V14.1172C3.31693 17.113 6.41693 19.1672 10.0003 19.1672Z"
                  fill="#34A853"
                />
                <path
                  d="M4.86953 11.7411C4.6862 11.1911 4.58203 10.6036 4.58203 9.99948C4.58203 9.39531 4.6862 8.80781 4.86953 8.25781V5.88281H1.80703C1.16536 7.16019 0.831466 8.56999 0.832032 9.99948C0.832032 11.4786 1.1862 12.8786 1.80703 14.1161L4.86953 11.7411Z"
                  fill="#FBBC05"
                />
                <path
                  d="M10.0003 4.47982C11.3461 4.47982 12.5544 4.94232 13.5044 5.85065L16.1336 3.22148C14.5461 1.74232 12.4711 0.833984 10.0003 0.833984C6.41693 0.833984 3.31693 2.88815 1.80859 5.88398L4.87109 8.25898C5.59193 6.09232 7.61276 4.47982 10.0003 4.47982Z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <button
              onClick={() => handleOAuth("oauth_apple")}
              disabled={loading}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="white">
                <path d="M9.68745 6.01898C8.95745 6.01898 7.82745 5.18898 6.63745 5.21898C5.06745 5.23898 3.62745 6.12898 2.81745 7.53898C1.18745 10.369 2.39745 14.549 3.98745 16.849C4.76745 17.969 5.68745 19.229 6.90745 19.189C8.07745 19.139 8.51745 18.429 9.93745 18.429C11.3474 18.429 11.7474 19.189 12.9874 19.159C14.2474 19.139 15.0474 18.019 15.8174 16.889C16.7074 15.589 17.0774 14.329 17.0975 14.259C17.0675 14.249 14.6475 13.319 14.6175 10.519C14.5975 8.17898 16.5274 7.05898 16.6174 7.00898C15.5175 5.39898 13.8274 5.21898 13.2374 5.17898C11.6974 5.05898 10.4074 6.01898 9.68745 6.01898ZM12.2874 3.65898C12.9375 2.87898 13.3674 1.78898 13.2474 0.708984C12.3174 0.748984 11.1974 1.32898 10.5274 2.10898C9.92745 2.79898 9.40745 3.90898 9.54745 4.96898C10.5774 5.04898 11.6375 4.43898 12.2874 3.65898Z" />
              </svg>
              Continue with Apple
            </button>

            <button
              onClick={() => handleOAuth("oauth_microsoft")}
              disabled={loading}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M8.55425 8.55288H0V0H8.55425V8.55288Z" fill="#F1511B" />
                <path d="M18.0003 8.55288H9.44531V0H17.9996V8.55288H18.0003Z" fill="#80CC28" />
                <path d="M8.55425 18.0001H0V9.44727H8.55425V18.0001Z" fill="#00ADEF" />
                <path
                  d="M18.0003 18.0001H9.44531V9.44727H17.9996V18.0001H18.0003Z"
                  fill="#FBBC09"
                />
              </svg>
              Continue with Microsoft
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-black text-gray-400">OR</span>
            </div>
          </div>

          <button
            onClick={() => goTo(mode === "signup" ? "email-signup" : "email-signin")}
            className="w-full py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M3.75 4C2.7835 4 2 4.7835 2 5.75V6.78938L11.8876 11.7646C11.9583 11.8002 12.0417 11.8002 12.1124 11.7646L22 6.78938V5.75C22 4.7835 21.2165 4 20.25 4H3.75Z"
                fill="currentColor"
              />
              <path
                d="M22 8.46856L12.7866 13.1045C12.2917 13.3535 11.7082 13.3535 11.2134 13.1045L2 8.46856V18.25C2 19.2165 2.7835 20 3.75 20H20.25C21.2165 20 22 19.2165 22 18.25V8.46856Z"
                fill="currentColor"
              />
            </svg>
            Continue with Email
          </button>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "email-signin") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-5">
          <BackButton onClick={() => goTo("providers")} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Log in to CinefieldAI</h2>
            <p className="text-gray-400 text-sm">Enter your account and continue creating</p>
          </div>

          <ErrorBanner message={error} />

          <form onSubmit={handlePasswordSignIn} className="space-y-4">
            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                Email address or username
              </label>
              <input
                ref={firstFieldRef}
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Enter your email or username"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setForgotEmail(identifier.includes("@") ? identifier : "");
                goTo("forgot-email");
              }}
              className="block w-full text-[#D97757] hover:text-[#e98566] text-sm font-medium transition-colors text-center"
            >
              Forgot password?
            </button>

            <button
              type="submit"
              disabled={loading || !identifier || !password}
              className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Log in"}
            </button>
          </form>

          <p className="text-gray-400 text-sm text-center">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => openModal("signup")}
              className="text-[#D97757] hover:text-[#e98566] font-medium"
            >
              Sign up
            </button>
          </p>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "email-signup") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-5">
          <BackButton onClick={() => goTo("providers")} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Create your account</h2>
            <p className="text-gray-400 text-sm">Sign up and start creating with AI</p>
          </div>

          <ErrorBanner message={error} />

          <form onSubmit={handleEmailSignUp} className="space-y-4">
            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                Email address
              </label>
              <input
                ref={firstFieldRef}
                type="email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="Enter your email"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showSignupPassword ? "text" : "password"}
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="Create a password"
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword(!showSignupPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showSignupPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Clerk Smart CAPTCHA mount point for bot-protected sign-ups. */}
            <div id="clerk-captcha" />

            <button
              type="submit"
              disabled={loading || !signupEmail || !signupPassword}
              className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-gray-400 text-sm text-center">
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => openModal("signin")}
              className="text-[#D97757] hover:text-[#e98566] font-medium"
            >
              Log in
            </button>
          </p>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "signup-verify") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-5">
          <BackButton onClick={() => goTo("email-signup")} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Verify your email</h2>
            <p className="text-gray-400 text-sm">
              Enter the code we sent to {signupEmail || "your email"}
            </p>
          </div>

          <ErrorBanner message={error} />
          <ResendBanner message={resendMessage} />

          <form onSubmit={handleSignUpVerify} className="space-y-4">
            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                Verification code
              </label>
              <input
                ref={firstFieldRef}
                type="text"
                inputMode="numeric"
                value={signupCode}
                onChange={(e) => setSignupCode(e.target.value)}
                placeholder="Enter the code"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !signupCode}
              className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>

          <button
            type="button"
            onClick={handleResendSignUpCode}
            disabled={loading}
            className="block w-full text-[#D97757] hover:text-[#e98566] text-sm font-medium transition-colors text-center disabled:opacity-50"
          >
            Resend code
          </button>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "forgot-email") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <BackButton onClick={() => goTo("email-signin")} />
          </div>

          <div className="flex justify-center">
            <img
              src="/cinefield-logo.png"
              alt="CinefieldAI"
              className="h-10 w-10 rounded-lg object-cover"
            />
          </div>

          <h2 className="text-2xl font-bold text-white text-center">Reset Your Password</h2>

          <ErrorBanner message={error} />

          <form onSubmit={handleForgotSendCode} className="space-y-4">
            <input
              ref={firstFieldRef}
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="Email"
              disabled={loading}
              className="w-full px-4 py-3 bg-transparent border border-gray-700 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={loading || !forgotEmail}
              className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Sending..." : "Send code"}
            </button>
          </form>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "forgot-code") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-5">
          <BackButton onClick={() => goTo("forgot-email")} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Check your email</h2>
            <p className="text-gray-400 text-sm">
              Enter the code we sent to {forgotEmail || "your email"}
            </p>
          </div>

          <ErrorBanner message={error} />
          <ResendBanner message={resendMessage} />

          <form onSubmit={handleForgotVerifyCode} className="space-y-4">
            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                Verification code
              </label>
              <input
                ref={firstFieldRef}
                type="text"
                inputMode="numeric"
                value={forgotCode}
                onChange={(e) => setForgotCode(e.target.value)}
                placeholder="Enter the code"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !forgotCode}
              className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying..." : "Verify code"}
            </button>
          </form>

          <button
            type="button"
            onClick={handleForgotResendCode}
            disabled={loading}
            className="block w-full text-[#D97757] hover:text-[#e98566] text-sm font-medium transition-colors text-center disabled:opacity-50"
          >
            Resend code
          </button>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  if (screen === "forgot-new-password") {
    return (
      <ScreenTransition screenKey={screen}>
        <div className="space-y-5">
          <BackButton onClick={() => goTo("forgot-code")} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Set a new password</h2>
            <p className="text-gray-400 text-sm">Choose a new password for your account</p>
          </div>

          <ErrorBanner message={error} />

          <form onSubmit={handleForgotSubmitPassword} className="space-y-4">
            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                New password
              </label>
              <div className="relative">
                <input
                  ref={firstFieldRef}
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showNewPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-gray-200 font-medium text-sm mb-2">
                Confirm new password
              </label>
              <input
                type={showNewPassword ? "text" : "password"}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="Confirm new password"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757] outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmNewPassword}
              className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>

          <LegalFooter />
        </div>
      </ScreenTransition>
    );
  }

  return null;
}
