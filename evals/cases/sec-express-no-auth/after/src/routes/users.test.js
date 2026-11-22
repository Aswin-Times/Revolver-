const request = require("supertest");
const express = require("express");
const router = require("./users");

test("DELETE /users/:id responds 204", async () => {
  const app = express().use(router);
  await request(app).delete("/users/1").expect(204);
});
