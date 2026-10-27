import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const schema = `
  CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80) NOT NULL UNIQUE,
    logo_path TEXT NOT NULL,
    color VARCHAR(7) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    home_team_id INTEGER NOT NULL REFERENCES teams(id),
    away_team_id INTEGER NOT NULL REFERENCES teams(id),
    round INTEGER NOT NULL CHECK (round >= 1),
    date DATE,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK (status IN ('scheduled', 'pending', 'disputed', 'confirmed')),
    home_score INTEGER CHECK (home_score IS NULL OR home_score >= 0),
    away_score INTEGER CHECK (away_score IS NULL OR away_score >= 0),
    home_tries INTEGER CHECK (home_tries IS NULL OR home_tries >= 0),
    away_tries INTEGER CHECK (away_tries IS NULL OR away_tries >= 0),
    CHECK (home_team_id <> away_team_id),
    UNIQUE (home_team_id, away_team_id, round)
  );

  CREATE TABLE IF NOT EXISTS match_reports (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    reporting_team_id INTEGER NOT NULL REFERENCES teams(id),
    score INTEGER NOT NULL CHECK (score >= 0),
    opponent_score INTEGER NOT NULL CHECK (opponent_score >= 0),
    tries INTEGER NOT NULL CHECK (tries >= 0),
    opponent_tries INTEGER NOT NULL CHECK (opponent_tries >= 0),
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (match_id, reporting_team_id)
  );

  CREATE TABLE IF NOT EXISTS match_report_history (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    reporting_team_id INTEGER NOT NULL REFERENCES teams(id),
    score INTEGER NOT NULL,
    opponent_score INTEGER NOT NULL,
    tries INTEGER NOT NULL,
    opponent_tries INTEGER NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'team')),
    team_id INTEGER UNIQUE REFERENCES teams(id),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK ((role = 'admin' AND team_id IS NULL) OR (role = 'team' AND team_id IS NOT NULL))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS match_adjudications (
    id SERIAL PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    admin_user_id INTEGER NOT NULL REFERENCES users(id),
    home_score INTEGER NOT NULL CHECK (home_score >= 0),
    away_score INTEGER NOT NULL CHECK (away_score >= 0),
    home_tries INTEGER NOT NULL CHECK (home_tries >= 0),
    away_tries INTEGER NOT NULL CHECK (away_tries >= 0),
    reason TEXT NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );
`;

const demoTeams = [
  { name: "Racing Club des Alizés", logo: "racing-alizes.svg" },
  { name: "Union Rugby des Roches", logo: "union-roches.svg" },
  { name: "Ovalie du Val d'Or", logo: "ovalie-valdor.svg" },
  { name: "Sporting des Brumes", logo: "sporting-brumes.svg" }
];

const demoMatches = [
  [1, "2026-09-13", "Racing Club des Alizés", "Union Rugby des Roches", "confirmed", 24, 17, 3, 2],
  [1, "2026-09-13", "Ovalie du Val d'Or", "Sporting des Brumes", "confirmed", 19, 21, 2, 3],
  [2, "2026-09-20", "Racing Club des Alizés", "Ovalie du Val d'Or", "scheduled"],
  [2, "2026-09-20", "Union Rugby des Roches", "Sporting des Brumes", "scheduled"]
];
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dateValue = (value) => value instanceof Date
  ? value.toISOString().slice(0, 10)
  : value || "";

function mapTeam(team) {
  return {
    id: team.id,
    name: team.name,
    logoPath: team.logoPath,
    color: team.color.trim()
  };
}

function mapMatch(match) {
  return {
    id: match.id,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    round: match.round,
    date: dateValue(match.date),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homeTries: match.homeTries,
    awayTries: match.awayTries
  };
}

async function inTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function deriveLogoColor(svg) {
  const fills = [...svg.matchAll(/\bfill=["'](#[0-9a-fA-F]{6})["']/g)]
    .map((match) => match[1]);
  const color = fills.find((fill) => !["#ffffff", "#000000"].includes(fill.toLowerCase()));
  if (!color) throw new Error("Le logo de démonstration doit définir une couleur principale.");
  return color;
}

export function createDatabase({ connectionString = process.env.DATABASE_URL, pool: injectedPool } = {}) {
  if (!injectedPool && !connectionString) {
    throw new Error("DATABASE_URL est requis pour se connecter à PostgreSQL.");
  }

  const pool = injectedPool || new Pool({ connectionString, max: 4 });

  async function getMatchReports(matchId) {
    const result = await pool.query(`
      SELECT reporting_team_id AS "reportingTeamId", score,
        opponent_score AS "opponentScore", tries,
        opponent_tries AS "opponentTries", updated_at AS "updatedAt"
      FROM match_reports WHERE match_id = $1
    `, [matchId]);
    return Object.fromEntries(result.rows.map((report) => [
      report.reportingTeamId,
      {
        score: report.score,
        opponentScore: report.opponentScore,
        tries: report.tries,
        opponentTries: report.opponentTries,
        updatedAt: report.updatedAt
      }
    ]));
  }

  async function getMatch(matchId) {
    const result = await pool.query(`
      SELECT id, home_team_id AS "homeTeamId", away_team_id AS "awayTeamId",
        round, date, status,
        home_score AS "homeScore", away_score AS "awayScore",
        home_tries AS "homeTries", away_tries AS "awayTries"
      FROM matches WHERE id = $1
    `, [matchId]);
    return result.rows[0];
  }

  async function getLeagueMatch(matchId) {
    const { matches } = await database.listLeague();
    return matches.find((match) => match.id === matchId);
  }

  const database = {
    pool,

    async initialize() {
      await pool.query(schema);
      await inTransaction(pool, async (client) => {
        const teamIds = new Map();
        for (const team of demoTeams) {
          const logoFile = path.join(projectDirectory, "public", "logos", team.logo);
          const color = deriveLogoColor(fs.readFileSync(logoFile, "utf8"));
          const saved = await client.query(`
            INSERT INTO teams (name, logo_path, color)
            VALUES ($1, $2, $3)
            ON CONFLICT (name) DO UPDATE SET
              logo_path = EXCLUDED.logo_path,
              color = EXCLUDED.color
            RETURNING id
          `, [team.name, `/logos/${team.logo}`, color]);
          teamIds.set(team.name, saved.rows[0].id);
        }

        for (const [round, date, home, away, status, homeScore, awayScore, homeTries, awayTries] of demoMatches) {
          await client.query(`
            INSERT INTO matches
              (home_team_id, away_team_id, round, date, status,
               home_score, away_score, home_tries, away_tries)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (home_team_id, away_team_id, round) DO NOTHING
          `, [
            teamIds.get(home),
            teamIds.get(away),
            round,
            date,
            status,
            homeScore ?? null,
            awayScore ?? null,
            homeTries ?? null,
            awayTries ?? null
          ]);
        }
      });
    },

    async query(text, values) {
      return pool.query(text, values);
    },

    async getOrCreateSessionSecret(configuredSecret) {
      if (configuredSecret && Buffer.byteLength(configuredSecret) < 32) {
        throw new Error("SESSION_SECRET doit contenir au moins 32 octets aléatoires.");
      }
      if (configuredSecret) return configuredSecret;

      const generatedSecret = randomBytes(48).toString("base64url");
      await pool.query(`
        INSERT INTO app_settings (setting_key, setting_value)
        VALUES ('session_secret', $1)
        ON CONFLICT (setting_key) DO NOTHING
      `, [generatedSecret]);
      const saved = await pool.query(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'session_secret'"
      );
      return saved.rows[0].setting_value;
    },

    async listLeague() {
      const [teamResult, matchResult, reportResult, historyResult, adjudicationResult] = await Promise.all([
        pool.query("SELECT id, name, logo_path AS \"logoPath\", color FROM teams ORDER BY name"),
        pool.query(`
          SELECT id, home_team_id AS "homeTeamId", away_team_id AS "awayTeamId",
            round, date, status,
            home_score AS "homeScore", away_score AS "awayScore",
            home_tries AS "homeTries", away_tries AS "awayTries"
          FROM matches ORDER BY round, date, id
        `),
        pool.query(`
          SELECT match_id AS "matchId", reporting_team_id AS "reportingTeamId",
            score, opponent_score AS "opponentScore", tries,
            opponent_tries AS "opponentTries", updated_at AS "updatedAt"
          FROM match_reports ORDER BY match_id, reporting_team_id
        `),
        pool.query(`
          SELECT id, match_id AS "matchId", reporting_team_id AS "reportingTeamId",
            score, opponent_score AS "opponentScore", tries,
            opponent_tries AS "opponentTries", submitted_at AS "submittedAt"
          FROM match_report_history ORDER BY id
        `),
        pool.query(`
          SELECT id, match_id AS "matchId", admin_user_id AS "adminUserId",
            home_score AS "homeScore", away_score AS "awayScore",
            home_tries AS "homeTries", away_tries AS "awayTries",
            reason, decided_at AS "decidedAt"
          FROM match_adjudications ORDER BY id
        `)
      ]);

      const groupByMatch = (entries) => {
        const grouped = new Map();
        for (const entry of entries) {
          if (!grouped.has(entry.matchId)) grouped.set(entry.matchId, []);
          grouped.get(entry.matchId).push(entry);
        }
        return grouped;
      };
      const reportsByMatch = groupByMatch(reportResult.rows);
      const historyByMatch = groupByMatch(historyResult.rows);
      const adjudicationsByMatch = groupByMatch(adjudicationResult.rows);
      const reportsById = new Map();
      for (const [matchId, reports] of reportsByMatch) {
        reportsById.set(matchId, Object.fromEntries(reports.map((report) => [
          report.reportingTeamId,
          {
            score: report.score,
            opponentScore: report.opponentScore,
            tries: report.tries,
            opponentTries: report.opponentTries,
            updatedAt: report.updatedAt
          }
        ])));
      }

      return {
        teams: teamResult.rows.map(mapTeam),
        matches: matchResult.rows.map((match) => ({
          ...mapMatch(match),
          reports: reportsById.get(match.id) || {},
          reportHistory: historyByMatch.get(match.id) || [],
          adjudications: adjudicationsByMatch.get(match.id) || []
        }))
      };
    },

    async createAdmin(username, passwordHash) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, role)
        VALUES ($1, $2, 'admin')
        ON CONFLICT (username) DO NOTHING
        RETURNING id
      `, [username, passwordHash]);
      return result.rowCount === 1;
    },

    async getAdminUsername() {
      const result = await pool.query("SELECT username FROM users WHERE role = 'admin' LIMIT 1");
      return result.rows[0]?.username;
    },

    async createTeamAccount(name, username, passwordHash, logoPath = "/logos/racing-alizes.svg") {
      return inTransaction(pool, async (client) => {
        const logoFile = path.join(
          projectDirectory,
          "public",
          "logos",
          path.basename(logoPath)
        );
        const color = deriveLogoColor(fs.readFileSync(logoFile, "utf8"));
        const teamResult = await client.query(
          "INSERT INTO teams (name, logo_path, color) VALUES ($1, $2, $3) RETURNING id, name, logo_path AS \"logoPath\", color",
          [name, logoPath, color]
        );
        const team = mapTeam(teamResult.rows[0]);
        await client.query(`
          INSERT INTO users (username, password_hash, role, team_id, must_change_password)
          VALUES ($1, $2, 'team', $3, TRUE)
        `, [username, passwordHash, team.id]);
        return team;
      });
    },

    async registerTeamUser(teamId, username, passwordHash) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, role, team_id)
        VALUES ($1, $2, 'team', $3)
        RETURNING id, username, role, team_id AS "teamId",
          must_change_password AS "mustChangePassword"
      `, [username, passwordHash, teamId]);
      return result.rows[0];
    },

    async hasTeam(id) {
      const result = await pool.query("SELECT 1 FROM teams WHERE id = $1", [id]);
      return result.rowCount > 0;
    },

    async addMatch({ homeTeamId, awayTeamId, round, date }) {
      const result = await pool.query(`
        INSERT INTO matches (home_team_id, away_team_id, round, date)
        VALUES ($1, $2, $3, $4)
        RETURNING id, home_team_id AS "homeTeamId", away_team_id AS "awayTeamId",
          round, date, status,
          home_score AS "homeScore", away_score AS "awayScore",
          home_tries AS "homeTries", away_tries AS "awayTries"
      `, [homeTeamId, awayTeamId, round, date || null]);
      return { ...mapMatch(result.rows[0]), reports: {}, reportHistory: [], adjudications: [] };
    },

    getMatch,

    getMatchReports,

    async findUserByUsername(username) {
      const result = await pool.query(`
        SELECT id, username, password_hash AS "passwordHash", role,
          team_id AS "teamId", must_change_password AS "mustChangePassword"
        FROM users WHERE username = $1
      `, [username]);
      return result.rows[0];
    },

    async findUserById(id) {
      const result = await pool.query(`
        SELECT id, username, role, team_id AS "teamId",
          must_change_password AS "mustChangePassword"
        FROM users WHERE id = $1
      `, [id]);
      return result.rows[0];
    },

    async createSession(tokenHash, userId, expiresAt) {
      await pool.query(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        [tokenHash, userId, expiresAt]
      );
    },

    async findSession(tokenHash) {
      const result = await pool.query(`
        SELECT user_id AS "userId" FROM sessions
        WHERE token_hash = $1 AND expires_at > NOW()
      `, [tokenHash]);
      if (!result.rows[0]) {
        await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
        return null;
      }
      return this.findUserById(result.rows[0].userId);
    },

    async deleteSession(tokenHash) {
      await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
    },

    async updatePasswordAndRevokeSessions(userId, passwordHash) {
      await inTransaction(pool, async (client) => {
        await client.query(
          "UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2",
          [passwordHash, userId]
        );
        await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      });
    },

    async saveReport(match, reportingTeamId, report, result) {
      await inTransaction(pool, async (client) => {
        const now = new Date();
        await client.query(`
          INSERT INTO match_reports
            (match_id, reporting_team_id, score, opponent_score, tries, opponent_tries, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (match_id, reporting_team_id) DO UPDATE SET
            score = EXCLUDED.score,
            opponent_score = EXCLUDED.opponent_score,
            tries = EXCLUDED.tries,
            opponent_tries = EXCLUDED.opponent_tries,
            updated_at = EXCLUDED.updated_at
        `, [
          match.id, reportingTeamId, report.score, report.opponentScore,
          report.tries, report.opponentTries, now
        ]);
        await client.query(`
          INSERT INTO match_report_history
            (match_id, reporting_team_id, score, opponent_score, tries, opponent_tries, submitted_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          match.id, reportingTeamId, report.score, report.opponentScore,
          report.tries, report.opponentTries, now
        ]);
        await client.query(`
          UPDATE matches SET status = $1, home_score = $2, away_score = $3,
            home_tries = $4, away_tries = $5
          WHERE id = $6
        `, [
          result.status, result.homeScore ?? null, result.awayScore ?? null,
          result.homeTries ?? null, result.awayTries ?? null, match.id
        ]);
      });
      return getLeagueMatch(match.id);
    },

    async adjudicateMatch(match, adminUserId, result, reason) {
      await inTransaction(pool, async (client) => {
        const now = new Date();
        await client.query(`
          INSERT INTO match_adjudications
            (match_id, admin_user_id, home_score, away_score, home_tries, away_tries, reason, decided_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          match.id, adminUserId, result.homeScore, result.awayScore,
          result.homeTries, result.awayTries, reason, now
        ]);
        await client.query(`
          UPDATE matches SET status = 'confirmed', home_score = $1,
            away_score = $2, home_tries = $3, away_tries = $4
          WHERE id = $5
        `, [
          result.homeScore, result.awayScore, result.homeTries, result.awayTries, match.id
        ]);
      });
      return getLeagueMatch(match.id);
    },

    async close() {
      await pool.end();
    }
  };

  return database;
}
