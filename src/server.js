import "dotenv/config";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";
import { createDatabase } from "./database.js";

const port = Number(process.env.PORT) || 3000;
const database = createDatabase();

try {
  await database.initialize();
  const sessionSecret = await database.getOrCreateSessionSecret(process.env.SESSION_SECRET);
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if ((adminUsername && !adminPassword) || (!adminUsername && adminPassword)) {
    throw new Error("ADMIN_USERNAME et ADMIN_PASSWORD doivent être définis ensemble.");
  }
  if (adminUsername && (!/^[a-zA-Z0-9._-]{3,40}$/.test(adminUsername) ||
      adminPassword.length < 12 || adminPassword.length > 200)) {
    throw new Error("Les identifiants administrateur configurés sont invalides.");
  }

  const existingAdminUsername = await database.getAdminUsername();
  if (adminUsername && !existingAdminUsername) {
    await database.createAdmin(adminUsername, await hashPassword(adminPassword));
  } else if (adminUsername &&
      existingAdminUsername.toLocaleLowerCase("en-US") !== adminUsername.toLocaleLowerCase("en-US")) {
    throw new Error("Un autre administrateur existe déjà dans cette base PostgreSQL.");
  }

  const app = createApp(database, {
    sessionSecret,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    trustProxy: process.env.TRUST_PROXY === "1"
  });
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Application Rugby disponible sur le port ${port}.`);
  });

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(async () => {
      await database.close();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  await database.close();
  throw error;
}
