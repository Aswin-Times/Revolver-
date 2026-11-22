export function formatPrice(cents: number): string {
  let s = String(cents / 100);
  if (s.indexOf(".") === -1) s = s + ".00";
  return "$" + s;
}
