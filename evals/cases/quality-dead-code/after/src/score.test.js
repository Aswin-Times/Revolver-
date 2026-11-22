const { scoreLabel } = require("./score");

test("scoreLabel labels scores", () => {
  expect(scoreLabel(70)).toBe("pass");
  expect(scoreLabel(10)).toBe("fail");
});
