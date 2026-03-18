import pg from "pg";
import { env } from "./env.js";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function createPoolConfig(): pg.PoolConfig {
  const databaseUrl = new URL(env.DATABASE_URL);
  const sslMode = databaseUrl.searchParams.get("sslmode");
  const isLocalDatabase = LOCAL_DATABASE_HOSTS.has(databaseUrl.hostname);

  return {
    host: databaseUrl.hostname,
    port: databaseUrl.port ? Number.parseInt(databaseUrl.port, 10) : 5432,
    database: decodeURIComponent(databaseUrl.pathname.slice(1)),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    ssl:
      sslMode === "disable" || isLocalDatabase
        ? undefined
        : { rejectUnauthorized: false },
  };
}

export const pool = new pg.Pool(createPoolConfig());
