/**
 * Database tooling.
 *
 *   npm run db:snapshot   Build the pre-migrated snapshot for the embedded engine
 *   npm run db:migrate    Apply pending migrations to DATABASE_URL
 *   npm run db:seed       Load the demo dataset into an empty DATABASE_URL
 *   npm run db:reset      Drop everything in DATABASE_URL, migrate and re-seed
 */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  connectPostgres,
  createEmbeddedDatabase,
  migrate,
  seedIfEmpty,
  snapshotFile,
} from "../src/db/client";

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      "DATABASE_URL is not set. Add it to .env.local, or run without it to use the embedded engine.",
    );
    process.exit(1);
  }
  return url;
}

async function snapshot(): Promise<void> {
  const file = snapshotFile();
  const directory = path.dirname(file);

  // Remove snapshots of earlier schema versions.
  if (existsSync(directory)) {
    for (const name of readdirSync(directory)) {
      if (name.endsWith(".tar.gz") && path.join(directory, name) !== file) {
        rmSync(path.join(directory, name));
      }
    }
  }
  if (existsSync(file)) {
    console.log(`Schema snapshot is up to date (${path.basename(file)}).`);
    return;
  }

  const startedAt = Date.now();
  await createEmbeddedDatabase({ writeSnapshot: true });
  console.log(`Schema snapshot written to ${path.relative(process.cwd(), file)} in ${Date.now() - startedAt}ms.`);
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  const command = process.argv[2];

  switch (command) {
    case "snapshot":
      await snapshot();
      break;

    case "migrate": {
      const db = await connectPostgres(requireDatabaseUrl());
      await migrate(db);
      console.log("Migrations applied.");
      break;
    }

    case "seed": {
      const db = await connectPostgres(requireDatabaseUrl());
      await migrate(db);
      const seeded = await seedIfEmpty(db);
      console.log(seeded ? "Demo data loaded." : "Database already contains data; nothing to do.");
      break;
    }

    case "reset": {
      const db = await connectPostgres(requireDatabaseUrl());
      await db.execute(sql`DROP SCHEMA public CASCADE`);
      await db.execute(sql`CREATE SCHEMA public`);
      await migrate(db);
      await seedIfEmpty(db);
      console.log("Database reset and demo data reloaded.");
      break;
    }

    default:
      console.error("Usage: tsx scripts/db.ts <snapshot|migrate|seed|reset>");
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
