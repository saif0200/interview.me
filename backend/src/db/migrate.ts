import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const distPath = join(__dirname, "schema.sql");
  const srcPath = join(__dirname, "../../src/db/schema.sql");
  const schema = readFileSync(existsSync(distPath) ? distPath : srcPath, "utf-8");
  await pool.query(schema);
  console.log("Database migrations applied successfully");
}
