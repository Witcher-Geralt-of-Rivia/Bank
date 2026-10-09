import { describe, expect, it } from "vitest";
import { STATUS_TRANSITIONS, TRANSACTION_STATUSES, canTransition, maskAccountNumber } from "@/lib/domain";
import {
  beneficiarySchema,
  changePasswordSchema,
  fieldErrorsOf,
  fundingSchema,
  loginSchema,
  registerSchema,
  transferSchema,
} from "@/lib/validation";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { RateLimiter } from "@/server/rate-limit";

const validTransfer = {
  idempotencyKey: "5b0e3f6c-1d2a-4c57-9b1e-000000000001",
  sourceAccountId: "acc_0123456789",
  destination: { kind: "account", accountId: "acc_9876543210" },
  amount: "1,250.50",
  description: "Rent for October",
};

describe("transfer payload", () => {
  it("accepts a well-formed request", () => {
    expect(transferSchema.safeParse(validTransfer).success).toBe(true);
    expect(
      transferSchema.safeParse({ ...validTransfer, destination: { kind: "beneficiary", beneficiaryId: "ben_0123456789" }, category: "rent" }).success,
    ).toBe(true);
  });

  it.each([
    ["missing idempotency key", { idempotencyKey: "" }],
    ["missing source", { sourceAccountId: "" }],
    ["unknown destination kind", { destination: { kind: "wallet", id: "x" } }],
    ["destination without an id", { destination: { kind: "beneficiary" } }],
    ["empty amount", { amount: " " }],
    ["numeric amount instead of a decimal string", { amount: 1250.5 }],
    ["empty description", { description: "  " }],
    ["oversized description", { description: "x".repeat(141) }],
    ["unknown category", { category: "bribes" }],
  ])("rejects %s", (_, patch) => {
    expect(transferSchema.safeParse({ ...validTransfer, ...patch }).success).toBe(false);
  });

  it("reports one message per field", () => {
    const result = transferSchema.safeParse({ ...validTransfer, amount: "", description: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrorsOf(result.error);
      expect(errors.amount).toBe("Enter an amount.");
      expect(errors.description).toBe("Add a short description.");
    }
  });

  it("validates deposits and withdrawals", () => {
    expect(fundingSchema.safeParse({ idempotencyKey: "abcdefgh", accountId: "acc_0123", amount: "50" }).success).toBe(true);
    expect(fundingSchema.safeParse({ idempotencyKey: "abc", accountId: "acc_0123", amount: "50" }).success).toBe(false);
  });
});

describe("credentials", () => {
  it("normalises the email address", () => {
    const parsed = loginSchema.parse({ email: "  Elena@Aldera.Example ", password: "x" });
    expect(parsed.email).toBe("elena@aldera.example");
  });

  it("enforces the password policy on registration", () => {
    const base = { name: "Ada Lovelace", email: "ada@example.com" };
    expect(registerSchema.safeParse({ ...base, password: "longenough1" }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "onlyletterslong" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "12345678901" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, email: "not-an-email", password: "longenough1" }).success).toBe(false);
  });

  it("requires a different, confirmed new password", () => {
    const ok = { currentPassword: "old-password-1", newPassword: "new-password-2", confirmPassword: "new-password-2" };
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...ok, confirmPassword: "typo" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, newPassword: ok.currentPassword, confirmPassword: ok.currentPassword }).success).toBe(false);
  });

  it("hashes passwords with a per-password salt and verifies them", async () => {
    const a = await hashPassword("correct horse battery 9");
    const b = await hashPassword("correct horse battery 9");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery 9", a)).toBe(true);
    expect(await verifyPassword("correct horse battery 8", a)).toBe(false);
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe("beneficiary payload", () => {
  const valid = { kind: "external", name: "Greenfield Print Co.", bankName: "Harborview Trust", accountNumber: "5521 9003 6674", country: "us", currency: "USD" };

  it("accepts a valid beneficiary and normalises the country", () => {
    const parsed = beneficiarySchema.parse(valid);
    expect(parsed.country).toBe("US");
  });

  it.each([
    ["script in the account number", { accountNumber: "<script>alert(1)</script>" }],
    ["unsupported currency", { currency: "XBT" }],
    ["short account number", { accountNumber: "123" }],
    ["invalid email", { email: "nope" }],
    ["unknown kind", { kind: "crypto" }],
  ])("rejects %s", (_, patch) => {
    expect(beneficiarySchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("status state machine", () => {
  it("allows only forward transitions", () => {
    expect(canTransition("pending", "processing")).toBe(true);
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
    expect(canTransition("processing", "failed")).toBe(true);
    expect(canTransition("completed", "reversed")).toBe(true);

    expect(canTransition("pending", "completed")).toBe(false);
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("completed", "failed")).toBe(false);
  });

  it("treats failed and reversed as terminal", () => {
    expect(STATUS_TRANSITIONS.failed).toHaveLength(0);
    expect(STATUS_TRANSITIONS.reversed).toHaveLength(0);
    for (const status of TRANSACTION_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe("account number masking", () => {
  it("shows only the last four characters", () => {
    expect(maskAccountNumber("4410 0286 4821")).toBe("•••• 4821");
    expect(maskAccountNumber("ES12 9044 0001 2300 4455 5567")).toBe("•••• 5567");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit and then blocks until the window passes", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    expect(limiter.check("k").allowed).toBe(true);
    const blocked = limiter.check("k");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);

    expect(limiter.check("other").allowed).toBe(true);

    now += 60_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("slides: old attempts expire individually", () => {
    let now = 0;
    const limiter = new RateLimiter({ limit: 2, windowMs: 10_000, now: () => now });
    limiter.check("k");
    now = 6_000;
    limiter.check("k");
    now = 9_000;
    expect(limiter.check("k").allowed).toBe(false);
    now = 10_001;
    expect(limiter.check("k").allowed).toBe(true);
  });

  it("can be reset after a successful attempt", () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.check("k");
    expect(limiter.check("k").allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.check("k").allowed).toBe(true);
  });
});
