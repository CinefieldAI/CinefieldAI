"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useSignIn, useClerk } from "@clerk/nextjs";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import Image from "next/image";

interface PasswordSignInProps {
  onSuccess?: () => void;
  onBack?: () => void;
}

export default function PasswordSignIn({ onSuccess, onBack }: PasswordSignInProps) {
  const { signIn } = useSignIn();
  const { setActive } = useClerk();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasswordSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!signIn) return;

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
          onSuccess?.();
        } else if (
          signIn.status === "needs_first_factor" ||
          signIn.status === "needs_second_factor"
        ) {
          setError("Additional verification required. Please check your email.");
        } else if (signIn.status === "needs_new_password") {
          setError("Password reset required. Please check your email.");
        } else {
          setError("Sign in incomplete. Please try again.");
        }
      } catch (err) {
        let errorMessage = "Sign in failed";
        if (err && typeof err === "object" && "message" in err) {
          errorMessage = (err as any).message;
        } else if (err instanceof Error) {
          errorMessage = err.message;
        }
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [signIn, setActive, identifier, password, onSuccess]
  );

  return (
    <div className="space-y-5">
      {/* Back Button */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-400 hover:text-gray-300 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      )}

      {/* Heading */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Log in to CinefieldAI</h2>
        <p className="text-gray-400 text-sm">Welcome back! Please enter your credentials.</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handlePasswordSignIn} className="space-y-4">
        {/* Email/Username */}
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

        {/* Password */}
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
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Forgot Password Link */}
        <div className="text-right">
          <Link
            href="/sign-in?reset_password=true"
            className="text-[#D97757] hover:text-[#e98566] text-sm font-medium transition-colors"
          >
            Forgot password?
          </Link>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || !identifier || !password}
          className="w-full py-2.5 bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Log in"}
        </button>
      </form>

      {/* Sign Up Link */}
      <div className="text-center pt-2">
        <p className="text-gray-400 text-sm">
          Don&apos;t have an account?{" "}
          <button onClick={onBack} className="text-[#D97757] hover:text-[#e98566] font-medium">
            Sign up
          </button>
        </p>
      </div>

      {/* Legal Text */}
      <div className="text-center">
        <p className="text-gray-500 text-xs leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-[#D97757] hover:text-[#e98566]">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-[#D97757] hover:text-[#e98566]">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
