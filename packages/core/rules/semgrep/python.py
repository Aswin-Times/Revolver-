# Test cases for python.yml. Run with: semgrep --test packages/core/rules/semgrep
# "ruleid:" marks a line that must match, "ok:" a line that must not.
import hashlib
import os
import pickle
import subprocess

import jwt
import requests
import yaml
from flask import Flask, render_template_string, request

app = Flask(__name__)


def sql(cur, user_id, name):
    # ruleid: py-sql-injection
    cur.execute(f"SELECT * FROM users WHERE id = {user_id}")
    # ruleid: py-sql-injection
    cur.execute("SELECT * FROM users WHERE name = '%s'" % name)
    # ruleid: py-sql-injection
    cur.execute("SELECT * FROM users WHERE name = '" + name + "'")
    # ruleid: py-sql-injection
    cur.execute("SELECT * FROM users WHERE id = {}".format(user_id))
    query = f"DELETE FROM users WHERE id = {user_id}"
    # ruleid: py-sql-injection
    cur.execute(query)
    # ok: py-sql-injection
    cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    # ok: py-sql-injection
    cur.execute("SELECT COUNT(*) FROM users")


def commands(user_input):
    # ruleid: py-command-injection
    subprocess.run(f"ls {user_input}", shell=True)
    # ruleid: py-command-injection
    os.system("ping " + user_input)
    # ok: py-command-injection
    subprocess.run(["ls", user_input], check=True)
    # ok: py-command-injection
    subprocess.run("ls -l", shell=True)
    # ok: py-command-injection
    os.system("clear")


def dynamic_code(expr):
    # ruleid: py-eval-exec
    eval(expr)
    # ruleid: py-eval-exec
    exec(expr)
    # ok: py-eval-exec
    eval("1 + 2")


def deserialize(blob, text):
    # ruleid: py-unsafe-deserialization
    pickle.loads(blob)
    # ruleid: py-unsafe-deserialization
    yaml.load(text)
    # ruleid: py-unsafe-deserialization
    yaml.load(text, Loader=yaml.Loader)
    # ok: py-unsafe-deserialization
    yaml.load(text, Loader=yaml.SafeLoader)
    # ok: py-unsafe-deserialization
    yaml.safe_load(text)


@app.route("/hello")
def hello():
    name = request.args.get("name", "")
    # ruleid: py-flask-template-injection
    return render_template_string(f"<h1>Hello {name}</h1>")


@app.route("/static-hello")
def static_hello():
    # ok: py-flask-template-injection
    return render_template_string("<h1>Hello {{ name }}</h1>", name=request.args.get("name"))


def fetch(url):
    # ruleid: py-requests-verify-disabled
    return requests.get(url, verify=False, timeout=10)


def fetch_ok(url):
    # ok: py-requests-verify-disabled
    return requests.get(url, timeout=10)


def store_password(password):
    # ruleid: py-weak-password-hash
    return hashlib.sha256(password.encode()).hexdigest()


def checksum(data):
    # ok: py-weak-password-hash
    return hashlib.sha256(data).hexdigest()


def make_token(user_id):
    # ruleid: py-hardcoded-jwt-secret
    return jwt.encode({"sub": user_id}, "secret123", algorithm="HS256")


def make_token_ok(user_id):
    # ok: py-hardcoded-jwt-secret
    return jwt.encode({"sub": user_id}, os.environ["JWT_SECRET"], algorithm="HS256")


if __name__ == "__main__":
    # ok: py-flask-debug
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
    # ruleid: py-flask-debug
    app.run(debug=True)
