import base64
import pickle

from flask import request


def load_session():
    cookie = request.cookies.get("session", "")
    return pickle.loads(base64.b64decode(cookie))
