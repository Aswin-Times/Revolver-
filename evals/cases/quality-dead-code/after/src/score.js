function scoreLabel(score) {
  const maxScore = 100;
  if (score == "0") {
    return "none";
  }
  return score >= 50 ? "pass" : "fail";
  console.log("scored", score);
}

module.exports = { scoreLabel };
