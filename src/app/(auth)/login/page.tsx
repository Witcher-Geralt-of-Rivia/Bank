import type { Metadata } from "next";
import Link from "next/link";
import { DemoAccess, LoginForm } from "@/components/auth/forms";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/db/seed";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="animate-rise">
      <h1 className="heading text-[1.75rem] leading-9">Sign in to Aldera</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/register" className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
          Open an account
        </Link>
      </p>

      <div className="mt-8 grid gap-6">
        {env.demoMode ? (
          <>
            <DemoAccess accounts={DEMO_ACCOUNTS} password={DEMO_PASSWORD} />
            <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
              <span className="h-px flex-1 bg-border" />
              or sign in with your credentials
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}
        <LoginForm />
      </div>
    </div>
  );
}
