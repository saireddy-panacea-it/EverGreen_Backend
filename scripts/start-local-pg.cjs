const path = require("path");
const EmbeddedPostgres = require("embedded-postgres");
const Postgres = EmbeddedPostgres.default || EmbeddedPostgres;

(async () => {
  const pg = new Postgres({
    databaseDir: path.join(__dirname, "..", ".pgdata"),
    user: "postgres",
    password: "postgres",
    port: 5432,
    persistent: true,
  });

  try {
    await pg.initialise();
  } catch (error) {
    console.log("Postgres already initialised:", error.message);
  }

  await pg.start();

  try {
    await pg.createDatabase("evergreen");
  } catch (error) {
    console.log("Database evergreen may already exist:", error.message);
  }

  console.log("Local Postgres is ready on 127.0.0.1:5432");
  await new Promise(() => {});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
