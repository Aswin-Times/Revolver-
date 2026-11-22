import sqlite3

from flask import Flask, request

app = Flask(__name__)


@app.route("/users")
def find_user():
    conn = sqlite3.connect("app.db")
    name = request.args.get("name", "")
    row = conn.execute(f"SELECT * FROM users WHERE name = '{name}'").fetchone()
    return {"user": row}
