function detectDifficulty(questionText = "", choices = []) {
  const text = questionText.toLowerCase();

  let score = 0;

  // Easy keywords
  if (
    text.includes("what is") ||
    text.includes("define") ||
    text.includes("identify") ||
    text.includes("which of the following")
  ) {
    score += 1;
  }

  // Average keywords
  if (
    text.includes("calculate") ||
    text.includes("solve") ||
    text.includes("determine") ||
    text.includes("find")
  ) {
    score += 2;
  }

  // Difficult keywords
  if (
    text.includes("analyze") ||
    text.includes("derive") ||
    text.includes("evaluate") ||
    text.includes("design") ||
    text.includes("prove") ||
    text.includes("troubleshoot")
  ) {
    score += 3;
  }

  // Long questions are usually harder
  if (text.length > 180) score += 2;
  if (text.length > 300) score += 3;

  // Many numbers = more computation
  const numbers = text.match(/\d+/g);
  if (numbers && numbers.length >= 3) score += 2;

  // Figure/table questions are usually harder
  if (
    text.includes("figure") ||
    text.includes("diagram") ||
    text.includes("table") ||
    text.includes("circuit")
  ) {
    score += 2;
  }

  if (score <= 2) return "Easy";
  if (score <= 5) return "Average";
  return "Difficult";
}

module.exports = detectDifficulty;
