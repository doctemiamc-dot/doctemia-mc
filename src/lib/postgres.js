import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Falta DATABASE_URL en las variables de entorno.');
}

const globalForPg = globalThis;

/**
 * Pool de conexiones PostgreSQL (usando el pooler de Supabase).
 * Usar EXCLUSIVAMENTE en código de servidor (Route Handlers / Server Components).
 */
export const pgPool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.__pgPool = pgPool;
}
