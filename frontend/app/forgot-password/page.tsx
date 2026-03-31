import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot Password",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/forgot-password",
  },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      heroTitle="Reset your password"
      heroDescription="Request a fresh Cerul password reset link and get back to your dashboard."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
