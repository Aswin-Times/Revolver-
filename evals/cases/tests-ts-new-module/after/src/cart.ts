export interface Item {
  name: string;
  price: number;
  quantity: number;
}

export function addItem(cart: Item[], item: Item): Item[] {
  const existing = cart.find((i) => i.name === item.name);
  if (!existing) return [...cart, item];
  return cart.map((i) =>
    i.name === item.name ? { ...i, quantity: i.quantity + item.quantity } : i,
  );
}

export function cartTotal(cart: Item[]): number {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}
