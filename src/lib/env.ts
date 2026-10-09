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
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  /** "embedded" when no DATABASE_URL is configured. */
  get persistence(): "postgres" | "embedded" {
    return this.databaseUrl ? "postgres" : "embedded";
  },
};
