import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { ActionJournal, ActionOutcome, Evidence } from "../actions/index.js";
import type { ProposedAction } from "../authority/index.js";
import type { Commitment, ExplicitMemoryStore, Memory } from "../memory/index.js";
import type { ModelUsageLedger, ModelUsageRecord } from "../models/index.js";
import type { JsonValue } from "../shared/index.js";
import { migrations } from "./migrations.js";

type AppliedMigrationRow = Readonly<{
  version: number;
  name: string;
  checksum: string;
}>;

type MemoryRow = Readonly<{
  memory_id: string;
  content: string;
  created_at: string;
}>;

type CommitmentRow = Readonly<{
  commitment_id: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}>;

type ModelUsageSumRow = Readonly<{ total: number }>;

function asRows<T>(statement: StatementSync): readonly T[] {
  return statement.all() as T[];
}
function encode(value: JsonValue | readonly Evidence[]): string {
  return JSON.stringify(value);
}

class SqliteActionJournal implements ActionJournal {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  async started(action: ProposedAction, startedAt: Date): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO action_log (
          action_id, task_id, capability_id, action_name, risk, input_json, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(
        action.id,
        action.taskId,
        action.capabilityId,
        action.actionName,
        action.risk,
        encode(action.input),
        startedAt.toISOString(),
      );
  }

  async finished(actionId: string, outcome: ActionOutcome): Promise<void> {
    const evidenceJson = outcome.status === "succeeded" ? encode(outcome.evidence) : null;
    const error = outcome.status === "failed" ? outcome.error : null;
    const result = this.#database
      .prepare(
        `UPDATE action_log
         SET status = ?, evidence_json = ?, error = ?, finished_at = ?
         WHERE action_id = ? AND status = 'running'`,
      )
      .run(outcome.status, evidenceJson, error, outcome.finishedAt.toISOString(), actionId);

    if (result.changes !== 1) {
      throw new Error(`La Acción ${actionId} no existe o ya terminó.`);
    }
  }
}

class SqliteExplicitMemoryStore implements ExplicitMemoryStore {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  async remember(memory: Memory): Promise<void> {
    this.#database
      .prepare("INSERT INTO memories (memory_id, content, created_at) VALUES (?, ?, ?)")
      .run(memory.id, memory.content, memory.createdAt.toISOString());
  }

  async listMemories(): Promise<readonly Memory[]> {
    return asRows<MemoryRow>(
      this.#database.prepare(
        "SELECT memory_id, content, created_at FROM memories ORDER BY created_at, memory_id",
      ),
    ).map((row) => ({
      id: row.memory_id,
      content: row.content,
      createdAt: new Date(row.created_at),
    }));
  }

  async addCommitment(commitment: Commitment): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO commitments (
          commitment_id, description, starts_at, ends_at, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        commitment.id,
        commitment.description,
        commitment.startsAt.toISOString(),
        commitment.endsAt?.toISOString() ?? null,
        commitment.createdAt.toISOString(),
      );
  }

  async listCommitments(): Promise<readonly Commitment[]> {
    return asRows<CommitmentRow>(
      this.#database.prepare(
        `SELECT commitment_id, description, starts_at, ends_at, created_at
         FROM commitments ORDER BY starts_at, commitment_id`,
      ),
    ).map((row) => ({
      id: row.commitment_id,
      description: row.description,
      startsAt: new Date(row.starts_at),
      ...(row.ends_at === null ? {} : { endsAt: new Date(row.ends_at) }),
      createdAt: new Date(row.created_at),
    }));
  }
}

class SqliteModelUsageLedger implements ModelUsageLedger {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  async record(entry: ModelUsageRecord): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO model_usage (
          task_id, model_id, input_tokens, cached_input_tokens, output_tokens, cost_usd,
          occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.taskId,
        entry.usage.modelId,
        entry.usage.inputTokens,
        entry.usage.cachedInputTokens,
        entry.usage.outputTokens,
        entry.usage.costUsd,
        entry.occurredAt.toISOString(),
      );
  }

  async spentInMonth(at: Date): Promise<number> {
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    const row = this.#database
      .prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total
         FROM model_usage
         WHERE occurred_at >= ? AND occurred_at < ?`,
      )
      .get(start.toISOString(), end.toISOString()) as ModelUsageSumRow;
    return row.total;
  }
}

export class SqlitePersistence {
  readonly #database: DatabaseSync;
  readonly actions: ActionJournal;
  readonly memory: ExplicitMemoryStore;
  readonly modelUsage: ModelUsageLedger;

  private constructor(database: DatabaseSync) {
    this.#database = database;
    this.actions = new SqliteActionJournal(database);
    this.memory = new SqliteExplicitMemoryStore(database);
    this.modelUsage = new SqliteModelUsageLedger(database);
  }

  static open(path: string): SqlitePersistence {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
    const persistence = new SqlitePersistence(database);
    persistence.#migrate();
    return persistence;
  }

  appliedMigrations(): readonly AppliedMigrationRow[] {
    return asRows<AppliedMigrationRow>(
      this.#database.prepare(
        "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
      ),
    );
  }

  close(): void {
    this.#database.close();
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);

    const applied = new Map(
      this.appliedMigrations().map((item) => [item.version, item] as const),
    );

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing !== undefined) {
        if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
          throw new Error(`La migración ${migration.version} fue modificada después de aplicarse.`);
        }
        continue;
      }

      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(migration.sql);
        this.#database
          .prepare(
            `INSERT INTO schema_migrations (version, name, checksum, applied_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(migration.version, migration.name, migration.checksum, new Date().toISOString());
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
  }
}
