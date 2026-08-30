import { describe, expect, it, vi } from "vitest";

import { InMemoryActionJournal } from "../src/actions/index.js";
import { SessionAuthority } from "../src/authority/index.js";
import {
  CapabilityRegistry,
  type CapabilityAdapter,
  type CapabilityResult,
} from "../src/capabilities/index.js";
import type { ModelGateway, ModelResponse } from "../src/models/index.js";
import { TaskAlreadyActiveError, TaskHarness } from "../src/tasks/index.js";

const limits = {
  maxSteps: 4,
  maxRetriesPerAction: 0,
  timeoutMs: 1_000,
  maxCostUsd: 1,
} as const;

function sequenceModel(responses: readonly ModelResponse[]): ModelGateway {
  let index = 0;
  return {
    async decide() {
      const response = responses[index];
      if (response === undefined) {
        throw new Error("No hay otra decisión preparada.");
      }
      index += 1;
      return response;
    },
  };
}

function testCapability(
  risk: "low" | "medium" | "high",
  execute: CapabilityAdapter["execute"],
): CapabilityAdapter {
  return {
    manifest: {
      id: "files",
      version: "1.0.0",
      description: "Capacidad falsa para pruebas",
      actions: [{ name: "inspect", description: "Inspecciona un archivo", risk }],
    },
    execute,
  };
}

function actionThenComplete(): readonly ModelResponse[] {
  return [
    {
      decision: {
        type: "propose_action",
        capabilityId: "files",
        actionName: "inspect",
        input: { path: "document.pdf" },
      },
      usage: { costUsd: 0.1 },
    },
    {
      decision: { type: "complete", summary: "Archivo inspeccionado." },
      usage: { costUsd: 0.1 },
    },
  ];
}

describe("TaskHarness", () => {
  it("ejecuta mediante contratos propios y exige Evidencia para completar", async () => {
    const authority = new SessionAuthority();
    const journal = new InMemoryActionJournal();
    const execute = vi.fn<CapabilityAdapter["execute"]>(async () => ({
      evidence: [
        {
          kind: "file_metadata",
          summary: "El archivo existe.",
          observedAt: new Date("2026-08-29T12:00:00.000Z"),
          data: { size: 42 },
        },
      ],
    }));
    const harness = new TaskHarness({
      model: sequenceModel(actionThenComplete()),
      authority,
      capabilities: new CapabilityRegistry([testCapability("low", execute)]),
      journal,
      limits,
      ids: { next: () => "action-1" },
    });

    const result = await harness.run({ id: "task-1", objective: "Inspecciona document.pdf" });

    expect(result.status).toBe("succeeded");
    expect(result.evidence).toHaveLength(1);
    expect(execute).toHaveBeenCalledOnce();
    expect(journal.list("task-1")[0]?.outcome?.status).toBe("succeeded");
  });

  it("detiene una Acción de riesgo medio sin Autorización", async () => {
    const execute = vi.fn<CapabilityAdapter["execute"]>();
    const harness = new TaskHarness({
      model: sequenceModel(actionThenComplete()),
      authority: new SessionAuthority(),
      capabilities: new CapabilityRegistry([testCapability("medium", execute)]),
      journal: new InMemoryActionJournal(),
      limits,
      ids: { next: () => "action-2" },
    });

    const result = await harness.run({ id: "task-2", objective: "Inspecciona document.pdf" });

    expect(result).toMatchObject({ status: "stopped", reason: "authorization_required" });
    expect(result).toHaveProperty("pendingAction.capabilityId", "files");
    expect(execute).not.toHaveBeenCalled();
  });

  it("detiene la Tarea cuando una Acción no produce Evidencia", async () => {
    const noEvidence = async (): Promise<CapabilityResult> => ({ evidence: [] });
    const repeatedAction = actionThenComplete()[0];
    if (repeatedAction === undefined) {
      throw new Error("La prueba requiere una Acción preparada.");
    }
    const harness = new TaskHarness({
      model: sequenceModel([repeatedAction, repeatedAction]),
      authority: new SessionAuthority(),
      capabilities: new CapabilityRegistry([testCapability("low", noEvidence)]),
      journal: new InMemoryActionJournal(),
      limits,
    });

    const result = await harness.run({ id: "task-3", objective: "Inspecciona document.pdf" });

    expect(result).toMatchObject({ status: "stopped", reason: "retry_limit" });
  });

  it("impide dos Tareas activas", async () => {
    let release: (() => void) | undefined;
    const blockedModel: ModelGateway = {
      async decide() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { decision: { type: "complete", summary: "Sin Evidencia" }, usage: { costUsd: 0 } };
      },
    };
    const harness = new TaskHarness({
      model: blockedModel,
      authority: new SessionAuthority(),
      capabilities: new CapabilityRegistry(),
      journal: new InMemoryActionJournal(),
      limits,
    });

    const first = harness.run({ id: "task-4", objective: "Primera" });
    await expect(harness.run({ id: "task-5", objective: "Segunda" })).rejects.toBeInstanceOf(
      TaskAlreadyActiveError,
    );
    release?.();
    await first;
  });
});
