"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn, useClerk } from "@clerk/nextjs";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";

type Screen = "provider" | "password";

interface PasswordSignInProps {
  onSuccess?: () => void;
}

export default function PasswordSignIn({ onSuccess }: PasswordSignInProps) {
  const { signIn } = useSignIn();
  const { setActive } = useClerk();
  const router = useRouter();

  const [screen, setScreen] = useState<Screen>("provider");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOAuth = (provider: string) => {
    router.push(`/sign-in?strategy=${provider}`);
  };

  const handlePasswordSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn || loading) return;

      setError(null);
      setLoading(true);

      try {
        const result = await signIn.password({
          identifier,
          password,
        });

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

  if (screen === "provider") {
    return (
      <div className="space-y-6">
        <div className="flex justify-center">
          <img
            src="/cinefield-logo.png"
            alt="CinefieldAI"
            className="h-10 w-10 rounded-lg object-cover"
          />
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">
            Welcome to CinefieldAI
          </h2>
          <p className="text-sm text-gray-400">
            Sign up and start creating with AI
          </p>
        </div>

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
              <path
                d="M18.0003 8.55288H9.44531V0H17.9996V8.55288H18.0003Z"
                fill="#80CC28"
              />
              <path
                d="M8.55425 18.0001H0V9.44727H8.55425V18.0001Z"
                fill="#00ADEF"
              />
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
          onClick={() => {
            setScreen("password");
            setError(null);
          }}
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

        <p className="text-xs text-gray-500 text-center">
          By continuing, you agree to our{" "}
          <Link href="/privacy" className="text-[#D97757] hover:text-[#e98566]">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-[#D97757] hover:text-[#e98566]">
            Terms of Use
          </Link>
        </p>
      </div>
    );
  }

  if (screen === "password") {
    return (
      <div className="space-y-5">
        <button
          onClick={() => {
            setScreen("provider");
            setError(null);
            setIdentifier("");
            setPassword("");
          }}
          className="flex items-center gap-2 text-gray-400 hover:text-gray-300 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Log in to CinefieldAI</h2>
          <p className="text-gray-400 text-sm">Enter your account and continue creating</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handlePasswordSignIn} className="space-y-4">
          <div>
            <label className="block text-gray-200 font-medium text-sm mb-2">
              Email address or username
            </label>
            <input
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

          <Link
            href="/sign-in?reset=true"
            className="block text-[#D97757] hover:text-[#e98566] text-sm font-medium transition-colors text-center"
          >
            Forgot password?
          </Link>

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
            onClick={() => {
              setScreen("provider");
              setError(null);
            }}
            className="text-[#D97757] hover:text-[#e98566] font-medium"
          >
            Sign up
          </button>
        </p>

        <p className="text-xs text-gray-500 text-center">
          By continuing, you agree to our{" "}
          <Link href="/privacy" className="text-[#D97757] hover:text-[#e98566]">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-[#D97757] hover:text-[#e98566]">
            Terms of Use
          </Link>
        </p>
      </div>
    );
  }

  return null;
}
