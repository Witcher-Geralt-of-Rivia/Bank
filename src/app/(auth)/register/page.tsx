import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Abrir una cuenta" };

export default function RegisterPage() {
  return (
    <div className="animate-rise">
      <h1 className="heading text-[1.75rem] leading-9">Abre una cuenta</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        ¿Ya tienes una cuenta?{" "}
        <Link href="/login" className="font-medium text-accent-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
          Inicia sesión
        </Link>
      </p>
      <div className="mt-8">
        <RegisterForm />
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Comenzarás con una cuenta en USD vacía, lista para recibir tu primer depósito.
      </p>
    </div>
  );
}
