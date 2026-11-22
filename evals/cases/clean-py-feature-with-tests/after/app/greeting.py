def greeting(name, hour):
    """Greet someone by the time of day (hour is 0-23)."""
    if not 0 <= hour <= 23:
        raise ValueError("hour must be between 0 and 23")
    if hour < 12:
        part = "morning"
    elif hour < 18:
        part = "afternoon"
    else:
        part = "evening"
    return f"Good {part}, {name}!"
