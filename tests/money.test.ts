import { describe, expect, it } from "vitest";
import {
  MoneyError,
  changeInBasisPoints,
  formatMoney,
  mulDiv,
  parseAmount,
  sumMinor,
  toBaseCurrency,
  toDecimalString,
} from "@/lib/money";

describe("parseAmount", () => {
  it.each([
    ["0.01", 1n],
    ["1", 100n],
    ["12.5", 1250n],
    ["1250.50", 125050n],
    ["1,250.50", 125050n],
    ["1,000,000", 100000000n],
    ["  42.00  ", 4200n],
    ["$19.99", 1999n],
    ["007", 700n],
    ["10.", 1000n],
  ])("parses %s exactly", (input, expected) => {
    expect(parseAmount(input, "USD")).toBe(expected);
  });

  it("is exact where binary floating point is not", () => {
    // 0.1 + 0.2 !== 0.3 and 1.15 * 100 !== 115 in IEEE-754 arithmetic.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(1.15 * 100).not.toBe(115);

    expect(parseAmount("0.1", "USD") + parseAmount("0.2", "USD")).toBe(parseAmount("0.3", "USD"));
    expect(parseAmount("1.15", "USD")).toBe(115n);
    expect(parseAmount("4.35", "USD")).toBe(435n);
  });

  it("keeps full precision beyond the safe integer range of a double", () => {
    // MAX_SAFE_INTEGER + 2 cannot be represented as a JavaScript number.
    const minor = 9007199254740993n;
    expect(BigInt(Number(minor))).not.toBe(minor);
    expect(toDecimalString(minor, "USD")).toBe("90071992547409.93");
    expect(toDecimalString(minor + 1n, "USD")).toBe("90071992547409.94");
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "malformed"],
    ["12.3.4", "malformed"],
    ["1,25", "malformed"],
    ["1e3", "malformed"],
    [".50", "malformed"],
    ["-5", "negative"],
    ["10.999", "too_many_decimals"],
    ["0.001", "too_many_decimals"],
    ["1000000000000.00", "too_large"],
  ])("rejects %j as %s", (input, reason) => {
    expect.assertions(2);
    try {
      parseAmount(input, "USD");
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyError);
      expect((error as MoneyError).reason).toBe(reason);
    }
  });

  it("never rounds: an unrepresentable amount is an error, not an approximation", () => {
    expect(() => parseAmount("19.999", "USD")).toThrow(MoneyError);
  });
});

describe("toDecimalString / formatMoney", () => {
  it("round-trips through parseAmount", () => {
    for (const text of ["0.00", "0.01", "0.10", "1.00", "999.99", "1234567.89"]) {
      expect(toDecimalString(parseAmount(text, "USD"), "USD")).toBe(text);
    }
  });

  it("pads small and negative values correctly", () => {
    expect(toDecimalString(5n, "USD")).toBe("0.05");
    expect(toDecimalString(-5n, "USD")).toBe("-0.05");
    expect(toDecimalString(-125050n, "EUR")).toBe("-1250.50");
  });

  it("formats with grouping, symbol and sign", () => {
    expect(formatMoney(125050n, "USD")).toBe("$1,250.50");
    expect(formatMoney(125050n, "EUR")).toBe("€1,250.50");
    expect(formatMoney(-125050n, "USD")).toBe("−$1,250.50");
    expect(formatMoney(125050n, "USD", { sign: "always" })).toBe("+$1,250.50");
    expect(formatMoney(-125050n, "USD", { sign: "never" })).toBe("$1,250.50");
    expect(formatMoney(0n, "USD", { sign: "always" })).toBe("$0.00");
  });

  it("formats very large values without losing cents", () => {
    expect(formatMoney(9007199254740993n, "USD")).toBe("$90,071,992,547,409.93");
  });
});

describe("integer arithmetic helpers", () => {
  it("sums minor units", () => {
    expect(sumMinor([10n, 20n, 30n])).toBe(60n);
    expect(sumMinor([])).toBe(0n);
  });

  it("mulDiv rounds half away from zero", () => {
    expect(mulDiv(100n, 1n, 3n)).toBe(33n);
    expect(mulDiv(200n, 1n, 3n)).toBe(67n);
    expect(mulDiv(5n, 1n, 2n)).toBe(3n);
    expect(mulDiv(-5n, 1n, 2n)).toBe(-3n);
    expect(mulDiv(1n, 1n, 2n)).toBe(1n);
    expect(() => mulDiv(1n, 1n, 0n)).toThrow(RangeError);
  });

  it("converts to the base currency with an integer rate", () => {
    expect(toBaseCurrency(10_000n, "USD")).toBe(10_000n);
    expect(toBaseCurrency(10_000n, "EUR")).toBe(10_845n);
    expect(toBaseCurrency(1n, "EUR")).toBe(1n);
  });

  it("computes change in basis points", () => {
    expect(changeInBasisPoints(110n, 100n)).toBe(1000n);
    expect(changeInBasisPoints(90n, 100n)).toBe(-1000n);
    expect(changeInBasisPoints(100n, 0n)).toBeNull();
  });
});
