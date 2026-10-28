import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createDatabase, deriveLogoColor } from "../src/database.js";

test("initializes the fictional PostgreSQL league idempotently", async () => {
  const memory = newDb({ noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const database = createDatabase({ pool });

  try {
    assert.throws(
      () => createDatabase({ connectionString: "" }),
      /DATABASE_URL/
    );
    assert.equal(deriveLogoColor('<svg><path fill="#123456"/></svg>'), "#123456");
    assert.throws(
      () => deriveLogoColor('<svg><path fill="#ffffff"/></svg>'),
      /couleur principale/
    );

    await database.initialize();
    const firstLeague = await database.listLeague();
    assert.equal(firstLeague.teams.length, 12);
    assert.equal(firstLeague.matches.length, 132);
    assert.equal(Math.max(...firstLeague.matches.map((match) => match.round)), 22);
    assert.equal(firstLeague.matches.filter((match) => match.status === "confirmed").length, 12);
    assert.ok(firstLeague.teams.every((team) => team.logoPath.startsWith("/logos/")));
    assert.ok(firstLeague.teams.every((team) => team.administrativePoints === 0));
    const staleConfirmedFixture = firstLeague.matches.find((match) => match.round > 2);
    await database.query(`
      UPDATE matches
      SET status = 'confirmed', home_score = 24, away_score = 17,
          home_tries = 3, away_tries = 2
      WHERE id = $1
    `, [staleConfirmedFixture.id]);

    const oldFixtures = [
      [1, "2026-09-13", "Racing Club des Alizés", "Union Rugby des Roches"],
      [1, "2026-09-13", "Ovalie du Val d'Or", "Sporting des Brumes"],
      [2, "2026-09-20", "Racing Club des Alizés", "Ovalie du Val d'Or"],
      [2, "2026-09-20", "Union Rugby des Roches", "Sporting des Brumes"]
    ];
    for (const [round, date, home, away] of oldFixtures) {
      const fixture = firstLeague.matches.find((match) =>
        match.homeTeamId === firstLeague.teams.find((team) => team.name === home).id &&
        match.awayTeamId === firstLeague.teams.find((team) => team.name === away).id
      );
      await database.query(
        "UPDATE matches SET round = $1, date = $2 WHERE id = $3",
        [round, date, fixture.id]
      );
    }

    await database.initialize();
    const secondLeague = await database.listLeague();
    assert.equal(secondLeague.teams.length, 12);
    assert.equal(secondLeague.matches.length, 132);
    const repairedFixture = secondLeague.matches.find((match) => match.id === staleConfirmedFixture.id);
    assert.equal(repairedFixture.status, "scheduled");
    assert.equal(repairedFixture.homeScore, null);
    assert.equal(secondLeague.matches.filter((match) => match.status === "confirmed").length, 12);
    assert.ok(
      Array.from({ length: 22 }, (_, index) =>
        secondLeague.matches.filter((match) => match.round === index + 1).length
      ).every((count) => count === 6)
    );

    const firstSecret = await database.getOrCreateSessionSecret();
    const secondSecret = await database.getOrCreateSessionSecret();
    assert.equal(firstSecret, secondSecret);
    assert.ok(firstSecret.length >= 32);
    await assert.rejects(
      createDatabase({ pool }).getOrCreateSessionSecret("short"),
      /SESSION_SECRET/
    );
  } finally {
    await database.close();
  }
});
