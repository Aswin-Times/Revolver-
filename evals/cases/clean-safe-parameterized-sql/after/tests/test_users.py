import sqlite3

from app.users import find_user


def test_find_user_by_name():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE users (name TEXT)")
    conn.execute("INSERT INTO users VALUES ('ana')")
    assert find_user(conn, "ana") == ("ana",)
