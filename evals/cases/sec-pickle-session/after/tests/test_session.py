import base64
import pickle

from flask import Flask

from app.session import load_session


def test_load_session_round_trips():
    cookie = base64.b64encode(pickle.dumps({"user": 1})).decode()
    with Flask(__name__).test_request_context(headers={"Cookie": f"session={cookie}"}):
        assert load_session() == {"user": 1}
