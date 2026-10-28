import { PrismaClient } from "@prisma/client";

const DEFAULT_CONNECTION_LIMIT = 5;

// Supabase's session pooler allows 15 clients in total (staging, prod and migrations share it).
// Prisma's default pool is 2 * CPUs + 1 per client, so one shared client with a small cap is used.
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || /[?&]connection_limit=/.test(raw)) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}connection_limit=${DEFAULT_CONNECTION_LIMIT}`;
}

const url = datasourceUrl();

export const prisma = url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
