"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/db/seed";
import { type Role, ROLES } from "@/lib/domain";
import { env } from "@/lib/env";
import {
  type ActionResult,
  DomainError,
  ForbiddenError,
  ValidationError,
  toActionError,
} from "@/lib/errors";
import {
  fieldErrorsOf,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
} from "@/lib/validation";
import {
  clientInfo,
  createSession,
  destroySession,
  getCurrentUser,
  homeFor,
  requestContext,
} from "../auth/session";
import { ConfigurationError } from "../auth/token";
import { enforceRateLimit, limiters } from "../rate-limit";
import {
  authenticate,
  recordLogout,
  registerCustomer,
  requestPasswordReset,
} from "../users/service";

export type FormState = ActionResult<{ message?: string }> | null;

function configurationFailure(error: unknown): FormState | null {
  if (!(error instanceof ConfigurationError)) return null;
  console.error("[aldera] configuration error:", error.message);
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: "Este entorno no está completamente configurado: falta la variable SESSION_SECRET.",
    },
  };
}

async function signIn(email: string, password: string): Promise<Role> {
  const { ip } = await clientInfo();
  enforceRateLimit(limiters.login, `${email}|${ip ?? "unknown"}`);

  const db = await getDb();
  const user = await authenticate(db, await requestContext(null), email, password);
  await createSession(user);
  limiters.login.reset(`${email}|${ip ?? "unknown"}`);
  return user.role;
}

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let role: Role;
  try {
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      throw new ValidationError("Revisa tus datos e intenta de nuevo.", fieldErrorsOf(parsed.error));
    }
    role = await signIn(parsed.data.email, parsed.data.password);
  } catch (error) {
    return configurationFailure(error) ?? toActionError(error);
  }
  redirect(homeFor(role));
}

/** One-click sign-in as a seeded demo user. Only available in demo mode. */
export async function demoLoginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  let role: Role;
  try {
    if (!env.demoMode) throw new ForbiddenError("El acceso de demostración está desactivado en este entorno.");
    const requested = String(formData.get("role") ?? "");
    const account = DEMO_ACCOUNTS.find((a) => a.role === requested);
    if (!account || !(ROLES as readonly string[]).includes(requested)) {
      throw new DomainError("validation_failed", "Perfil de demostración desconocido.");
    }
    role = await signIn(account.email, DEMO_PASSWORD);
  } catch (error) {
    return configurationFailure(error) ?? toActionError(error);
  }
  redirect(homeFor(role));
}

export async function registerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ip } = await clientInfo();
    enforceRateLimit(limiters.signup, ip ?? "unknown");

    const parsed = registerSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) {
      throw new ValidationError("Revisa los campos marcados.", fieldErrorsOf(parsed.error));
    }
    if (formData.get("terms") !== "on") {
      throw new ValidationError("Acepta los términos para continuar.", {
        terms: "Debes aceptar los términos para abrir una cuenta.",
      });
    }

    const db = await getDb();
    const user = await registerCustomer(db, await requestContext(null), parsed.data);
    await createSession(user);
  } catch (error) {
    return configurationFailure(error) ?? toActionError(error);
  }
  redirect("/dashboard");
}

export async function forgotPasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const { ip } = await clientInfo();
    enforceRateLimit(limiters.signup, `reset|${ip ?? "unknown"}`);

    const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
    if (!parsed.success) {
      throw new ValidationError("Ingresa un correo electrónico válido.", fieldErrorsOf(parsed.error));
    }

    const db = await getDb();
    await requestPasswordReset(db, await requestContext(null), parsed.data.email);
    // Identical response whether or not the address is registered.
    return {
      ok: true,
      data: {
        message: `Si ${parsed.data.email} está registrado, las instrucciones para restablecer la contraseña van en camino.`,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function logoutAction(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (user) await recordLogout(await getDb(), await requestContext(user));
  } catch (error) {
    console.error("[aldera] could not record sign-out", error);
  }
  await destroySession();
  redirect("/login");
}
