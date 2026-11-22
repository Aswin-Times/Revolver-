function readConfig(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
  }
}

module.exports = { readConfig };
