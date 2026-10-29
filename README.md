# Ovale — classement de rugby

## 1. Cadrage

L’application s’adresse aux clubs d’une poule de rugby. Chaque club peut déclarer les points et essais des deux équipes d’un match. Le résultat entre dans le classement quand les deux déclarations concordent. Les supporters consultent gratuitement le classement, les statistiques et le calendrier.

## 2. Lien et lancement

Site : [https://node219697-ihme26.jcloud.ik-server.com/ihme-td-algo/](https://node219697-ihme26.jcloud.ik-server.com/ihme-td-algo/)

Le frontend React est servi par Express. L’API est sous `/api`, la route `/api/health` vérifie le serveur et PostgreSQL, et le pool PostgreSQL est limité à 4 connexions.

En local, démarrer Docker Desktop puis lancer à la racine du projet :

```powershell
docker compose up --build
```

Ouvrir <http://localhost:3000>. Arrêter avec `Ctrl+C`, puis `docker compose down`.

## 3. Données

Schéma simplifié (PK = clé primaire, FK = clé étrangère) :

```text
teams (PK id)
  ├── matches (PK id, FK home_team_id et away_team_id → teams.id)
  ├── users (PK id, FK team_id → teams.id)
  ├── team_invitation_codes (PK/FK team_id → teams.id)
  ├── match_reports (PK match_id + reporting_team_id, FK vers matches et teams)
  ├── match_report_history (PK id, FK vers matches et teams)
  ├── administrative_point_adjustments (PK id, FK vers teams et users)
  └── account_recovery_requests (PK id, FK vers teams et users)

matches (PK id)
  └── match_adjudications (PK id, FK vers matches et users)

sessions (PK token_hash, FK user_id → users.id)
app_settings (PK setting_key)
```

Dans [`src/database.js`](./src/database.js), cette requête réelle récupère les clubs et leurs logos :

```sql
SELECT id, name, logo_path AS "logoPath", color
FROM teams
ORDER BY name
```

`ORDER BY name` affiche les clubs par ordre alphabétique.

## Persistance

Les données de l’application sont enregistrées dans PostgreSQL. Avec Docker Compose en local, le service PostgreSQL utilise le volume nommé `postgres-data`, monté dans `/var/lib/postgresql/data`; les données sont ainsi conservées indépendamment du conteneur. `docker compose down -v` supprime aussi ce volume.

## 4. Algorithme

[`src/standings.js`](./src/standings.js) ignore les matchs qui ne sont pas confirmés. Une victoire vaut 4 points, un nul 2 et une défaite 0. Un bonus vaut 1 point : bonus offensif si l’écart d’essais est d’au moins 3, bonus défensif si la défaite est de 5 points ou moins. Les deux bonus sont calculés séparément. Les points administratifs s’ajoutent aux points sportifs. En cas d’égalité, le code départage par différence de points, points marqués, puis nom du club.

Ce barème est pédagogique et ne reprend pas forcément toutes les règles officielles de la FFR.

Exemple du test [`test/standings.test.js`](./test/standings.test.js) : A bat B 30–26 et marque 5 essais contre 2. A reçoit 4 points de victoire et 1 bonus offensif, soit **5 points**. B perd de 4 points et reçoit le bonus défensif, soit **1 point**. A est classé devant B.

## 5. Contrôle des entrées

- Dans le formulaire club, l’interface refuse les champs vides, négatifs ou décimaux et affiche : « Saisissez les points et essais des deux équipes avec des nombres entiers positifs ou nuls. Les champs vides, négatifs ou décimaux sont refusés. »
- Pour ces valeurs invalides, l’API renvoie : « Saisissez les points et essais des deux équipes en nombres entiers égaux ou supérieurs à zéro. »
- Si un essai ne correspond pas à au moins 5 points, l’interface affiche : « Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez le score de chaque équipe. » L’API renvoie : « Résultat incohérent : chaque essai vaut au minimum 5 points. Vérifiez les points et essais de chaque équipe. »
- Un score 0–0 sans essai est autorisé.
- Pour arbitrer un match, l’administrateur doit également fournir un motif de 5 à 500 caractères.

## 6. Essais

Résultats observés en exécutant `npm test` :

| Entrée | Attendu | Obtenu | Vérifié sur le site |
|---|---|---|---|
| Match confirmé : A 30–26 B, essais 5–2 | A : 5 pts; B : 1 pt | Test réussi : A est devant B avec ces points | |
| Aucun match confirmé | Aucun match joué et aucune statistique de club | Test réussi : 0 match joué, catégories vides; la page indique « Aucun match confirmé pour le moment. » | |
| Score A = −1 | Refus avec erreur HTTP 400 | Test API réussi : « Saisissez les points et essais des deux équipes en nombres entiers égaux ou supérieurs à zéro. » | |

Le cas limite 0–0 sans essai est également testé : il est accepté et rapporte 2 points à chaque équipe.

## 7. Tests automatiques

Lancer les tests :

```powershell
npm test
```

Les tests de [`test/`](./test/) vérifient le calcul du classement et des bonus, les statistiques, les matchs non confirmés, la validation des scores, l’accord des feuilles, les comptes et permissions, la récupération d’accès et l’initialisation de la base.

## 8. Fonctions du site

- Choix d’un club; couleurs inspirées de son logo et slogan fictif.
- Fiche du club avec sa position dans la poule, placée à droite du bandeau sur grand écran.
- Classement triable par points, différence de points ou essais marqués. Il tient dans la largeur de la page; sur petit écran, les lignes deviennent des fiches.
- Statistiques des trois meilleures attaques, défenses, équipes ayant marqué le plus d’essais et équipes en ayant encaissé le moins.
- Logos et noms cliquables dans le classement, le calendrier et les statistiques pour ouvrir la fiche du club.
- Calendrier filtrable par club, journée et statut (résultat confirmé ou match à venir/en attente); un message s’affiche si aucun match ne correspond.
- Comptes club, déclaration des feuilles et confirmation automatique lorsque les deux déclarations concordent.
- Inscription protégée par un code d’invitation propre au club, généré par l’administrateur et utilisable une seule fois. Seul son hash est conservé; un nouveau code invalide le précédent.
- Récupération d’identifiant ou de mot de passe par demande à l’administrateur. Aucun courriel automatique n’est envoyé; après vérification, l’administrateur peut fournir un mot de passe provisoire.
- Inscription protégée par un code d’invitation propre au club, généré par l’administrateur et utilisable une seule fois. Seul son hash est conservé; un nouveau code invalide le précédent.
- Espace administrateur pour programmer les matchs, arbitrer un désaccord et gérer les points administratifs.

## 9. Limite et amélioration

Le code d’invitation limite l’inscription aux personnes qui l’ont reçu, mais ne vérifie pas à lui seul que la personne appartient réellement au club. L’administrateur doit donc transmettre les codes en privé et peut faire valider les comptes avant d’autoriser la saisie des scores.

## 10. Données fictives

Les clubs, logos, calendriers, scores et slogans de démonstration sont fictifs et ne représentent pas les résultats officiels de la FFR. Aucun secret personnel ni jeton de déploiement n’est versionné dans le dépôt. Le fichier `.env.example` est un modèle : les vrais secrets restent dans l’environnement privé.
