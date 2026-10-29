import express from "express";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createSessionToken,
  getVerifiedSessionToken,
  hashPassword,
  parseCookies,
  verifyPassword
} from "./auth.js";
import { isValidMatchScore, resolveReports } from "./results.js";
import { calculateStandings, calculateStatistics } from "./standings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sessionCookieName = "rugby_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;
const dummyPasswordHash = `${"0".repeat(32)}:${"0".repeat(128)}`;

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isOptionalIsoDate(value) {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
}

function isValidUsername(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{3,40}$/.test(value);
}

function isValidPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 200;
}

function isValidContactEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidInvitationCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function getSha256Hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getSafeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    teamId: user.teamId,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

export function createApp(database, { sessionSecret, cookieSecure = false, trustProxy = false } = {}) {
  if (typeof sessionSecret !== "string" || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error("SESSION_SECRET doit contenir au moins 32 octets aléatoires.");
  }

  const app = express();
  if (trustProxy) app.set("trust proxy", 1);
  const loginAttempts = new Map();
  const recoveryRequestAttempts = new Map();
  const publicDirectory = path.resolve(currentDirectory, "..", "dist");

  app.use(express.json({ limit: "20kb" }));
  app.use("/logos", express.static(path.resolve(currentDirectory, "..", "public", "logos"), {
    maxAge: "1d",
    immutable: true
  }));
  app.use(express.static(publicDirectory, { index: false, maxAge: "1h" }));

  app.use(asyncRoute(async (request, response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.get("origin");
      if (origin) {
        let originUrl;
        try {
          originUrl = new URL(origin);
        } catch {
          response.status(403).json({ error: "Origine de requête non autorisée." });
          return;
        }
        const sameHost = originUrl.host === request.get("host");
        const sameProtocol =
          originUrl.protocol === `${request.protocol}:` ||
          (cookieSecure && originUrl.protocol === "https:");
        if (!sameHost || !sameProtocol) {
          response.status(403).json({ error: "Origine de requête non autorisée." });
          return;
        }
      }
    }

    const cookieValue = parseCookies(request.get("cookie"))[sessionCookieName];
    const token = getVerifiedSessionToken(cookieValue, sessionSecret);
    request.sessionToken = token;
    request.auth = token
      ? getSafeUser(await database.findSession(getSha256Hash(token)))
      : null;
    next();
  }));

  function requireAuth(request, response, next) {
    if (!request.auth) return response.status(401).json({ error: "Connectez-vous pour continuer." });
    if (
      request.auth.mustChangePassword &&
      !["/api/auth/me", "/api/auth/password", "/api/auth/logout"].includes(request.path)
    ) {
      return response.status(403).json({ error: "Changez votre mot de passe provisoire avant de continuer." });
    }
    next();
  }

  function requireAdmin(request, response, next) {
    if (!request.auth) return response.status(401).json({ error: "Connectez-vous pour continuer." });
    if (request.auth.role !== "admin") {
      return response.status(403).json({ error: "Cette action est réservée à l'administrateur." });
    }
    if (request.auth.mustChangePassword) {
      return response.status(403).json({ error: "Changez votre mot de passe avant de continuer." });
    }
    next();
  }

  function setSessionCookie(response, token) {
    const secure = cookieSecure ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationMs / 1000}${secure}`
    );
  }

  function clearSessionCookie(response) {
    const secure = cookieSecure ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
    );
  }

  async function startSession(userId, response) {
    const { token, cookieValue } = createSessionToken(sessionSecret);
    await database.createSession(
      getSha256Hash(token),
      userId,
      new Date(Date.now() + sessionDurationMs)
    );
    setSessionCookie(response, cookieValue);
  }

  app.get("/api/health", asyncRoute(async (_request, response) => {
    try {
      await database.query("SELECT 1");
      response.json({ status: "ok" });
    } catch (error) {
      console.error("Health check PostgreSQL failed:", error.message);
      response.status(503).json({ status: "unavailable" });
    }
  }));

  app.get("/api/public/league", asyncRoute(async (_request, response) => {
    const league = await database.listLeague();
    const publicMatches = league.matches.map((match) => {
      const confirmed = match.status === "confirmed";
      return {
        id: match.id,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        round: match.round,
        date: match.date,
        status: confirmed ? "confirmed" : "scheduled",
        homeScore: confirmed ? match.homeScore : null,
        awayScore: confirmed ? match.awayScore : null,
        homeTries: confirmed ? match.homeTries : null,
        awayTries: confirmed ? match.awayTries : null
      };
    });
    response.set("Cache-Control", "no-store");
    response.json({
      teams: league.teams,
      matches: publicMatches,
      standings: calculateStandings(league.teams, league.matches),
      statistics: calculateStatistics(calculateStandings(league.teams, league.matches))
    });
  }));

  app.get("/api/auth/me", (request, response) => {
    response.json({ user: request.auth });
  });

  app.post("/api/auth/register", asyncRoute(async (request, response) => {
    const { teamId, username, password, invitationCode } = request.body;
    if (
      !Number.isSafeInteger(teamId) ||
      !isValidUsername(username) ||
      !isValidPassword(password)
    ) {
      response.status(400).json({
        error: "Choisissez un club, un identifiant valide et un mot de passe de 12 à 200 caractères."
      });
      return;
    }
    if (!isValidInvitationCode(invitationCode)) {
      response.status(400).json({ error: "Un code d'invitation valide est requis pour créer un compte club." });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await database.registerTeamUser(
        teamId,
        username,
        passwordHash,
        getSha256Hash(invitationCode)
      );
      if (user === "registered") {
        response.status(409).json({
          error: "Ce club possède déjà un compte ou cet identifiant est déjà utilisé."
        });
        return;
      }
      if (!user) {
        response.status(400).json({ error: "Code d'invitation invalide, expiré ou déjà utilisé." });
        return;
      }
      await startSession(user.id, response);
      response.status(201).json({ user: getSafeUser(user) });
    } catch (error) {
      if (error.code === "23505") {
        response.status(409).json({
          error: "Ce club possède déjà un compte ou cet identifiant est déjà utilisé."
        });
        return;
      }
      if (error.code === "23503") {
        response.status(400).json({ error: "Le club sélectionné n'existe pas." });
        return;
      }
      throw error;
    }
  }));

  app.post("/api/auth/recovery-requests", asyncRoute(async (request, response) => {
    const ip = request.ip;
    const attempts = recoveryRequestAttempts.get(ip);
    if (attempts && attempts.count >= 3 && Date.now() - attempts.startedAt < 60 * 60 * 1000) {
      response.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
      return;
    }

    const { teamId, username = "", contactEmail } = request.body;
    if (
      !Number.isSafeInteger(teamId) ||
      !isValidContactEmail(contactEmail) ||
      (username !== "" && !isValidUsername(username))
    ) {
      response.status(400).json({
        error: "Choisissez votre club, saisissez une adresse e-mail valide et indiquez un identifiant valide si vous le connaissez."
      });
      return;
    }
    if (!(await database.hasTeam(teamId))) {
      response.status(400).json({ error: "Le club sélectionné n'existe pas." });
      return;
    }

    await database.createRecoveryRequest({
      teamId,
      username: username.trim(),
      contactEmail: contactEmail.trim()
    });
    if (!attempts || Date.now() - attempts.startedAt >= 60 * 60 * 1000) {
      recoveryRequestAttempts.set(ip, { count: 1, startedAt: Date.now() });
    } else {
      attempts.count += 1;
    }
    response.status(201).json({
      message: "Demande enregistrée. L'administration vérifiera votre identité puis vous contactera."
    });
  }));

  app.post("/api/auth/login", asyncRoute(async (request, response) => {
    const ip = request.ip;
    const attempts = loginAttempts.get(ip);
    if (attempts && attempts.count >= 10 && Date.now() - attempts.startedAt < 15 * 60 * 1000) {
      response.status(429).json({ error: "Trop de tentatives. Réessayez dans quelques minutes." });
      return;
    }

    const { username, password } = request.body;
    if (!isValidUsername(username) || typeof password !== "string" || password.length > 200) {
      response.status(400).json({ error: "Identifiant ou mot de passe invalide." });
      return;
    }

    const user = await database.findUserByUsername(username);
    const passwordIsValid = await verifyPassword(
      password,
      user?.passwordHash || dummyPasswordHash
    );
    if (!user || !passwordIsValid) {
      const current = loginAttempts.get(ip);
      if (!current || Date.now() - current.startedAt >= 15 * 60 * 1000) {
        loginAttempts.set(ip, { count: 1, startedAt: Date.now() });
      } else {
        current.count += 1;
      }
      response.status(401).json({ error: "Identifiant ou mot de passe invalide." });
      return;
    }

    loginAttempts.delete(ip);
    await startSession(user.id, response);
    response.json({ user: getSafeUser(user) });
  }));

  app.post("/api/auth/logout", asyncRoute(async (request, response) => {
    if (request.sessionToken) await database.deleteSession(getSha256Hash(request.sessionToken));
    clearSessionCookie(response);
    response.status(204).end();
  }));

  app.post("/api/auth/password", requireAuth, asyncRoute(async (request, response) => {
    const { currentPassword, newPassword } = request.body;
    if (typeof currentPassword !== "string" || !isValidPassword(newPassword)) {
      response.status(400).json({ error: "Le nouveau mot de passe doit contenir entre 12 et 200 caractères." });
      return;
    }

    const user = await database.findUserByUsername(request.auth.username);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      response.status(401).json({ error: "Mot de passe actuel incorrect." });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await database.updatePasswordAndRevokeSessions(user.id, passwordHash);
    await startSession(user.id, response);
    response.json({ user: { ...request.auth, mustChangePassword: false } });
  }));

  app.get("/api/league", requireAuth, asyncRoute(async (request, response) => {
    const league = await database.listLeague();
    const matches = league.matches.map((match) => {
      if (request.auth.role === "admin" || match.status !== "pending") return match;
      return {
        ...match,
        reports: Object.fromEntries(
          Object.entries(match.reports).filter(([teamId]) => Number(teamId) === request.auth.teamId)
        ),
        reportHistory: match.reportHistory.filter(
          (entry) => entry.reportingTeamId === request.auth.teamId
        )
      };
    });
    response.json({
      teams: league.teams,
      matches,
      standings: calculateStandings(league.teams, league.matches),
      statistics: calculateStatistics(calculateStandings(league.teams, league.matches))
    });
  }));

  app.get("/api/admin/recovery-requests", requireAdmin, asyncRoute(async (_request, response) => {
    response.json({ requests: await database.listRecoveryRequests() });
  }));

  app.get("/api/admin/invitation-codes", requireAdmin, asyncRoute(async (_request, response) => {
    response.json({ teams: await database.listTeamInvitationCodes() });
  }));

  app.post("/api/admin/teams/:id/invitation-code", requireAdmin, asyncRoute(async (request, response) => {
    const teamId = Number(request.params.id);
    if (!Number.isSafeInteger(teamId) || teamId < 1) {
      response.status(400).json({ error: "Club invalide." });
      return;
    }

    const code = randomBytes(32).toString("base64url");
    const result = await database.createTeamInvitationCode(teamId, getSha256Hash(code));
    if (result === "missing") {
      response.status(404).json({ error: "Le club sélectionné n'existe pas." });
      return;
    }
    if (result === "registered") {
      response.status(409).json({ error: "Ce club possède déjà un compte." });
      return;
    }
    response.status(201).json({ code });
  }));

  app.post("/api/admin/recovery-requests/:id/reset", requireAdmin, asyncRoute(async (request, response) => {
    const requestId = Number(request.params.id);
    if (!Number.isSafeInteger(requestId) || requestId < 1) {
      response.status(400).json({ error: "Demande de récupération invalide." });
      return;
    }

    const recoveryRequest = (await database.listRecoveryRequests())
      .find((entry) => entry.id === requestId && entry.status === "pending");
    if (!recoveryRequest) {
      response.status(404).json({ error: "Cette demande n'existe plus ou a déjà été traitée." });
      return;
    }

    const temporaryPassword = randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword);
    const account = await database.resolveRecoveryRequest(
      requestId,
      request.auth.id,
      recoveryRequest.teamId,
      passwordHash
    );
    if (!account) {
      response.status(409).json({
        error: "Aucun compte de club n'est associé à cette équipe ou la demande vient d'être traitée."
      });
      return;
    }

    response.json({
      username: account.username,
      temporaryPassword,
      message: "Mot de passe provisoire généré. Communiquez-le au contact après vérification de son identité."
    });
  }));

  app.get("/api/admin/administrative-points", requireAdmin, asyncRoute(async (_request, response) => {
    response.json({ adjustments: await database.listAdministrativePointAdjustments() });
  }));

  app.post("/api/teams/:id/administrative-points", requireAdmin, asyncRoute(async (request, response) => {
    const teamId = Number(request.params.id);
    const { points, reason } = request.body;
    if (
      !Number.isSafeInteger(teamId) ||
      !Number.isSafeInteger(points) ||
      points === 0 ||
      typeof reason !== "string" ||
      reason.trim().length < 5 ||
      reason.trim().length > 300
    ) {
      response.status(400).json({
        error: "Indiquez un nombre entier de points différent de zéro et un motif de 5 à 300 caractères."
      });
      return;
    }
    if (!(await database.hasTeam(teamId))) {
      response.status(404).json({ error: "Club introuvable." });
      return;
    }

    await database.addAdministrativePointAdjustment(
      teamId,
      request.auth.id,
      points,
      reason.trim()
    );
    response.json({ message: "Ajustement administratif enregistré." });
  }));

  app.post("/api/teams", requireAdmin, asyncRoute(async (request, response) => {
    const name = typeof request.body.name === "string" ? request.body.name.trim() : "";
    const username = request.body.username;
    if (!name || name.length > 80 || !isValidUsername(username)) {
      response.status(400).json({
        error: "Le nom du club doit contenir entre 1 et 80 caractères et l'identifiant 3 à 40 caractères."
      });
      return;
    }

    const initialPassword = randomBytes(18).toString("base64url");
    try {
      const passwordHash = await hashPassword(initialPassword);
      const team = await database.createTeamAccount(name, username, passwordHash);
      response.status(201).json({
        team,
        credentials: { username, initialPassword }
      });
    } catch (error) {
      if (error.code === "23505") {
        response.status(409).json({ error: "Ce nom de club ou cet identifiant existe déjà." });
        return;
      }
      throw error;
    }
  }));

  app.post("/api/matches", requireAdmin, asyncRoute(async (request, response) => {
    const { homeTeamId, awayTeamId, round, date = "" } = request.body;
    if (
      !Number.isSafeInteger(homeTeamId) ||
      !Number.isSafeInteger(awayTeamId) ||
      homeTeamId === awayTeamId ||
      !(await database.hasTeam(homeTeamId)) ||
      !(await database.hasTeam(awayTeamId)) ||
      !Number.isSafeInteger(round) ||
      round < 1 ||
      !isOptionalIsoDate(date)
    ) {
      response.status(400).json({ error: "Vérifiez les équipes, la journée et la date du match." });
      return;
    }

    try {
      response.status(201).json(await database.addMatch({ homeTeamId, awayTeamId, round, date }));
    } catch (error) {
      if (error.code === "23505") {
        response.status(409).json({ error: "Cette rencontre est déjà programmée." });
        return;
      }
      throw error;
    }
  }));

  app.post("/api/matches/:id/result", requireAuth, asyncRoute(async (request, response) => {
    const matchId = Number(request.params.id);
    const { score, opponentScore, tries, opponentTries } = request.body;
    if (
      !Number.isSafeInteger(matchId) ||
      ![score, opponentScore, tries, opponentTries].every(isNonNegativeInteger)
    ) {
      response.status(400).json({
        error: "Saisissez les points et essais des deux équipes en nombres entiers égaux ou supérieurs à zéro."
      });
      return;
    }
    if (!isValidMatchScore(score, opponentScore, tries, opponentTries)) {
      response.status(400).json({
        error: "Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez les points et essais de chaque équipe."
      });
      return;
    }

    if (request.auth.role !== "team") {
      response.status(403).json({ error: "Seuls les comptes d'équipe peuvent saisir une feuille de match." });
      return;
    }

    const match = await database.getMatch(matchId);
    if (!match) {
      response.status(404).json({ error: "Match introuvable." });
      return;
    }
    if (match.status === "confirmed") {
      response.status(409).json({ error: "Ce résultat est déjà confirmé et ne peut plus être modifié." });
      return;
    }
    if (request.auth.teamId !== match.homeTeamId && request.auth.teamId !== match.awayTeamId) {
      response.status(403).json({ error: "Votre équipe ne participe pas à ce match." });
      return;
    }

    const report = { score, opponentScore, tries, opponentTries };
    const storedReports = await database.getMatchReports(matchId);
    const homeReport = request.auth.teamId === match.homeTeamId
      ? report
      : storedReports[match.homeTeamId];
    const awayReport = request.auth.teamId === match.awayTeamId
      ? report
      : storedReports[match.awayTeamId];
    const result = resolveReports(homeReport, awayReport);
    response.json(await database.saveReport(match, request.auth.teamId, report, result));
  }));

  app.post("/api/matches/:id/resolve", requireAdmin, asyncRoute(async (request, response) => {
    const matchId = Number(request.params.id);
    const { homeScore, awayScore, homeTries, awayTries, reason } = request.body;
    if (
      !Number.isSafeInteger(matchId) ||
      ![homeScore, awayScore, homeTries, awayTries].every(isNonNegativeInteger) ||
      typeof reason !== "string" ||
      reason.trim().length < 5 ||
      reason.trim().length > 500
    ) {
      response.status(400).json({ error: "Indiquez les points, essais et un motif de 5 à 500 caractères." });
      return;
    }
    if (!isValidMatchScore(homeScore, awayScore, homeTries, awayTries)) {
      response.status(400).json({
        error: "Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez les points et essais des deux équipes."
      });
      return;
    }

    const match = await database.getMatch(matchId);
    if (!match) {
      response.status(404).json({ error: "Match introuvable." });
      return;
    }
    if (match.status !== "disputed") {
      response.status(409).json({ error: "Seul un match en désaccord peut être arbitré." });
      return;
    }

    const decidedMatch = await database.adjudicateMatch(
      match,
      request.auth.id,
      { homeScore, awayScore, homeTries, awayTries },
      reason.trim()
    );
    response.json(decidedMatch);
  }));

  app.get("/api/*path", (_request, response) => {
    response.status(404).json({ error: "Route API introuvable." });
  });

  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(publicDirectory, "index.html"));
  });

  app.use((error, _request, response, _next) => {
    if (error.type === "entity.parse.failed") {
      response.status(400).json({ error: "Le JSON reçu est invalide." });
      return;
    }
    if (error.type === "entity.too.large") {
      response.status(413).json({ error: "La requête est trop volumineuse." });
      return;
    }
    console.error(error);
    response.status(500).json({ error: "Une erreur interne est survenue." });
  });

  return app;
}
