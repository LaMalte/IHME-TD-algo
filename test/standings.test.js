import test from "node:test";
import assert from "node:assert/strict";
import { calculateStandings, calculateStatistics } from "../src/standings.js";
import { isValidMatchScore, resolveReports } from "../src/results.js";

const teams = [
  { id: 1, name: "Club A" },
  { id: 2, name: "Club B" },
  { id: 3, name: "Club C" }
];

test("calcule victoire, bonus offensif et bonus defensif", () => {
  const standings = calculateStandings(teams, [
    {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 30,
      awayScore: 26,
      homeTries: 5,
      awayTries: 2,
      status: "confirmed"
    }
  ]);

  assert.equal(standings[0].teamName, "Club A");
  assert.equal(standings[0].tablePoints, 5);
  assert.equal(standings[0].offensiveBonuses, 1);
  assert.equal(standings[1].tablePoints, 1);
  assert.equal(standings[1].defensiveBonuses, 1);
});

test("ignore les resultats qui ne sont pas confirmes", () => {
  const standings = calculateStandings(teams, [
    {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 40,
      awayScore: 0,
      homeTries: 8,
      awayTries: 0,
      status: "pending"
    }
  ]);

  assert.equal(standings[0].played, 0);
  assert.equal(standings[0].tablePoints, 0);
  assert.ok(calculateStatistics(standings).every((category) => category.rows.length === 0));
});

test("confirme un score seulement si les deux feuilles concordent", () => {
  const homeReport = { score: 24, opponentScore: 19, tries: 3, opponentTries: 2 };
  const awayReport = { score: 19, opponentScore: 24, tries: 2, opponentTries: 3 };

  assert.deepEqual(resolveReports(homeReport, awayReport), {
    status: "confirmed",
    homeScore: 24,
    awayScore: 19,
    homeTries: 3,
    awayTries: 2
  });
  assert.equal(resolveReports(homeReport, { ...awayReport, score: 18 }).status, "disputed");
  assert.equal(resolveReports(homeReport, null).status, "pending");
});

test("refuse les essais non cohérents avec les points saisis", () => {
  assert.equal(isValidMatchScore(10, 0, 2, 0), true);
  assert.equal(isValidMatchScore(4, 0, 1, 0), false);
  assert.equal(isValidMatchScore(0, 0, 0, 0), true);
  const nilNilDraw = calculateStandings(teams, [{
    homeTeamId: 1,
    awayTeamId: 2,
    homeScore: 0,
    awayScore: 0,
    homeTries: 0,
    awayTries: 0,
    status: "confirmed"
  }]);
  assert.equal(nilNilDraw.find((team) => team.teamId === 1).tablePoints, 2);
  assert.equal(nilNilDraw.find((team) => team.teamId === 2).tablePoints, 2);
});

test("attribue deux points a chaque equipe en cas de match nul", () => {
  const standings = calculateStandings(teams, [
    {
      homeTeamId: 1,
      awayTeamId: 2,
      homeScore: 17,
      awayScore: 17,
      homeTries: 2,
      awayTries: 2,
      status: "confirmed"
    }
  ]);

  assert.equal(standings.find((team) => team.teamId === 1).tablePoints, 2);
  assert.equal(standings.find((team) => team.teamId === 2).tablePoints, 2);
});

test("intègre les points administratifs au classement sans les confondre avec les points sportifs", () => {
  const standings = calculateStandings([
    { id: 1, name: "Club A", administrativePoints: -3 },
    { id: 2, name: "Club B", administrativePoints: 2 }
  ], [{
    homeTeamId: 1,
    awayTeamId: 2,
    homeScore: 20,
    awayScore: 10,
    homeTries: 3,
    awayTries: 1,
    status: "confirmed"
  }]);

  assert.equal(standings.find((team) => team.teamId === 1).sportsPoints, 4);
  assert.equal(standings.find((team) => team.teamId === 1).administrativePoints, -3);
  assert.equal(standings.find((team) => team.teamId === 1).tablePoints, 1);
  assert.equal(standings.find((team) => team.teamId === 2).tablePoints, 2);
});

test("classe les trois meilleures attaques, defenses et statistiques d'essais", () => {
  const standings = calculateStandings([
    { id: 1, name: "Club A" },
    { id: 2, name: "Club B" },
    { id: 3, name: "Club C" },
    { id: 4, name: "Club D" }
  ], [
    { homeTeamId: 1, awayTeamId: 2, homeScore: 28, awayScore: 10, homeTries: 4, awayTries: 1, status: "confirmed" },
    { homeTeamId: 3, awayTeamId: 4, homeScore: 17, awayScore: 8, homeTries: 2, awayTries: 1, status: "confirmed" },
    { homeTeamId: 2, awayTeamId: 3, homeScore: 13, awayScore: 24, homeTries: 1, awayTries: 3, status: "confirmed" }
  ]);
  const statistics = calculateStatistics(standings);

  assert.equal(statistics.length, 4);
  assert.equal(statistics.find((entry) => entry.key === "pointsFor").rows[0].teamId, 3);
  assert.equal(statistics.find((entry) => entry.key === "pointsAgainst").rows[0].teamId, 1);
  assert.equal(statistics.find((entry) => entry.key === "tryFor").rows[0].teamId, 3);
  assert.equal(statistics.find((entry) => entry.key === "tryAgainst").rows[0].teamId, 1);
  assert.ok(statistics.every((entry) => entry.rows.length === 3));
});
