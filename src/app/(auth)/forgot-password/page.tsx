import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="animate-rise">
      <Link
        href="/login"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="heading text-[1.75rem] leading-9">Reset your password</h1>
      <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
        Enter the email you use to sign in and we will send instructions to choose a new password.
      </p>
      <div className="mt-8">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
