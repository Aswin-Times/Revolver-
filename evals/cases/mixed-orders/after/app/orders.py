import sqlite3


def orders_for(customer):
    conn = sqlite3.connect("shop.db")
    try:
        query = "SELECT * FROM orders WHERE customer = '" + customer + "'"
        return conn.execute(query).fetchall()
    except:
        pass
