import { z } from "zod";
import { CATEGORIES, type Category, ROLES } from "./domain";
import type { FieldErrors } from "./errors";
import { CURRENCY_CODES, type CurrencyCode } from "./money";

/**
 * Input schemas shared by forms (for instant feedback) and by the server
 * (as the authority). Nothing is trusted because the browser validated it.
 */

export const PASSWORD_MIN_LENGTH = 10;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "Email address is too long.")
  .email("Enter a valid email address.");

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(128, "Password is too long.")
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "Include at least one letter and one number.",
  });

const personName = z
  .string()
  .trim()
  .min(2, "Enter your full name.")
  .max(80, "Name is too long.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const registerSchema = z.object({
  name: personName,
  email,
  password,
});

export const forgotPasswordSchema = z.object({ email });

export const profileSchema = z.object({
  name: personName,
  company: z.string().trim().max(80, "Company name is too long.").optional(),
  phone: z
    .string()
    .trim()
    .max(32, "Phone number is too long.")
    .regex(/^[+()\-.\s\d]*$/, "Enter a valid phone number.")
    .optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used before.",
  });

const id = z.string().trim().min(4).max(64);

const idempotencyKey = z
  .string()
  .trim()
  .min(8, "Missing idempotency key.")
  .max(128);

/** Amounts cross the wire as decimal strings and are parsed without floats. */
const amountText = z.string().trim().min(1, "Enter an amount.").max(32);

const description = z
  .string()
  .trim()
  .min(1, "Add a short description.")
  .max(140, "Keep the description under 140 characters.");

const category = z
  .string()
  .refine((value): value is Category => value in CATEGORIES, {
    message: "Unknown category.",
  });

export const transferSchema = z.object({
  idempotencyKey,
  sourceAccountId: id,
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("account"), accountId: id }),
    z.object({ kind: z.literal("beneficiary"), beneficiaryId: id }),
  ]),
  amount: amountText,
  description,
  category: category.optional(),
});
export type TransferPayload = z.infer<typeof transferSchema>;

export const fundingSchema = z.object({
  idempotencyKey,
  accountId: id,
  amount: amountText,
  description: z.string().trim().max(140).optional(),
});
export type FundingPayload = z.infer<typeof fundingSchema>;

const currency = z
  .string()
  .refine((value): value is CurrencyCode =>
    (CURRENCY_CODES as string[]).includes(value), { message: "Unsupported currency." });

export const beneficiarySchema = z.object({
  kind: z.enum(["internal", "external"]),
  name: z.string().trim().min(2, "Enter the beneficiary's name.").max(80),
  nickname: z.string().trim().max(40).optional(),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email address.")])
    .optional(),
  bankName: z.string().trim().max(80).optional(),
  accountNumber: z
    .string()
    .trim()
    .min(6, "Enter a valid account number or IBAN.")
    .max(40, "Account number is too long.")
    .regex(/^[A-Za-z0-9\s-]+$/, "Use letters, digits and spaces only."),
  routingCode: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9\s-]*$/, "Use letters and digits only.")
    .optional(),
  country: z.string().trim().length(2, "Select a country.").toUpperCase(),
  currency,
});
export type BeneficiaryPayload = z.infer<typeof beneficiarySchema>;

export const reasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason.")
  .max(280, "Keep the reason under 280 characters.");

export const roleSchema = z.enum(ROLES);

/** Flattens a Zod error into one message per field path. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
