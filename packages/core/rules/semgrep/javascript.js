// Test cases for javascript.yml. Run with: semgrep --test packages/core/rules/semgrep
// "ruleid:" marks a line that must match, "ok:" a line that must not.
const express = require("express");
const { exec } = require("child_process");
const childProcess = require("child_process");
const jwt = require("jsonwebtoken");
const serialize = require("node-serialize");

const app = express();

function sql(db, api, id, name) {
  // ruleid: js-sql-injection
  db.query(`SELECT * FROM users WHERE id = ${id}`);
  // ruleid: js-sql-injection
  db.query("SELECT * FROM users WHERE name = '" + name + "'");
  // ruleid: js-sql-injection
  db.all(`DELETE FROM sessions WHERE user = ${id}`, () => {});
  // ok: js-sql-injection
  db.query("SELECT * FROM users WHERE id = ?", [id]);
  // ok: js-sql-injection
  db.query(`SELECT * FROM users`);
  // ok: js-sql-injection
  console.log(`Selected user ${id}`);
  // ok: js-sql-injection
  api.get(`/users/${id}`);
}

function commands(userInput) {
  // ruleid: js-command-injection
  exec(`ls ${userInput}`);
  // ruleid: js-command-injection
  childProcess.execSync("ping " + userInput);
  // ok: js-command-injection
  childProcess.execFile("ls", [userInput]);
  // ok: js-command-injection
  exec("ls -l");
}

function dynamic(code) {
  // ruleid: js-eval
  eval(code);
  // ruleid: js-eval
  const fn = new Function("a", code);
  // ok: js-eval
  eval("2 + 2");
  return fn;
}

function render(el, html, name) {
  // ruleid: js-dom-xss
  el.innerHTML = html;
  // ruleid: js-dom-xss
  document.write("<p>" + name + "</p>");
  // ok: js-dom-xss
  el.textContent = name;
  // ok: js-dom-xss
  el.innerHTML = "<p>Loading</p>";
}

app.get("/hello", (req, res) => {
  // ruleid: js-express-reflected-xss
  res.send(`<h1>Hello ${req.query.name}</h1>`);
});

app.get("/hello-json", (req, res) => {
  // ok: js-express-reflected-xss
  res.json({ name: req.query.name });
});

// ruleid: js-express-route-without-auth
app.delete("/users/:id", (req, res) => {
  res.sendStatus(204);
});

// ok: js-express-route-without-auth
app.delete("/users/:id", requireAuth, (req, res) => {
  res.sendStatus(204);
});

// ok: js-express-route-without-auth
app.get("/health", (req, res) => {
  res.send("ok");
});

function tokens(user) {
  // ruleid: js-hardcoded-jwt-secret
  return jwt.sign({ sub: user.id }, "supersecret");
}

function tokensOk(user) {
  // ok: js-hardcoded-jwt-secret
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
}

function load(cookie) {
  // ruleid: js-unsafe-deserialization
  return serialize.unserialize(cookie);
}

// ruleid: js-tls-verification-disabled
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const agentOptions = {
  // ruleid: js-tls-verification-disabled
  rejectUnauthorized: false,
};

function requireAuth(req, res, next) {
  next();
}

module.exports = { sql, commands, dynamic, render, tokens, tokensOk, load, agentOptions };
