export function isValidScoreLine(score, tries) {
  return Number.isSafeInteger(score) &&
    score >= 0 &&
    Number.isSafeInteger(tries) &&
    tries >= 0 &&
    tries * 5 <= score;
}

export function isValidMatchScore(homeScore, awayScore, homeTries, awayTries) {
  return isValidScoreLine(homeScore, homeTries) &&
    isValidScoreLine(awayScore, awayTries);
}

export function resolveReports(homeReport, awayReport) {
  if (!homeReport || !awayReport) return { status: "pending" };

  const reportsMatch =
    homeReport.score === awayReport.opponentScore &&
    homeReport.opponentScore === awayReport.score &&
    homeReport.tries === awayReport.opponentTries &&
    homeReport.opponentTries === awayReport.tries;

  if (!reportsMatch) return { status: "disputed" };

  return {
    status: "confirmed",
    homeScore: homeReport.score,
    awayScore: homeReport.opponentScore,
    homeTries: homeReport.tries,
    awayTries: homeReport.opponentTries
  };
}
