import pytest

from app.greeting import greeting


@pytest.mark.parametrize(("hour", "part"), [(0, "morning"), (12, "afternoon"), (23, "evening")])
def test_greeting_picks_part_of_day(hour, part):
    assert greeting("Sam", hour) == f"Good {part}, Sam!"


def test_greeting_rejects_bad_hours():
    with pytest.raises(ValueError):
        greeting("Sam", 24)
