const { ping } = require("./ping");

test("ping reports output", (done) => {
  ping("localhost", (error, stdout) => {
    expect(error).toBeNull();
    expect(stdout).toContain("localhost");
    done();
  });
});
