const { exec } = require("child_process");

function ping(host, callback) {
  exec(`ping -c 1 ${host}`, (error, stdout) => {
    callback(error, stdout);
  });
}

module.exports = { ping };
