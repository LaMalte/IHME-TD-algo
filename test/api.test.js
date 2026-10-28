import test from "node:test";
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { createDatabase } from "../src/database.js";

test("publishes only fictional confirmed results and protects club accounts", async () => {
  const memory = newDb({ noAstCoverageCheck: true });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const database = createDatabase({ pool });
  await database.initialize();
  const adminPassword = "admin-password-secure";
  await database.createAdmin("demo-admin", await hashPassword(adminPassword));
  const server = createApp(database, {
    sessionSecret: "0123456789abcdef0123456789abcdef"
  }).listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    async function request(url, { method = "GET", body, cookie, origin } = {}) {
      const headers = {};
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (cookie) headers.Cookie = cookie;
      if (origin) headers.Origin = origin;
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const responseBody = response.status === 204 ? null : await response.json();
      const setCookie = response.headers.getSetCookie?.()[0]?.split(";")[0];
      return {
        status: response.status,
        body: responseBody,
        cookie: setCookie || cookie,
        setCookieHeader: response.headers.getSetCookie?.()[0]
      };
    }

    const health = await request("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok" });

    const publicLeague = await request("/api/public/league");
    assert.equal(publicLeague.status, 200);
    assert.equal(publicLeague.body.teams.length, 12);
    assert.equal(publicLeague.body.matches.length, 132);
    assert.ok(publicLeague.body.teams.every((team) =>
      team.logoPath.startsWith("/logos/") &&
      /^#[\da-f]{6}$/i.test(team.color) &&
      typeof team.slogan === "string" &&
      team.slogan.length > 0
    ));
    assert.equal(publicLeague.body.matches[0].status, "confirmed");
    assert.equal("reports" in publicLeague.body.matches[0], false);
    assert.equal("reportHistory" in publicLeague.body.matches[0], false);
    assert.equal("adjudications" in publicLeague.body.matches[0], false);
    assert.equal((await request("/api/league")).status, 401);

    const teams = publicLeague.body.teams;
    const home = teams.find((team) => team.name === "Racing Club des Alizés");
    const scheduledMatch = publicLeague.body.matches.find((match) =>
      match.status === "scheduled" &&
      match.homeTeamId === home.id
    );
    assert.ok(scheduledMatch);
    const opponentTeam = teams.find((team) =>
      team.id === (scheduledMatch.homeTeamId === home.id
        ? scheduledMatch.awayTeamId
        : scheduledMatch.homeTeamId)
    );

    const invalidRegistration = await request("/api/auth/register", {
      method: "POST",
      body: { teamId: home.id, username: "club-alizes", password: "short" }
    });
    assert.equal(invalidRegistration.status, 400);

    const homeRegistration = await request("/api/auth/register", {
      method: "POST",
      body: { teamId: home.id, username: "club-alizes", password: "club-password-secure" }
    });
    assert.equal(homeRegistration.status, 201);
    assert.equal(homeRegistration.body.user.role, "team");
    assert.match(homeRegistration.setCookieHeader, /HttpOnly/i);
    assert.match(homeRegistration.setCookieHeader, /SameSite=Strict/i);
    const homeCookie = homeRegistration.cookie;

    const missingScore = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: "", opponentScore: 0, tries: 0, opponentTries: 0 }
    });
    assert.equal(missingScore.status, 400);
    assert.match(missingScore.body.error, /nombres entiers/);

    const negativeScore = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: -1, opponentScore: 0, tries: 0, opponentTries: 0 }
    });
    assert.equal(negativeScore.status, 400);
    assert.match(negativeScore.body.error, /entiers égaux ou supérieurs à zéro/);

    const decimalScore = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: 12.5, opponentScore: 0, tries: 0, opponentTries: 0 }
    });
    assert.equal(decimalScore.status, 400);
    assert.match(decimalScore.body.error, /nombres entiers/);

    const inconsistentScore = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: 0, opponentScore: 0, tries: 1, opponentTries: 0 }
    });
    assert.equal(inconsistentScore.status, 400);
    assert.match(inconsistentScore.body.error, /chaque essai vaut au minimum 5 points/);

    const duplicateClub = await request("/api/auth/register", {
      method: "POST",
      body: { teamId: home.id, username: "other-account", password: "club-password-secure" }
    });
    assert.equal(duplicateClub.status, 409);

    const awayRegistration = await request("/api/auth/register", {
      method: "POST",
      body: {
        teamId: opponentTeam.id,
        username: "club-adversaire",
        password: "club-password-secure"
      }
    });
    assert.equal(awayRegistration.status, 201);
    const awayCookie = awayRegistration.cookie;

    const ownLeague = await request("/api/league", { cookie: homeCookie });
    assert.equal(ownLeague.status, 200);
    const ownMatch = ownLeague.body.matches.find((match) => match.id === scheduledMatch.id);
    assert.ok(ownMatch);

    const outsiderMatch = publicLeague.body.matches.find((match) =>
      match.status === "scheduled" &&
      match.homeTeamId !== home.id &&
      match.awayTeamId !== home.id
    );
    const outsiderResult = await request(`/api/matches/${outsiderMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: 10, opponentScore: 8, tries: 2, opponentTries: 1 }
    });
    assert.equal(outsiderResult.status, 403);

    const firstReport = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: homeCookie,
      body: { score: 24, opponentScore: 19, tries: 3, opponentTries: 2 }
    });
    assert.equal(firstReport.status, 200);
    assert.equal(firstReport.body.status, "pending");

    const pendingPublic = (await request("/api/public/league")).body.matches.find(
      (match) => match.id === scheduledMatch.id
    );
    assert.equal(pendingPublic.status, "scheduled");
    assert.equal(pendingPublic.homeScore, null);
    assert.equal("reports" in pendingPublic, false);

    const agreement = await request(`/api/matches/${scheduledMatch.id}/result`, {
      method: "POST",
      cookie: awayCookie,
      body: { score: 19, opponentScore: 24, tries: 2, opponentTries: 3 }
    });
    assert.equal(agreement.body.status, "confirmed");
    const confirmedPublic = (await request("/api/public/league")).body.matches.find(
      (match) => match.id === scheduledMatch.id
    );
    assert.equal(confirmedPublic.status, "confirmed");
    assert.equal(confirmedPublic.homeScore, 24);
    assert.equal(confirmedPublic.awayScore, 19);
    assert.equal("reports" in confirmedPublic, false);

    const adminLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: "demo-admin", password: adminPassword }
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.user.role, "admin");
    const adminCookie = adminLogin.cookie;

    const unauthenticatedRecoveryRequests = await request("/api/admin/recovery-requests");
    assert.equal(unauthenticatedRecoveryRequests.status, 401);
    const recoveryRequest = await request("/api/auth/recovery-requests", {
      method: "POST",
      body: {
        teamId: home.id,
        username: "club-alizes",
        contactEmail: "contact@alizes.example"
      }
    });
    assert.equal(recoveryRequest.status, 201);

    const adminRecoveryRequests = await request("/api/admin/recovery-requests", {
      cookie: adminCookie
    });
    assert.equal(adminRecoveryRequests.status, 200);
    assert.equal(adminRecoveryRequests.body.requests[0].contactEmail, "contact@alizes.example");

    const reset = await request(
      `/api/admin/recovery-requests/${adminRecoveryRequests.body.requests[0].id}/reset`,
      { method: "POST", cookie: adminCookie }
    );
    assert.equal(reset.status, 200);
    assert.equal(reset.body.username, "club-alizes");
    assert.ok(reset.body.temporaryPassword.length >= 20);
    assert.equal((await request("/api/league", { cookie: homeCookie })).status, 401);
    const temporaryLogin = await request("/api/auth/login", {
      method: "POST",
      body: { username: reset.body.username, password: reset.body.temporaryPassword }
    });
    assert.equal(temporaryLogin.status, 200);
    assert.equal(temporaryLogin.body.user.mustChangePassword, true);

    const pointsAdjustment = await request(`/api/teams/${home.id}/administrative-points`, {
      method: "POST",
      cookie: adminCookie,
      body: { points: -2, reason: "Sanction fictive" }
    });
    assert.equal(pointsAdjustment.status, 200);
    const adjustedLeague = await request("/api/public/league");
    assert.equal(
      adjustedLeague.body.standings.find((row) => row.teamId === home.id).administrativePoints,
      -2
    );
    assert.equal(
      adjustedLeague.body.standings.find((row) => row.teamId === home.id).tablePoints,
      adjustedLeague.body.standings.find((row) => row.teamId === home.id).sportsPoints - 2
    );
    const adminAdjustments = await request("/api/admin/administrative-points", {
      cookie: adminCookie
    });
    assert.equal(adminAdjustments.status, 200);
    assert.equal(adminAdjustments.body.adjustments[0].reason, "Sanction fictive");

    const badOrigin = await request("/api/auth/login", {
      method: "POST",
      body: { username: "demo-admin", password: adminPassword },
      origin: "https://not-the-app.example"
    });
    assert.equal(badOrigin.status, 403);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await database.close();
  }
});
