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
    assert.equal(firstLeague.teams.length, 4);
    assert.equal(firstLeague.matches.length, 4);
    assert.equal(firstLeague.matches.filter((match) => match.status === "confirmed").length, 2);
    assert.ok(firstLeague.teams.every((team) => team.logoPath.startsWith("/logos/")));

    await database.initialize();
    const secondLeague = await database.listLeague();
    assert.equal(secondLeague.teams.length, 4);
    assert.equal(secondLeague.matches.length, 4);

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
