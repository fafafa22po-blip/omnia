import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLocalConfig } from "../src/config/index.js";

describe("loadLocalConfig", () => {
  it("produce configuración local sin incorporar secretos del entorno", () => {
    const config = loadLocalConfig(
      {
        OMNIA_DATA_DIR: "private-data",
        OMNIA_MAX_STEPS: "8",
        OPENAI_API_KEY: "no-debe-aparecer",
      },
      "C:\\omnia",
    );

    expect(config).toEqual({
      databasePath: resolve("C:\\omnia", "private-data", "omnia.sqlite"),
      taskLimits: {
        maxSteps: 8,
        maxRetriesPerAction: 1,
        timeoutMs: 120_000,
        maxCostUsd: 0.25,
        maxMonthlyCostUsd: 10,
      },
    });
    expect(JSON.stringify(config)).not.toContain("no-debe-aparecer");
  });

  it("rechaza límites inválidos", () => {
    expect(() => loadLocalConfig({ OMNIA_MAX_STEPS: "0" })).toThrow(
      "OMNIA_MAX_STEPS debe ser un entero positivo.",
    );
  });
});
