import { createHash } from "node:crypto";

export type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
  checksum: string;
}>;

function migration(version: number, name: string, sql: string): Migration {
  return {
    version,
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}

export const migrations: readonly Migration[] = [
  migration(
    1,
    "foundation",
    `
      CREATE TABLE action_log (
        action_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        action_name TEXT NOT NULL,
        risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
        input_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        evidence_json TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;

      CREATE INDEX action_log_task_id_idx ON action_log(task_id, started_at);

      CREATE TABLE memories (
        memory_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE commitments (
        commitment_id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  ),
  migration(
    2,
    "model_usage",
    `
      CREATE TABLE model_usage (
        usage_id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        cached_input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX model_usage_occurred_at_idx ON model_usage(occurred_at);
    `,
  ),
];
