import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

let dbCache: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (dbCache) {
    return dbCache;
  }

  const env = getEnv();
  const connection = postgres(env.DATABASE_URL, { max: 5 });
  dbCache = drizzle(connection, { schema });
  return dbCache;
}
