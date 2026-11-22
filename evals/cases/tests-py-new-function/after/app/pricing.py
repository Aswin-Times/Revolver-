def apply_discount(price, percent):
    """Return the price after a percentage discount."""
    if percent < 0 or percent > 100:
        raise ValueError("percent must be between 0 and 100")
    return round(price * (100 - percent) / 100, 2)


def shipping_cost(weight_kg):
    """Flat rate up to 2 kg, then 1.50 per extra kilogram."""
    if weight_kg <= 2:
        return 4.99
    return round(4.99 + (weight_kg - 2) * 1.5, 2)
