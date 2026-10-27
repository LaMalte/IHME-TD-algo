# Classement d'une poule de rugby

Application pédagogique de classement avec React, Express et PostgreSQL. Le jeu fourni est entièrement fictif : quatre clubs, leurs logos dessinés pour le projet et quelques rencontres de démonstration. Aucune donnée officielle FFR n'est utilisée.

## Prérequis

- Node.js 22 ou plus récent et npm.
- Docker Desktop pour démarrer PostgreSQL localement ou utiliser Compose.

## Lancement local avec Node.js

Installe les dépendances, crée la configuration locale et démarre la base PostgreSQL :

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d database
```

Le `.env.example` utilise l'identifiant local `rugby` et le mot de passe de démonstration `rugby`. Remplace-les si tu changes la configuration du service PostgreSQL dans `compose.yaml`. Ces paramètres sont réservés au développement local, jamais à un serveur public.

Pour créer un administrateur local, renseigne `ADMIN_USERNAME` et `ADMIN_PASSWORD` dans `.env`. Le mot de passe doit comporter au moins 12 caractères. Ces deux variables sont facultatives et doivent être définies ensemble. Sans elles, l'application démarre sans compte administrateur.

Lance l'application :

```powershell
npm run dev
```

Ouvre <http://localhost:3000>. Pour arrêter PostgreSQL, utilise `docker compose down`; le volume PostgreSQL local est conservé.

## Lancement complet avec Docker Compose

Cette commande démarre l'application et sa base PostgreSQL de développement :

```powershell
docker compose up --build
```

Ouvre <http://localhost:3000>. Pour arrêter les services, utilise `Ctrl+C`, puis `docker compose down`. Le volume `postgres-data` conserve les données.

## Fonctionnement

- Les supporters consultent le classement, le calendrier et les résultats confirmés sans créer de compte. Ils peuvent choisir un club pour appliquer son thème dans leur navigateur.
- À l'ouverture du site, un écran dédié demande d'abord quel club suivre. Le choix ouvre une page propre au club, à son adresse `/clubs/<id>/`, avec ses couleurs, le classement, le calendrier et les résultats. Le bouton « Changer de club » ramène au choix initial.
- La couleur est calculée côté serveur à partir de la couleur principale du logo SVG du club. Les clubs ne définissent pas leur couleur.
- Un club peut s'inscrire à un club fictif encore disponible, puis déclarer uniquement ses propres scores. Les points et les essais doivent concorder entre les deux équipes avant publication et prise en compte au classement.
- Les feuilles en attente et les détails de déclarations restent privés. L'administrateur peut créer des clubs et des rencontres, et arbitrer un désaccord.
- Les rencontres et résultats de démonstration sont fictifs. Le barème de classement sert d'exemple pédagogique et ne prétend pas appliquer toutes les règles officielles FFR.

**Limite importante de la démonstration :** l'inscription publique ne vérifie pas que la personne appartient réellement au club dont elle revendique le compte. Ne l'utilise pas pour administrer de vrais clubs ou des données réelles sans ajouter une procédure de vérification et d'attribution des comptes.

Les mots de passe sont hachés avec scrypt. Les sessions sont signées, conservées sous forme de condensat dans PostgreSQL et envoyées dans un cookie HttpOnly/SameSite. En production, active HTTPS et configure `COOKIE_SECURE=true`. Le serveur génère automatiquement un secret de session et le conserve dans PostgreSQL si `SESSION_SECRET` n'est pas défini.

## Déploiement sur le serveur du cours

Le Dockerfile construit React avec `BASE_PATH`, puis sert l'application Express sur le port `3000`. Le pool PostgreSQL est limité à quatre connexions et utilise `DATABASE_URL`, fourni par le serveur. La route `GET /api/health` vérifie la connexion à la base.

1. Dans GitHub, ouvre **Settings → Secrets and variables → Actions**.
2. Crée le secret `IHME_DEPLOY_TOKEN` et les variables `IHME_DEPLOY_URL` et `IHME_BASE_PATH` à partir de tes propres fichiers d'accès. Ne copie jamais le jeton dans le dépôt, un commit, une capture ou un message.
3. Envoie tes changements sur `main` ou `master`. Le workflow **Construire et publier l'image** construit et publie l'image GHCR.
4. Pour mettre la version en ligne, ouvre **Actions → Construire et publier l'image → Run workflow**, coche **Déployer cette version après construction**, puis lance le workflow.

Le chemin de base attribué est `/ihme-td-algo/`. Les valeurs privées de déploiement ne sont volontairement pas incluses dans ce dépôt. Le déploiement ne se produit pas automatiquement lors d'un simple push.

## API principale

| Méthode | URL | Accès |
|---|---|---|
| `GET` | `/api/health` | Vérification de l'application et de PostgreSQL |
| `GET` | `/api/public/league` | Clubs, classement et rencontres publics |
| `GET` | `/api/league` | Détails de saisie (connexion requise) |
| `GET` | `/api/auth/me` | Session courante |
| `POST` | `/api/auth/register` | Inscription d'un club fictif disponible |
| `POST` | `/api/auth/login` | Connexion |
| `POST` | `/api/auth/logout` | Déconnexion |
| `POST` | `/api/auth/password` | Modification du mot de passe |
| `POST` | `/api/matches/:id/result` | Déclaration d'un score par un club participant |
| `POST` | `/api/teams` | Création d'un club (administrateur) |
| `POST` | `/api/matches` | Création d'une rencontre (administrateur) |
| `POST` | `/api/matches/:id/resolve` | Arbitrage d'un désaccord (administrateur) |

## Vérification

```powershell
npm test
npm run build -- --base=/ihme-td-algo/
```

Les tests couvrent les calculs du classement, l'initialisation idempotente des données PostgreSQL, l'API publique et les permissions des comptes de clubs.

## Repères dans le projet

- `client/App.jsx` et `client/styles.css` : interface React, vues publiques et espace club.
- `src/server.js` : configuration de démarrage, PostgreSQL, secret de session et serveur HTTP.
- `src/app.js` : routes Express, authentification, autorisations et service des fichiers React compilés.
- `src/database.js` : schéma PostgreSQL, pool de quatre connexions, données fictives et couleurs tirées des logos.
- `src/auth.js` : hachage des mots de passe et gestion cryptographique des sessions.
- `src/results.js` : comparaison des déclarations et confirmation des résultats.
- `src/standings.js` : calcul du classement à partir des seuls résultats confirmés.
- `public/logos/` : logos SVG fictifs, source des couleurs de clubs.
- `test/` : tests de l'API, de la base et des calculs sportifs.
- `Dockerfile` et `compose.yaml` : construction de l'image et environnement local PostgreSQL.
- `.github/workflows/publish.yml` : publication GHCR et déploiement manuel.
- `deploy/request.py` : appel du service de déploiement sans afficher les jetons.
- `.env.example` : exemple de configuration de développement; `.env` ne doit jamais être commité.
