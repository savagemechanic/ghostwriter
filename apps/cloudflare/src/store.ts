export class D1Store {
  constructor(private db: D1Database) {}
  async read<T>(key: string, fallback: T | null = null): Promise<T | null> {
    const row = await this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    return row ? (JSON.parse(row.value) as T) : fallback;
  }
  async write<T>(key: string, value: T): Promise<T> {
    await this.db
      .prepare(
        "INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP",
      )
      .bind(key, JSON.stringify(value))
      .run();
    return value;
  }
  async update<T>(
    key: string,
    fallback: T,
    mutate: (value: T) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await this.db
        .prepare("SELECT value FROM kv WHERE key=?")
        .bind(key)
        .first<{ value: string }>();
      const next = mutate(
        row ? JSON.parse(row.value) : structuredClone(fallback),
      );
      const result = row
        ? await this.db
            .prepare(
              "UPDATE kv SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key=? AND value=?",
            )
            .bind(JSON.stringify(next), key, row.value)
            .run()
        : await this.db
            .prepare("INSERT OR IGNORE INTO kv(key,value) VALUES(?,?)")
            .bind(key, JSON.stringify(next))
            .run();
      if (result.meta.changes === 1) return next;
    }
    throw new Error("State changed concurrently; retry the operation");
  }
  async claimPublish(draftId: string) {
    const result = await this.db
      .prepare(
        `UPDATE kv SET value=json_set(value,'$.status','publishing','$.publishingStartedAt',?) WHERE key=? AND json_extract(value,'$.status')='draft'`,
      )
      .bind(new Date().toISOString(), `draft-${draftId}`)
      .run();
    return result.meta.changes === 1;
  }
}
