const { readConfig } = require("./config");

test("readConfig parses JSON", () => {
  expect(readConfig('{"a": 1}')).toEqual({ a: 1 });
});
