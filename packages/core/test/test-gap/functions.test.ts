import { describe, expect, it } from "vitest";
import { parseDiff } from "../../src/diff/parse.js";
import { newFunctions } from "../../src/test-gap/functions.js";

/** A modified file whose diff shows `lines` (prefixed " " or "+") from line 1. */
function fileWith(path: string, lines: string[]) {
  const added = lines.filter((l) => l.startsWith("+")).length;
  const context = lines.length - added;
  const [file] = parseDiff(
    [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${context} +1,${lines.length} @@`, ...lines, ""].join(
      "\n",
    ),
  );
  if (!file) throw new Error("bad fixture");
  return file;
}

const names = (path: string, lines: string[]) =>
  newFunctions(fileWith(path, lines)).map((f) => [f.name, f.line]);

describe("newFunctions", () => {
  it("finds Python functions, async functions and methods on added lines only", () => {
    expect(
      names("app/payments.py", [
        " def existing():",
        "+def calculate_discount(price, rate):",
        "+    return price * (1 - rate)",
        "+",
        "+async def fetch_rates():",
        "+    ...",
        "+class Cart:",
        "+    def __init__(self):",
        "+        self.items = []",
        "+    def total(self):",
        "+        return 0",
      ]),
    ).toEqual([
      ["calculate_discount", 2],
      ["fetch_rates", 5],
      ["total", 10],
    ]);
  });

  it("finds JavaScript and TypeScript functions in their common forms", () => {
    expect(
      names("src/cart.ts", [
        "+export function addItem(cart: Cart, item: Item) {",
        "+export default async function checkout() {",
        "+const applyDiscount = (total: number, rate: number): number => total * rate;",
        "+export const formatPrice = async (value) => {",
        "+const toCents = value => Math.round(value * 100);",
        "+let legacyTotal = function (items) {",
        "+class CartService {",
        "+  async load(id: string): Promise<Cart> {",
        "+  static fromJson(json) {",
        "+  private recalc() {",
        "+}",
      ]),
    ).toEqual([
      ["addItem", 1],
      ["checkout", 2],
      ["applyDiscount", 3],
      ["formatPrice", 4],
      ["toCents", 5],
      ["legacyTotal", 6],
      ["load", 8],
      ["fromJson", 9],
      ["recalc", 10],
    ]);
  });

  it("doesn't mistake control flow or calls for function definitions", () => {
    expect(
      names("src/loop.js", [
        "+if (items.length > 0) {",
        "+for (const item of items) {",
        "+while (running) {",
        "+switch (kind) {",
        "+} catch (error) {",
        "+save(item);",
        "+const total = sum(items);",
        "+return render(view);",
      ]),
    ).toEqual([]);
  });

  it("finds Go, Java and Ruby functions", () => {
    expect(names("pkg/server.go", ["+func (s *Server) Handle(w http.ResponseWriter) {"])).toEqual([
      ["Handle", 1],
    ]);
    expect(names("src/Price.java", ["+    public int addTax(int cents) {"])).toEqual([
      ["addTax", 1],
    ]);
    expect(names("app/models/user.rb", ["+  def full_name"])).toEqual([["full_name", 1]]);
  });
});
