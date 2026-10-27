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
