const express = require("express");
const db = require("../db");

const router = express.Router();

router.delete("/users/:id", async (req, res) => {
  await db.users.delete(req.params.id);
  res.sendStatus(204);
});

module.exports = router;
