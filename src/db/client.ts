import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { env } from "@/lib/env";
import { migrations } from "./migrations";
import * as schema from "./schema";

/**
 * One database type for both engines. The embedded engine (PGlite) is real
 * PostgreSQL compiled to WebAssembly, so the same SQL, constraints, triggers
 * and transactions run unchanged against a managed PostgreSQL instance.
 */
export type Database = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

/** Normalises raw `execute` results, whose shape differs between drivers. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}

const MIGRATION_LOCK = 7_274_001;
const SEED_LOCK = 7_274_002;

export async function migrate(db: Database): Promise<void> {
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`,
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`));
    const applied = new Set(
      rowsOf<{ id: string }>(
        await tx.execute(sql`SELECT id FROM schema_migrations`),
      ).map((row) => row.id),
    );

    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`INSERT INTO schema_migrations (id) VALUES (${migration.id})`,
      );
    }
  });
}

/** Seeds demo data exactly once, even if several instances boot together. */
export async function seedIfEmpty(db: Database): Promise<boolean> {
  const { seedDatabase } = await import("./seed");
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SELECT pg_advisory_xact_lock(${SEED_LOCK})`));
    const [existing] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .limit(1);
    if (existing) return false;
    await seedDatabase(tx);
    return true;
  });
}

/**
 * Schema snapshot for the embedded engine.
 *
 * Initialising a PostgreSQL data directory and applying migrations takes a few
 * seconds in WebAssembly — too slow for a serverless cold start. The build
 * therefore boots the engine once, migrates it and stores the resulting data
 * directory (`npm run db:snapshot`). At runtime the snapshot is restored in
 * about a second. The file name carries a fingerprint of the migrations, so a
 * stale snapshot is never used; if none is found the engine falls back to a
 * full initialisation.
 */
const SNAPSHOT_DIR = ".data";

export function snapshotFile(): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(migrations))
    .digest("hex")
    .slice(0, 16);
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    SNAPSHOT_DIR,
    `schema-${fingerprint}.tar.gz`,
  );
}

async function readSnapshot(): Promise<Blob | null> {
  try {
    const bytes = await readFile(snapshotFile());
    return new Blob([new Uint8Array(bytes)]);
  } catch {
    return null;
  }
}

/** A fresh, migrated in-memory PostgreSQL database. */
export async function createEmbeddedDatabase(
  options: { writeSnapshot?: boolean } = {},
): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");

  const snapshot = await readSnapshot();
  if (snapshot) {
    try {
      const client = new PGlite({ loadDataDir: snapshot });
      await client.waitReady;
      const db = drizzle(client, { schema });
      // Proves the snapshot is usable and applies anything it predates.
      await migrate(db);
      return db;
    } catch (error) {
      console.warn("[aldera] schema snapshot could not be restored; initialising", error);
    }
  }

  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db);

  if (options.writeSnapshot) {
    const file = snapshotFile();
    const dump = await client.dumpDataDir("gzip");
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, Buffer.from(await dump.arrayBuffer()));
    await rename(temporary, file);
  }
  return db;
}

export async function connectPostgres(url: string): Promise<Database> {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Compatible with transaction-mode connection poolers (PgBouncer, Neon).
    prepare: false,
    onnotice: () => {},
  });
  return drizzle(client, { schema }) as unknown as Database;
}

async function connect(): Promise<Database> {
  const startedAt = Date.now();
  const url = env.databaseUrl;

  if (url) {
    const db = await connectPostgres(url);
    if (env.autoMigrate) {
      await migrate(db);
      if (env.demoMode) await seedIfEmpty(db);
    }
    console.info(`[aldera] connected to PostgreSQL in ${Date.now() - startedAt}ms`);
    return db;
  }

  const db = await createEmbeddedDatabase();
  if (env.demoMode) await seedIfEmpty(db);
  console.info(
    `[aldera] embedded PostgreSQL ready in ${Date.now() - startedAt}ms` +
      (env.demoMode ? " (demo data seeded)" : ""),
  );
  return db;
}

const store = globalThis as typeof globalThis & {
  __alderaDatabase?: Promise<Database>;
};

/**
 * Returns the process-wide database handle, connecting (and, for the embedded
 * engine, migrating and seeding) on first use.
 */
export function getDb(): Promise<Database> {
  if (!store.__alderaDatabase) {
    store.__alderaDatabase = connect().catch((error) => {
      store.__alderaDatabase = undefined;
      throw error;
    });
  }
  return store.__alderaDatabase;
}
