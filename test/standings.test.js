import test from "node:test";
import assert from "node:assert/strict";
import { calculateStandings } from "../src/standings.js";
import { resolveReports } from "../src/results.js";

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
