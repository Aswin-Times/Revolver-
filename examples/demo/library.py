"""A small library-loans API, written the way a student might in week 3.

This file exists only to demo PR Mentor on a pull request. Don't merge it.
"""

import sqlite3

from flask import Flask, request

app = Flask(__name__)


def get_db():
    return sqlite3.connect("library.db")


@app.route("/books")
def search_books():
    title = request.args.get("title", "")
    conn = get_db()
    rows = conn.execute(f"SELECT * FROM books WHERE title LIKE '%{title}%'").fetchall()
    return {"books": rows}


def late_fee(days_late, daily_rate=0.25):
    if days_late <= 0:
        return 0
    try:
        return round(days_late * daily_rate, 2)
    except Exception:
        pass
