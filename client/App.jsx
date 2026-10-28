import { useCallback, useEffect, useMemo, useState } from "react";

const apiBase = `${import.meta.env.BASE_URL}api`;
const logoBase = import.meta.env.BASE_URL;
const homePath = import.meta.env.BASE_URL;

function getTeamIdFromPath() {
  const route = window.location.pathname.startsWith(homePath)
    ? window.location.pathname.slice(homePath.length)
    : "";
  const match = route.match(/^clubs\/(\d+)\/?$/);
  return match ? match[1] : "";
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête a échoué.");
  return result;
}

function Logo({ team, className = "" }) {
  return (
    <img
      className={`team-logo ${className}`}
      src={`${logoBase}${team.logoPath.replace(/^\/+/, "")}`}
      alt={`Logo fictif de ${team.name}`}
      loading="lazy"
    />
  );
}

function TeamLink({ team, className = "", onSelect }) {
  return (
    <button
      className={className}
      type="button"
      title={`Voir la page de ${team.name}`}
      onClick={() => onSelect(team.id)}
    >
      <Logo team={team} />
      <span>{team.name}</span>
    </button>
  );
}

function ScoreEntry({ match, team, opponent, onSubmit }) {
  const [values, setValues] = useState({
    score: match.reports?.[team.id]?.score ?? "",
    opponentScore: match.reports?.[team.id]?.opponentScore ?? "",
    tries: match.reports?.[team.id]?.tries ?? "",
    opponentTries: match.reports?.[team.id]?.opponentTries ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const invalid = Object.values(values).some((value) =>
      value === "" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))
    );
    if (invalid) {
      setValidationError("Saisissez les points et essais des deux équipes avec des nombres entiers positifs ou nuls. Les champs vides, négatifs ou décimaux sont refusés.");
      return;
    }
    if (Number(values.tries) * 5 > Number(values.score) ||
      Number(values.opponentTries) * 5 > Number(values.opponentScore)) {
      setValidationError("Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez le score de chaque équipe.");
      return;
    }

    setValidationError("");
    setBusy(true);
    try {
      await onSubmit(match.id, Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, Number(value)])
      ));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="score-form" noValidate onSubmit={submit}>
      <strong>Déclarer le résultat pour {team.name}</strong>
      {validationError && <p className="message error score-error" role="alert">{validationError}</p>}
      {[
        ["score", `Points ${team.name}`],
        ["opponentScore", `Points ${opponent.name}`],
        ["tries", `Essais ${team.name}`],
        ["opponentTries", `Essais ${opponent.name}`]
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min="0"
            step="1"
            required
            value={values[key]}
            aria-invalid={Boolean(validationError)}
            onChange={(event) => {
              setValues({ ...values, [key]: event.target.value });
              setValidationError("");
            }}
          />
        </label>
      ))}
      <button disabled={busy}>{busy ? "Envoi…" : "Envoyer ma feuille"}</button>
    </form>
  );
}

function App() {
  const [league, setLeague] = useState({ teams: [], matches: [], standings: [], statistics: [] });
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedTeamId, setSelectedTeamId] = useState(getTeamIdFromPath);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [roundFilter, setRoundFilter] = useState("all");
  const [scheduleClubFilter, setScheduleClubFilter] = useState("all");
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState("all");
  const [standingsSort, setStandingsSort] = useState("default");
  const [loginOpen, setLoginOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adminRecoveryRequests, setAdminRecoveryRequests] = useState([]);
  const [adminPointAdjustments, setAdminPointAdjustments] = useState([]);
  const [recoveryCredentials, setRecoveryCredentials] = useState({});

  const teamById = useMemo(
    () => new Map(league.teams.map((team) => [team.id, team])),
    [league.teams]
  );
  const selectedTeam = teamById.get(Number(selectedTeamId));
  const teamColor = selectedTeam?.color || "#183c57";
  const rounds = useMemo(
    () => [...new Set(league.matches.map((match) => match.round))].sort((a, b) => a - b),
    [league.matches]
  );
  const publicMatches = league.matches.filter((match) => {
    const matchesRound = roundFilter === "all" || match.round === Number(roundFilter);
    const matchesClub = scheduleClubFilter === "all" ||
      match.homeTeamId === Number(scheduleClubFilter) ||
      match.awayTeamId === Number(scheduleClubFilter);
    const matchesStatus = scheduleStatusFilter === "all" ||
      (scheduleStatusFilter === "confirmed"
        ? match.status === "confirmed"
        : match.status !== "confirmed");
    return matchesRound && matchesClub && matchesStatus;
  });
  const sortedStandings = useMemo(() => {
    if (standingsSort === "default") return league.standings;
    const originalOrder = new Map(league.standings.map((row, index) => [row.teamId, index]));
    const valueFor = {
      points: (row) => row.tablePoints,
      difference: (row) => row.pointsDifference,
      tries: (row) => row.tryFor
    }[standingsSort];
    return [...league.standings].sort((left, right) =>
      valueFor(right) - valueFor(left) ||
      originalOrder.get(left.teamId) - originalOrder.get(right.teamId)
    );
  }, [league.standings, standingsSort]);
  const myMatches = currentUser?.role === "team"
    ? league.matches.filter((match) =>
      (match.homeTeamId === currentUser.teamId || match.awayTeamId === currentUser.teamId) &&
      match.status !== "confirmed"
    )
    : [];
  const selectedStanding = league.standings.find((row) => String(row.teamId) === selectedTeamId);

  const refresh = useCallback(async (user = currentUser) => {
    const data = await request(user && !user.mustChangePassword ? "/league" : "/public/league");
    setLeague(data);
    if (user?.role === "admin" && !user.mustChangePassword) {
      const [recoveryData, pointData] = await Promise.all([
        request("/admin/recovery-requests"),
        request("/admin/administrative-points")
      ]);
      setAdminRecoveryRequests(recoveryData.requests);
      setAdminPointAdjustments(pointData.adjustments);
    }
    if (selectedTeamId && !data.teams.some((team) => String(team.id) === selectedTeamId)) {
      setSelectedTeamId("");
      window.history.replaceState({}, "", homePath);
    }
  }, [currentUser, selectedTeamId]);

  useEffect(() => {
    function syncRoute() {
      setSelectedTeamId(getTeamIdFromPath());
      setLoginOpen(false);
    }
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    refresh().catch((cause) => notify(cause.message, true));
    request("/auth/me")
      .then(({ user }) => {
        setCurrentUser(user);
        if (user && !user.mustChangePassword) {
          refresh(user).catch((cause) => notify(cause.message, true));
        }
      })
      .catch((cause) => notify(cause.message, true));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch((cause) => notify(cause.message, true));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    document.documentElement.style.setProperty("--club-primary", teamColor);
    document.documentElement.style.setProperty(
      "--club-foreground",
      isLightColor(teamColor) ? "#17231d" : "#ffffff"
    );
  }, [teamColor]);

  function notify(text, isError = false) {
    setMessage(text);
    setError(isError);
  }

  function navigateToTeam(teamId) {
    if (!teamId) return;
    window.history.pushState({}, "", `${homePath}clubs/${teamId}/`);
    setSelectedTeamId(String(teamId));
    setRoundFilter("all");
    setLoginOpen(false);
    setRecoveryOpen(false);
  }

  function navigateHome() {
    window.history.pushState({}, "", homePath);
    setSelectedTeamId("");
    setLoginOpen(false);
    setRecoveryOpen(false);
  }

  async function runAction(action, successMessage, userAfterAction = () => currentUser) {
    setBusy(true);
    try {
      await action();
      await refresh(userAfterAction());
      notify(successMessage);
    } catch (cause) {
      notify(cause.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function submitAuth(event, mode) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    let signedInUser = null;
    await runAction(async () => {
      const { user } = await request(
        mode === "register" ? "/auth/register" : "/auth/login",
        { method: "POST", body: JSON.stringify({
          ...values,
          ...(values.teamId ? { teamId: Number(values.teamId) } : {})
        }) }
      );
      setCurrentUser(user);
      signedInUser = user;
      setLoginOpen(false);
      form.reset();
      navigateToTeam(user.role === "team" ? user.teamId : selectedTeamId || league.teams[0]?.id);
    }, mode === "register" ? "Compte de club créé." : "Connexion réussie.", () => signedInUser);
  }

  async function submitRecoveryRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    await runAction(async () => {
      await request("/auth/recovery-requests", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          teamId: Number(values.teamId)
        })
      });
      form.reset();
      setRecoveryOpen(false);
      setLoginOpen(false);
    }, "Demande enregistrée. L'administration vérifiera votre identité puis vous contactera.", () => null);
  }

  async function resetRecoveryRequest(requestId) {
    let response;
    await runAction(async () => {
      response = await request(`/admin/recovery-requests/${requestId}/reset`, {
        method: "POST"
      });
      setRecoveryCredentials((previous) => ({
        ...previous,
        [requestId]: response
      }));
    }, "Mot de passe provisoire généré. Transmettez-le au contact après vérification de son identité.");
  }

  async function submitAdministrativePoints(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    await runAction(() => request(`/teams/${values.teamId}/administrative-points`, {
      method: "POST",
      body: JSON.stringify({
        points: Number(values.points),
        reason: values.reason
      })
    }), "Ajustement administratif enregistré.");
    form.reset();
  }

  async function logout() {
    await runAction(async () => {
      await request("/auth/logout", { method: "POST" });
      setCurrentUser(null);
      setLoginOpen(false);
    }, "Vous êtes déconnecté.", () => null);
  }

  async function submitPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    await runAction(async () => {
      const { user } = await request("/auth/password", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setCurrentUser(user);
      form.reset();
    }, "Mot de passe modifié.");
  }

  async function submitReport(matchId, result) {
    await runAction(
      () => request(`/matches/${matchId}/result`, {
        method: "POST",
        body: JSON.stringify(result)
      }),
      "Feuille de match enregistrée."
    );
  }

  async function submitMatch(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await runAction(() => request("/matches", {
      method: "POST",
      body: JSON.stringify({
        ...values,
        homeTeamId: Number(values.homeTeamId),
        awayTeamId: Number(values.awayTeamId),
        round: Number(values.round)
      })
    }), "Rencontre programmée.");
    event.currentTarget.reset();
  }

  async function submitResolution(event, matchId) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const scoreValues = ["homeScore", "awayScore", "homeTries", "awayTries"];
    if (scoreValues.some((key) => values[key] === "" || !/^\d+$/.test(values[key]) || !Number.isSafeInteger(Number(values[key])))) {
      notify("Saisissez les points et essais des deux équipes en nombres entiers positifs ou nuls.", true);
      return;
    }
    if (Number(values.homeTries) * 5 > Number(values.homeScore) ||
      Number(values.awayTries) * 5 > Number(values.awayScore)) {
      notify("Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez le score de chaque équipe.", true);
      return;
    }
    await runAction(() => request(`/matches/${matchId}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        homeScore: Number(values.homeScore),
        awayScore: Number(values.awayScore),
        homeTries: Number(values.homeTries),
        awayTries: Number(values.awayTries),
        reason: values.reason
      })
    }), "Résultat arbitré.");
  }

  const authForms = (
    recoveryOpen ? (
      <section className="panel recovery-panel">
        <div>
          <p className="eyebrow">AIDE À LA CONNEXION</p>
          <h2>Identifiant ou mot de passe oublié ?</h2>
          <p className="hint">La demande sera visible par l’administration. Aucun e-mail automatique ne sera envoyé. Un administrateur vérifiera votre identité puis vous contactera.</p>
        </div>
        <form className="recovery-form" onSubmit={submitRecoveryRequest}>
          <label>Club concerné
            <select name="teamId" required defaultValue={selectedTeamId || ""}>
              <option value="" disabled>Choisir un club</option>
              {league.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>Identifiant, si vous le connaissez
            <input name="username" minLength="3" maxLength="40" pattern="[A-Za-z0-9._-]{3,40}" autoComplete="username" />
          </label>
          <label>Adresse e-mail de contact
            <input name="contactEmail" type="email" maxLength="254" autoComplete="email" required />
          </label>
          <div className="recovery-actions">
            <button disabled={busy}>Envoyer la demande</button>
            <button className="text-button" type="button" onClick={() => setRecoveryOpen(false)}>Retour à la connexion</button>
          </div>
        </form>
      </section>
    ) : (
      <section className="panel forms-grid auth-grid">
        <form onSubmit={(event) => submitAuth(event, "login")}>
          <h2>Connexion club</h2>
          <label>Identifiant<input name="username" minLength="3" maxLength="40" autoComplete="username" required /></label>
          <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
          <button disabled={busy}>Se connecter</button>
          <button className="text-button" type="button" onClick={() => setRecoveryOpen(true)}>
            Identifiant ou mot de passe oublié ?
          </button>
        </form>
        <form onSubmit={(event) => submitAuth(event, "register")}>
          <h2>Créer un compte club</h2>
          <p className="hint">Démonstration fictive : chaque club peut revendiquer son équipe non inscrite.</p>
          <label>Club
            <select name="teamId" required defaultValue="">
              <option value="" disabled>Choisir un club</option>
              {league.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>Identifiant<input name="username" minLength="3" maxLength="40" pattern="[A-Za-z0-9._-]{3,40}" autoComplete="username" required /></label>
          <label>Mot de passe (12 caractères minimum)<input name="password" type="password" minLength="12" maxLength="200" autoComplete="new-password" required /></label>
          <button disabled={busy}>Créer mon compte</button>
        </form>
      </section>
    )
  );

  if (!selectedTeam) {
    return (
      <div className="app-shell selection-shell">
        <header className="hero">
          <div className="container hero-content">
            <div className="hero-copy">
              <p className="hero-kicker"><span className="rugby-ball" aria-hidden="true">XV</span><span className="eyebrow">OVALE · SAISON DE DÉMONSTRATION</span></p>
              <h1>Choisissez votre club.</h1>
              <p>Retrouvez son classement, ses résultats et toute l’actualité de sa poule.</p>
            </div>
            <div className="hero-actions selection-hero-actions">
              <span className="club-access-caption">Vous gérez un club ?</span>
              <button className="button-secondary" type="button" onClick={() => setLoginOpen(!loginOpen)}>
                {loginOpen ? "Retour au choix du club" : "Espace club"}
              </button>
              {currentUser && (
                <span>{currentUser.role === "admin" ? "Administration" : `Connecté · ${teamById.get(currentUser.teamId)?.name || currentUser.username}`}</span>
              )}
            </div>
          </div>
        </header>
        <div className="competition-strip" aria-label="Informations sur la compétition">
          <div className="container competition-strip-inner">
            <strong><span className="strip-ball" aria-hidden="true">XV</span> FÉDÉRALE 3</strong>
            <span className="strip-divider" aria-hidden="true" />
            <span>{league.teams.length || "—"} clubs</span>
            <span>{rounds.length || "—"} journées</span>
            <span className="fictional-tag">Saison fictive · démonstration</span>
          </div>
        </div>
        <main className="container main-content selection-content">
          {message && <p className={`message ${error ? "error" : ""}`} role="status">{message}</p>}
          {loginOpen ? authForms : (
            <section className="club-selection">
              <div className="selection-heading">
                <p className="eyebrow">LA POULE</p>
                <h2>Quel club souhaitez-vous suivre ?</h2>
                <p className="hint">Choisissez une équipe pour ouvrir sa page personnalisée. Les couleurs sont extraites automatiquement de son logo.</p>
              </div>
              {league.teams.length === 0 ? (
                <p className="panel empty">Chargement des clubs…</p>
              ) : (
                <div className="club-grid">
                  {league.teams.map((team) => (
                    <a
                      className="club-choice"
                      href={`${homePath}clubs/${team.id}/`}
                      key={team.id}
                      onClick={(event) => {
                        event.preventDefault();
                        navigateToTeam(team.id);
                      }}
                      style={{ "--team-color": team.color }}
                    >
                      <Logo team={team} className="club-choice-logo" />
                      <span className="club-choice-name">{team.name}</span>
                      <span className="club-choice-slogan">“{team.slogan}”</span>
                      <span className="club-choice-caption">Voir le classement et les résultats</span>
                      <span className="club-choice-arrow" aria-hidden="true">→</span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
        <footer className="container footer">
          <span>OVALE · Saison fictive</span>
          <span>Projet pédagogique IHME · Aucun résultat officiel</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="container hero-content">
          <div className="hero-copy">
            <p className="hero-kicker"><span className="rugby-ball" aria-hidden="true">XV</span><span className="eyebrow">FÉDÉRALE 3 · POULE DE DÉMONSTRATION</span></p>
            <h1>{selectedTeam.name}</h1>
            <p>{selectedTeam.slogan}</p>
          </div>
          <div className="hero-crest" aria-hidden="true">
            <Logo team={selectedTeam} className="hero-team-logo" />
          </div>
          <div className="hero-actions">
            {currentUser ? (
              <>
                <span>{currentUser.role === "admin" ? "Administration" : `Espace club · ${teamById.get(currentUser.teamId)?.name || currentUser.username}`}</span>
                <button className="button-secondary" type="button" onClick={logout}>Se déconnecter</button>
              </>
            ) : (
              <button className="button-secondary" type="button" onClick={() => setLoginOpen(!loginOpen)}>
                Espace club
              </button>
            )}
            <button className="button-secondary" type="button" onClick={navigateHome}>
              Changer de club
            </button>
          </div>
        </div>
      </header>

      <nav className="league-nav" aria-label="Navigation de la poule">
        <div className="container league-nav-inner">
          <a className="league-brand" href={homePath} onClick={(event) => {
            event.preventDefault();
            navigateHome();
          }}>
            <span className="brand-mark">O</span>
            <span>OVALE<span className="brand-divider"> / </span><span className="brand-club">{selectedTeam.name}</span></span>
          </a>
          <div className="league-nav-links">
            <a href="#classement">Classement</a>
            <a href="#statistiques">Statistiques</a>
            <a href="#calendrier">Calendrier</a>
          </div>
          <span className="season-tag">SAISON FICTIVE 2026–27</span>
        </div>
      </nav>

      <div className="competition-strip" aria-label="Informations sur la compétition">
        <div className="container competition-strip-inner">
          <strong><span className="strip-ball" aria-hidden="true">XV</span> FÉDÉRALE 3</strong>
          <span className="strip-divider" aria-hidden="true" />
          <span>{league.teams.length || "—"} clubs</span>
          <span>{rounds.length || "—"} journées</span>
          <span className="fictional-tag">Saison fictive · démonstration</span>
        </div>
      </div>

      <main className="container main-content">
        {message && <p className={`message ${error ? "error" : ""}`} role="status">{message}</p>}

        <section className="panel selected-club-panel club-dashboard">
          <div className="club-dashboard-identity">
            <div className="club-portrait"><Logo team={selectedTeam} className="selected-club-logo" /></div>
            <div className="club-dashboard-copy">
              <p className="eyebrow">FICHE ÉQUIPE · POULE 10</p>
              <h2>{selectedTeam.name}</h2>
              <p className="hint club-slogan">« {selectedTeam.slogan} »</p>
            </div>
          </div>
          {selectedStanding && (() => {
            const rank = league.standings.findIndex((row) => row.teamId === selectedStanding.teamId) + 1;
            const rankProgress = Math.max(6, ((league.teams.length - rank + 1) / league.teams.length) * 100);
            return (
              <div className="club-dashboard-results">
                <div className="rank-feature">
                  <span className="rank-caption">POSITION DANS LA POULE</span>
                  <strong>#{String(rank).padStart(2, "0")}</strong>
                  <span className="rank-total">sur {league.teams.length} clubs</span>
                  <span className="rank-track" aria-hidden="true"><span style={{ width: `${rankProgress}%` }} /></span>
                </div>
              </div>
            );
          })()}
        </section>

        <section className="club-statistics" aria-labelledby="club-statistics-title">
          <div className="club-statistics-heading">
            <div>
              <p className="eyebrow">BILAN SPORTIF</p>
              <h2 id="club-statistics-title">Les chiffres du club</h2>
            </div>
            <span>Résultats confirmés uniquement</span>
          </div>
          <div className="club-stat-grid">
            {[
              ["Matchs joués", selectedStanding?.played ?? 0, "matchs"],
              ["Victoires", selectedStanding?.wins ?? 0, "victoires"],
              ["Nuls", selectedStanding?.draws ?? 0, "nuls"],
              ["Défaites", selectedStanding?.losses ?? 0, "défaites"],
              ["Points marqués", selectedStanding?.pointsFor ?? 0, "pts"],
              ["Points encaissés", selectedStanding?.pointsAgainst ?? 0, "pts"]
            ].map(([label, value, unit]) => (
              <article className="club-stat-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{unit}</small>
              </article>
            ))}
            <article className="club-stat-card club-bonus-stat">
              <span>Bonus obtenus</span>
              <strong>{(selectedStanding?.offensiveBonuses ?? 0) + (selectedStanding?.defensiveBonuses ?? 0)}</strong>
              <small>{selectedStanding?.offensiveBonuses ?? 0} BO · {selectedStanding?.defensiveBonuses ?? 0} BD</small>
            </article>
          </div>
          {selectedStanding?.played === 0 && (
            <p className="empty club-stat-empty">Aucun match confirmé pour ce club : ses statistiques apparaîtront après validation des feuilles de match.</p>
          )}
        </section>

        {loginOpen && !currentUser && authForms}

        {currentUser?.mustChangePassword && (
          <section className="panel auth-panel">
            <h2>Changer le mot de passe provisoire</h2>
            <form onSubmit={submitPassword}>
              <label>Mot de passe actuel<input name="currentPassword" type="password" required /></label>
              <label>Nouveau mot de passe<input name="newPassword" type="password" minLength="12" maxLength="200" required /></label>
              <button disabled={busy}>Enregistrer</button>
            </form>
          </section>
        )}

        <section className="panel standings-panel" id="classement">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LE CLASSEMENT</p>
              <h2>Le classement de la poule</h2>
              <p className="section-subtitle">Chaque point compte. Retrouvez les performances des clubs journée après journée.</p>
            </div>
            <div className="standings-actions">
              <label className="sort-picker">Trier par
                <select value={standingsSort} onChange={(event) => setStandingsSort(event.target.value)}>
                  <option value="default">Classement actuel</option>
                  <option value="points">Points classement (pts)</option>
                  <option value="difference">Différence de points (pts)</option>
                  <option value="tries">Essais marqués</option>
                </select>
              </label>
              <button className="button-light" type="button" onClick={() => refresh().catch((cause) => notify(cause.message, true))}>
                Actualiser
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Rang</th><th>Club</th><th>J</th><th>V</th><th>N</th><th>D</th>
                <th>Pts marqués (pts)</th><th>Pts encaissés (pts)</th><th>Diff. (pts)</th>
                <th>Essais marqués / encaissés (essais)</th><th>Bonus obtenus (BO · BD)</th>
                <th>Points administratifs (pts)</th><th>Points classement (pts)</th>
              </tr></thead>
              <tbody>
                {league.standings.length === 0
                  ? <tr><td className="empty" colSpan="13">Chargement du classement…</td></tr>
                  : sortedStandings.map((row, index) => {
                    const team = teamById.get(row.teamId);
                    return (
                      <tr key={row.teamId} className={String(row.teamId) === selectedTeamId ? "selected-team" : ""}>
                        <td data-label="Rang"><span className={`rank-badge ${index < 3 ? `rank-medal rank-medal-${index + 1}` : ""}`}>{String(index + 1).padStart(2, "0")}</span></td>
                        <td data-label="Club">{team && <TeamLink team={team} className="team-cell team-link" onSelect={navigateToTeam} />}</td>
                        <td data-label="Joués">{row.played}</td><td data-label="Victoires">{row.wins}</td>
                        <td data-label="Nuls">{row.draws}</td><td data-label="Défaites">{row.losses}</td>
                        <td data-label="Points marqués">{row.pointsFor}</td><td data-label="Points encaissés">{row.pointsAgainst}</td>
                        <td data-label="Différence">{row.pointsDifference}</td>
                        <td data-label="Essais marqués / encaissés">{row.tryFor} / {row.tryAgainst}</td>
                        <td data-label="Bonus (BO · BD)">{row.offensiveBonuses} BO · {row.defensiveBonuses} BD</td>
                        <td data-label="Points administratifs" className={row.administrativePoints < 0 ? "negative-points" : ""}>{row.administrativePoints > 0 ? "+" : ""}{row.administrativePoints}</td>
                        <td data-label="Points classement" className="table-points">{row.tablePoints}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="hint">Données de démonstration entièrement fictives — elles ne représentent aucune compétition officielle.</p>
        </section>

        <section className="panel statistics-panel" id="statistiques">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CHIFFRES DE LA POULE</p>
              <h2>Les statistiques</h2>
            </div>
            <p className="hint">Calculées sur les résultats confirmés.</p>
          </div>
          <div className="statistics-grid">
            {(league.statistics || []).map((category) => (
              <article className="stat-card" key={category.key}>
                <h3>{category.title}</h3>
                {category.rows.length > 0 ? <ol className="stat-list">
                  {category.rows.map((row, index) => (
                    <li key={row.teamId}>
                      <span className="stat-rank">{String(index + 1).padStart(2, "0")}</span>
                      {teamById.has(Number(row.teamId))
                        ? <TeamLink team={teamById.get(Number(row.teamId))} className="stat-team-link team-link" onSelect={navigateToTeam} />
                        : <span className="stat-team">{row.teamName}</span>}
                      <strong>{row[category.key]}</strong>
                    </li>
                  ))}
                </ol> : <p className="hint">Aucun match confirmé pour le moment.</p>}
              </article>
            ))}
          </div>
        </section>

        {currentUser?.role === "team" && !currentUser.mustChangePassword && (
          <section className="panel club-workspace">
            <p className="eyebrow">ESPACE CLUB</p>
            <h2>Vos feuilles de match</h2>
            {myMatches.length === 0 && <p className="empty">Aucune feuille à compléter.</p>}
            {myMatches.map((match) => {
              const team = teamById.get(currentUser.teamId);
              const opponent = teamById.get(match.homeTeamId === team.id ? match.awayTeamId : match.homeTeamId);
              return (
                <article className="club-match" key={match.id}>
                  <h3>Journée {match.round} · {team.name} / {opponent.name}</h3>
                  <p className="hint">{match.date ? new Date(`${match.date}T12:00:00`).toLocaleDateString("fr-FR") : "Date à confirmer"}</p>
                  <ScoreEntry match={match} team={team} opponent={opponent} onSubmit={submitReport} />
                </article>
              );
            })}
          </section>
        )}

        {currentUser?.role === "admin" && !currentUser.mustChangePassword && (
          <>
            <section className="panel admin-panel">
              <p className="eyebrow">GESTION DE LA POULE</p>
              <h2>Administration</h2>
              <h3 className="admin-subheading">Programmer une rencontre</h3>
              <form className="admin-match-form" onSubmit={submitMatch}>
                <label>Domicile<select name="homeTeamId" required defaultValue="">
                  <option value="" disabled>Choisir</option>
                  {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
                </select></label>
                <label>Visiteur<select name="awayTeamId" required defaultValue="">
                  <option value="" disabled>Choisir</option>
                  {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
                </select></label>
                <label>Journée<input name="round" type="number" min="1" max="22" required /></label>
                <label>Date<input name="date" type="date" /></label>
                <button disabled={busy}>Programmer</button>
              </form>
              <h3 className="admin-subheading">Points administratifs</h3>
              <p className="hint">Saisissez un ajout ou un retrait de points. Chaque mouvement est historisé avec son motif.</p>
              <form className="admin-points-form" onSubmit={submitAdministrativePoints}>
                <label>Club<select name="teamId" required defaultValue="">
                  <option value="" disabled>Choisir un club</option>
                  {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
                </select></label>
                <label>Points à ajouter ou retirer
                  <input name="points" type="number" step="1" min="-100" max="100" required />
                </label>
                <label>Motif (5 à 300 caractères)
                  <input name="reason" minLength="5" maxLength="300" required />
                </label>
                <button disabled={busy}>Enregistrer</button>
              </form>
              {adminPointAdjustments.length > 0 && (
                <div className="table-wrap">
                  <table className="admin-history-table">
                    <thead><tr><th>Date</th><th>Club</th><th>Points</th><th>Motif</th><th>Admin</th></tr></thead>
                    <tbody>{adminPointAdjustments.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.createdAt).toLocaleDateString("fr-FR")}</td>
                        <td>{entry.teamName}</td>
                        <td className={entry.points < 0 ? "negative-points" : "positive-points"}>{entry.points > 0 ? "+" : ""}{entry.points}</td>
                        <td>{entry.reason}</td>
                        <td>{entry.adminUsername}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="panel admin-panel recovery-requests-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ACCÈS CLUBS</p>
                  <h2>Demandes de récupération</h2>
                </div>
                <span className="request-count">{adminRecoveryRequests.filter((entry) => entry.status === "pending").length} en attente</span>
              </div>
              <p className="hint">Vérifiez l’identité du contact avant de générer un mot de passe provisoire. Celui-ci n’est affiché qu’une fois et doit être communiqué en privé.</p>
              {adminRecoveryRequests.length === 0
                ? <p className="empty">Aucune demande reçue.</p>
                : <div className="recovery-request-list">
                  {adminRecoveryRequests.map((entry) => (
                    <article className={`recovery-request ${entry.status}`} key={entry.id}>
                      <div className="recovery-request-details">
                        <strong>{entry.teamName}</strong>
                        <span>{entry.username ? `Identifiant : ${entry.username}` : "Identifiant non renseigné"}</span>
                        <a href={`mailto:${entry.contactEmail}`}>{entry.contactEmail}</a>
                        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("fr-FR")}</time>
                        <span className="request-status">{entry.status === "pending" ? "À traiter" : "Traitée"}</span>
                      </div>
                      {entry.status === "pending" && (
                        <div className="recovery-request-actions">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => resetRecoveryRequest(entry.id)}
                          >
                            Réinitialiser après vérification
                          </button>
                        </div>
                      )}
                      {recoveryCredentials[entry.id] && (
                        <p className="temporary-credentials" role="status">
                          Identifiant : <strong>{recoveryCredentials[entry.id].username}</strong><br />
                          Mot de passe provisoire : <code>{recoveryCredentials[entry.id].temporaryPassword}</code>
                        </p>
                      )}
                    </article>
                  ))}
                </div>}
            </section>
          </>
        )}

        <section className="panel schedule-panel" id="calendrier">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LE CALENDRIER</p>
              <h2>Rencontres et résultats</h2>
            </div>
            <div className="schedule-filters">
              <label>Club
                <select value={scheduleClubFilter} onChange={(event) => setScheduleClubFilter(event.target.value)}>
                  <option value="all">Tous les clubs</option>
                  {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label>Matchs
                <select value={scheduleStatusFilter} onChange={(event) => setScheduleStatusFilter(event.target.value)}>
                  <option value="all">Tous</option>
                  <option value="confirmed">Résultats confirmés</option>
                  <option value="upcoming">À venir / en attente</option>
                </select>
              </label>
              <label>Journée
                <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
                  <option value="all">Toutes</option>
                  {rounds.map((round) => <option value={round} key={round}>Journée {round}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="match-list">
            {publicMatches.length === 0 && (
              <p className="empty">
                {league.matches.length === 0
                  ? "Chargement des rencontres…"
                  : scheduleStatusFilter === "confirmed"
                    ? "Aucun résultat confirmé ne correspond aux filtres sélectionnés."
                    : scheduleStatusFilter === "upcoming"
                      ? "Aucun match à venir ou en attente ne correspond aux filtres sélectionnés."
                      : "Aucun match ne correspond aux filtres sélectionnés."}
              </p>
            )}
            {publicMatches.map((match) => {
              const home = teamById.get(match.homeTeamId);
              const away = teamById.get(match.awayTeamId);
              if (!home || !away) return null;
              return (
                <article className="match-card" key={match.id}>
                  <div className="match-meta"><span>J{String(match.round).padStart(2, "0")}</span><span>{match.date ? new Date(`${match.date}T12:00:00`).toLocaleDateString("fr-FR") : "Date à confirmer"}</span></div>
                  <TeamLink team={home} className="match-team match-team-link home-team" onSelect={navigateToTeam} />
                  <div className={`match-score ${match.status === "confirmed" ? "is-confirmed" : ""}`}>
                    {match.status === "confirmed" ? `${match.homeScore} – ${match.awayScore}` : "VS"}
                  </div>
                  <TeamLink team={away} className="match-team match-team-link away-team" onSelect={navigateToTeam} />
                  {match.status === "confirmed"
                    ? <div className="match-note">Essais {match.homeTries} – {match.awayTries}</div>
                    : <div className="match-note">Résultat en attente</div>}
                  {currentUser?.role === "admin" && match.status === "disputed" && (
                    <form className="resolution-form" onSubmit={(event) => submitResolution(event, match.id)}>
                      <label>Pts dom.<input name="homeScore" type="number" min="0" required /></label>
                      <label>Pts ext.<input name="awayScore" type="number" min="0" required /></label>
                      <label>Essais dom.<input name="homeTries" type="number" min="0" required /></label>
                      <label>Essais ext.<input name="awayTries" type="number" min="0" required /></label>
                      <label>Motif<input name="reason" minLength="5" maxLength="500" required /></label>
                      <button disabled={busy}>Arbitrer</button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <footer className="container footer">
        <span>OVALE · Saison fictive</span>
        <span>Projet pédagogique IHME · Aucun résultat officiel</span>
      </footer>
    </div>
  );
}

function isLightColor(hexColor) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hexColor.slice(index, index + 2), 16) / 255);
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.42;
}

export default App;
