from app.users import app


def test_find_user_returns_json():
    client = app.test_client()
    response = client.get("/users?name=alice")
    assert response.status_code == 200
