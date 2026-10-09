/** Runtime configuration, read lazily so builds never require secrets. */
export const env = {
  get databaseUrl(): string | undefined {
    return process.env.DATABASE_URL?.trim() || undefined;
  },
  /** Seeds demo data and enables one-click demo sign-in. On by default. */
  get demoMode(): boolean {
    return process.env.DEMO_MODE !== "false";
  },
  get autoMigrate(): boolean {
    return process.env.DB_AUTO_MIGRATE !== "false";
  },
  /** Opt-in for running production on the in-memory engine. Off by default. */
  get allowEmbeddedDatabase(): boolean {
    return process.env.ALLOW_EMBEDDED_DATABASE === "true";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  /** "embedded" when no DATABASE_URL is configured. */
  get persistence(): "postgres" | "embedded" {
    return this.databaseUrl ? "postgres" : "embedded";
  },
};
