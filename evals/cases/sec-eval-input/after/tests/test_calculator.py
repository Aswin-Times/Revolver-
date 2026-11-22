from app.calculator import app


def test_calculate_adds():
    response = app.test_client().get("/calc?expr=1%2B2")
    assert response.get_json() == {"result": 3}
