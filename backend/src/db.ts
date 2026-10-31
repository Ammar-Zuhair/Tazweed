import pg from "pg";
export type Db = pg.Pool | pg.PoolClient;
export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 12,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 15000,
    application_name: "tazweed-phase05",
  });
  pool.on("error", () => {
    /* Request health reports unavailable; never log connection strings. */
  });
  return pool;
}
export async function transaction<T>(
  pool: pg.Pool,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function phoneLock(db: Db, phone: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,105))", [
    phone,
  ]);
}
