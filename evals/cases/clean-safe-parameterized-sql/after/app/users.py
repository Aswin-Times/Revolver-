import logging
import sqlite3

logger = logging.getLogger(__name__)


def find_user(conn: sqlite3.Connection, name: str):
    row = conn.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchone()
    logger.info("Selected user %s", name)
    return row
