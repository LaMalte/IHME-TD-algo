const POINTS = Object.freeze({
  win: 4,
  draw: 2,
  loss: 0,
  bonus: 1,
  offensiveBonusTryMargin: 3,
  defensiveBonusMaxLossMargin: 5
});

export function calculateStandings(teams, matches) {
  const rows = new Map(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        teamName: team.name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        tryFor: 0,
        tryAgainst: 0,
        offensiveBonuses: 0,
        defensiveBonuses: 0,
        tablePoints: 0
      }
    ])
  );

  for (const match of matches) {
    if (match.status !== "confirmed") continue;

    const home = rows.get(match.homeTeamId);
    const away = rows.get(match.awayTeamId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.pointsFor += match.homeScore;
    home.pointsAgainst += match.awayScore;
    away.pointsFor += match.awayScore;
    away.pointsAgainst += match.homeScore;
    home.tryFor += match.homeTries;
    home.tryAgainst += match.awayTries;
    away.tryFor += match.awayTries;
    away.tryAgainst += match.homeTries;

    const tryMargin = match.homeTries - match.awayTries;
    if (tryMargin >= POINTS.offensiveBonusTryMargin) {
      home.offensiveBonuses += 1;
      home.tablePoints += POINTS.bonus;
    } else if (tryMargin <= -POINTS.offensiveBonusTryMargin) {
      away.offensiveBonuses += 1;
      away.tablePoints += POINTS.bonus;
    }

    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.tablePoints += POINTS.win;
      if (match.homeScore - match.awayScore <= POINTS.defensiveBonusMaxLossMargin) {
        away.defensiveBonuses += 1;
        away.tablePoints += POINTS.bonus;
      }
    } else if (match.homeScore < match.awayScore) {
      away.wins += 1;
      home.losses += 1;
      away.tablePoints += POINTS.win;
      if (match.awayScore - match.homeScore <= POINTS.defensiveBonusMaxLossMargin) {
        home.defensiveBonuses += 1;
        home.tablePoints += POINTS.bonus;
      }
    } else {
      home.draws += 1;
      away.draws += 1;
      home.tablePoints += POINTS.draw;
      away.tablePoints += POINTS.draw;
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      pointsDifference: row.pointsFor - row.pointsAgainst,
      tryDifference: row.tryFor - row.tryAgainst
    }))
    .sort(
      (a, b) =>
        b.tablePoints - a.tablePoints ||
        b.pointsDifference - a.pointsDifference ||
        b.pointsFor - a.pointsFor ||
        a.teamName.localeCompare(b.teamName, "fr")
    );
}

export { POINTS };
