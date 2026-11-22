import { expect, it } from "vitest";
import { formatPrice } from "./format";

it("formats whole dollars", () => {
  expect(formatPrice(500)).toBe("$5.00");
});
