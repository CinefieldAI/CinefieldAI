import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-md">
        <SignUp
          appearance={{
            variables: {
              colorBackground: "#000000",
              colorPrimary: "#D97757",
              borderRadius: "12px",
            },
            elements: {
              card: "bg-black shadow-none border-0 rounded-2xl",
              cardBox: "shadow-none border-0",
              headerTitle: "text-white text-2xl font-bold",
              headerSubtitle: "text-gray-300",
              dividerLine: "bg-gray-700",
              dividerText: "text-gray-400",
              formFieldLabel: "text-gray-200 font-medium",
              formFieldInput:
                "bg-gray-800 border border-gray-600 text-white placeholder-gray-500 rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757]",
              formButtonPrimary:
                "bg-[#D97757] hover:bg-[#c9684a] text-white font-semibold rounded-xl",
              formResendCodeLink: "text-[#D97757] hover:text-[#e98566]",
              socialButton:
                "border border-gray-600 hover:border-gray-500 hover:bg-gray-800 text-white rounded-xl",
              socialButtonText: "text-white",
              socialButtonsBlockButton:
                "border border-gray-600 hover:border-gray-500 hover:bg-gray-800 text-white rounded-xl",
              socialButtonsBlockButtonText: "text-white",
              footerActionText: "text-gray-400",
              footerActionLink: "text-[#D97757] hover:text-[#e98566]",
              identityPreviewText: "text-gray-300",
              formFieldErrorText: "text-red-400",
              alertText: "text-red-400",
              otpCodeFieldInput:
                "bg-gray-800 border border-gray-600 text-white text-center text-lg tracking-widest rounded-xl focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757]",
              footer: "text-gray-500",
              footerPages: "text-gray-500",
              badge: "bg-gray-800 text-gray-300",
            },
          }}
        />
      </div>
    </div>
  );
}
