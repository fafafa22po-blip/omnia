import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SqlitePersistence } from "../src/persistence/index.js";

describe("SqlitePersistence", () => {
  it("aplica migraciones versionadas de forma idempotente", () => {
    const directory = mkdtempSync(join(tmpdir(), "omnia-sqlite-"));
    const path = join(directory, "omnia.sqlite");

    const first = SqlitePersistence.open(path);
    expect(first.appliedMigrations()).toMatchObject([{ version: 1, name: "foundation" }]);
    first.close();

    const second = SqlitePersistence.open(path);
    expect(second.appliedMigrations()).toHaveLength(1);
    second.close();
  });

  it("conserva únicamente Recuerdos y Compromisos explícitos", async () => {
    const persistence = SqlitePersistence.open(":memory:");
    await persistence.memory.remember({
      id: "memory-1",
      content: "El Propietario prefiere respuestas breves.",
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
    });
    await persistence.memory.addCommitment({
      id: "commitment-1",
      description: "Examen final",
      startsAt: new Date("2026-09-03T15:00:00.000Z"),
      createdAt: new Date("2026-08-29T12:01:00.000Z"),
    });

    await expect(persistence.memory.listMemories()).resolves.toMatchObject([
      { id: "memory-1", content: "El Propietario prefiere respuestas breves." },
    ]);
    await expect(persistence.memory.listCommitments()).resolves.toMatchObject([
      { id: "commitment-1", description: "Examen final" },
    ]);
    persistence.close();
  });
});
