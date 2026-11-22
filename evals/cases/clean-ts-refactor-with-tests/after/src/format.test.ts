import { expect, it } from "vitest";
import { formatPrice } from "./format";

it("formats whole dollars", () => {
  expect(formatPrice(500)).toBe("$5.00");
});

it("keeps two decimals", () => {
  expect(formatPrice(1050)).toBe("$10.50");
});
