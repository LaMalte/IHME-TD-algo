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

function ScoreEntry({ match, team, opponent, onSubmit }) {
  const [values, setValues] = useState({
    score: match.reports?.[team.id]?.score ?? "",
    opponentScore: match.reports?.[team.id]?.opponentScore ?? "",
    tries: match.reports?.[team.id]?.tries ?? "",
    opponentTries: match.reports?.[team.id]?.opponentTries ?? ""
  });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
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
    <form className="score-form" onSubmit={submit}>
      <strong>Déclarer le résultat pour {team.name}</strong>
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
            onChange={(event) => setValues({ ...values, [key]: event.target.value })}
          />
        </label>
      ))}
      <button disabled={busy}>{busy ? "Envoi…" : "Envoyer ma feuille"}</button>
    </form>
  );
}

function App() {
  const [league, setLeague] = useState({ teams: [], matches: [], standings: [] });
  const [currentUser, setCurrentUser] = useState(null);
  const [selectedTeamId, setSelectedTeamId] = useState(getTeamIdFromPath);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [roundFilter, setRoundFilter] = useState("all");
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const publicMatches = league.matches.filter((match) =>
    roundFilter === "all" || match.round === Number(roundFilter)
  );
  const myMatches = currentUser?.role === "team"
    ? league.matches.filter((match) =>
      (match.homeTeamId === currentUser.teamId || match.awayTeamId === currentUser.teamId) &&
      match.status !== "confirmed"
    )
    : [];

  const refresh = useCallback(async (user = currentUser) => {
    const data = await request(user && !user.mustChangePassword ? "/league" : "/public/league");
    setLeague(data);
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
  }

  function navigateHome() {
    window.history.pushState({}, "", homePath);
    setSelectedTeamId("");
    setLoginOpen(false);
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
    <section className="panel forms-grid auth-grid">
      <form onSubmit={(event) => submitAuth(event, "login")}>
        <h2>Connexion club</h2>
        <label>Identifiant<input name="username" minLength="3" maxLength="40" autoComplete="username" required /></label>
        <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={busy}>Se connecter</button>
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
  );

  if (!selectedTeam) {
    return (
      <div className="app-shell selection-shell">
        <header className="hero">
          <div className="container hero-content">
            <p className="eyebrow">OVALE · SAISON DE DÉMONSTRATION</p>
            <h1>Choisissez votre club.</h1>
            <p>Retrouvez son classement, ses résultats et toute l’actualité de sa poule.</p>
            <div className="hero-actions">
              <button className="button-secondary" type="button" onClick={() => setLoginOpen(!loginOpen)}>
                {loginOpen ? "Retour au choix du club" : "Espace club"}
              </button>
              {currentUser && (
                <span>{currentUser.role === "admin" ? "Administration" : `Connecté · ${teamById.get(currentUser.teamId)?.name || currentUser.username}`}</span>
              )}
            </div>
          </div>
        </header>
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
          <p className="eyebrow">POULE · SAISON DE DÉMONSTRATION</p>
          <h1>Le club {selectedTeam.name}.</h1>
          <p>Classement, rencontres et résultats de sa poule.</p>
          <div className="hero-actions">
            {currentUser ? (
              <>
                <span>{currentUser.role === "admin" ? "Administration" : `Espace club · ${teamById.get(currentUser.teamId)?.name || currentUser.username}`}</span>
                <button className="button-secondary" type="button" onClick={logout}>Se déconnecter</button>
              </>
            ) : (
              <button className="button-secondary" type="button" onClick={() => setLoginOpen(!loginOpen)}>
                Connexion ou inscription club
              </button>
            )}
            <button className="button-secondary" type="button" onClick={navigateHome}>
              Changer de club
            </button>
          </div>
        </div>
      </header>

      <main className="container main-content">
        {message && <p className={`message ${error ? "error" : ""}`} role="status">{message}</p>}

        <section className="panel selected-club-panel">
          <Logo team={selectedTeam} className="selected-club-logo" />
          <div>
            <p className="eyebrow">VOTRE CLUB</p>
            <h2>{selectedTeam.name}</h2>
            <p className="hint">Thème inspiré automatiquement de son logo.</p>
          </div>
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

        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LE CLASSEMENT</p>
              <h2>La poule</h2>
            </div>
            <button className="button-light" type="button" onClick={() => refresh().catch((cause) => notify(cause.message, true))}>
              Actualiser
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Rang</th><th>Club</th><th>J</th><th>V</th><th>N</th><th>D</th>
                <th>Pts marqués</th><th>Pts encaissés</th><th>Diff.</th>
                <th>Essais</th><th>Bonus</th><th>Pts classement</th>
              </tr></thead>
              <tbody>
                {league.standings.length === 0
                  ? <tr><td className="empty" colSpan="12">Chargement du classement…</td></tr>
                  : league.standings.map((row, index) => {
                    const team = teamById.get(row.teamId);
                    return (
                      <tr key={row.teamId} className={String(row.teamId) === selectedTeamId ? "selected-team" : ""}>
                        <td>{String(index + 1).padStart(2, "0")}</td>
                        <td><span className="team-cell">{team && <Logo team={team} />}{row.teamName}</span></td>
                        <td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td>
                        <td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{row.pointsDifference}</td>
                        <td>{row.tryFor} / {row.tryAgainst}</td>
                        <td>{row.offensiveBonuses} BO · {row.defensiveBonuses} BD</td>
                        <td className="table-points">{row.tablePoints}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="hint">Données de démonstration entièrement fictives — elles ne représentent aucune compétition officielle.</p>
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
          <section className="panel">
            <h2>Administration de la démonstration</h2>
            <form className="admin-match-form" onSubmit={submitMatch}>
              <label>Domicile<select name="homeTeamId" required defaultValue="">
                <option value="" disabled>Choisir</option>
                {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
              </select></label>
              <label>Visiteur<select name="awayTeamId" required defaultValue="">
                <option value="" disabled>Choisir</option>
                {league.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}
              </select></label>
              <label>Journée<input name="round" type="number" min="1" required /></label>
              <label>Date<input name="date" type="date" /></label>
              <button disabled={busy}>Programmer</button>
            </form>
          </section>
        )}

        <section className="panel schedule-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LE CALENDRIER</p>
              <h2>Rencontres et résultats</h2>
            </div>
            <label className="round-picker">Journée
              <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
                <option value="all">Toutes</option>
                {rounds.map((round) => <option value={round} key={round}>Journée {round}</option>)}
              </select>
            </label>
          </div>
          <div className="match-list">
            {publicMatches.length === 0 && <p className="empty">Chargement des rencontres…</p>}
            {publicMatches.map((match) => {
              const home = teamById.get(match.homeTeamId);
              const away = teamById.get(match.awayTeamId);
              if (!home || !away) return null;
              return (
                <article className="match-card" key={match.id}>
                  <div className="match-meta"><span>J{String(match.round).padStart(2, "0")}</span><span>{match.date ? new Date(`${match.date}T12:00:00`).toLocaleDateString("fr-FR") : "Date à confirmer"}</span></div>
                  <div className="match-team home-team"><Logo team={home} /><span>{home.name}</span></div>
                  <div className={`match-score ${match.status === "confirmed" ? "is-confirmed" : ""}`}>
                    {match.status === "confirmed" ? `${match.homeScore} – ${match.awayScore}` : "VS"}
                  </div>
                  <div className="match-team away-team"><Logo team={away} /><span>{away.name}</span></div>
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
