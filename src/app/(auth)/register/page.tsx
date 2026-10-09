import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Open an account" };

export default function RegisterPage() {
  return (
    <div className="animate-rise">
      <h1 className="heading text-[1.75rem] leading-9">Open an account</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Already with us?{" "}
        <Link href="/login" className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
          Sign in
        </Link>
      </p>
      <div className="mt-8">
        <RegisterForm />
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        You will start with an empty USD account, ready to receive a first deposit.
      </p>
    </div>
  );
}
