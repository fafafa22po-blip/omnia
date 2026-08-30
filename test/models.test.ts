import { describe, expect, it } from "vitest";

import {
  calculateModelCost,
  FakeModelAdapter,
  modelCatalog,
  ModelGatewayError,
  selectModel,
  type ModelStreamEvent,
  type ModelTurn,
  type ModelUsage,
} from "../src/models/index.js";

const turn: ModelTurn = {
  taskId: "task-vision",
  objective: "Describe la captura y decide la siguiente Acción.",
  inputs: [
    { type: "text", text: "La aplicación muestra un error." },
    { type: "image", url: "data:image/png;base64,aW1hZ2U=", detail: "low" },
  ],
  availableActions: [
    {
      capabilityId: "files",
      actionName: "inspect",
      description: "Inspecciona un archivo",
    },
  ],
  observations: [],
  modelTier: "usual",
  budget: { remainingSteps: 3, remainingCostUsd: 0.2, remainingMonthlyCostUsd: 9.5 },
};

describe("catálogo de modelos", () => {
  it("selecciona explícitamente el modelo habitual y el de escalamiento", () => {
    expect(selectModel("usual")).toMatchObject({
      provider: "openai",
      id: "gpt-5.6-terra",
      capabilities: {
        text: true,
        vision: true,
        streaming: true,
        toolCalling: true,
      },
    });
    expect(selectModel("escalated")).toMatchObject({
      provider: "openai",
      id: "gpt-5.6-sol",
    });
    expect(modelCatalog).toHaveLength(2);
  });

  it("calcula el costo desde el uso informado sin tipos del proveedor", () => {
    const usage: Omit<ModelUsage, "costUsd"> = {
      modelId: "gpt-5.6-terra",
      inputTokens: 100_000,
      cachedInputTokens: 10_000,
      outputTokens: 100_000,
    };

    expect(calculateModelCost(selectModel("usual"), usage)).toBeCloseTo(1.382);
  });

  it("aplica la tarifa de contexto largo por encima de 272 mil tokens", () => {
    expect(
      calculateModelCost(selectModel("usual"), {
        modelId: "gpt-5.6-terra",
        inputTokens: 300_000,
        cachedInputTokens: 0,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(3);
  });
});

describe("FakeModelAdapter", () => {
  it("ejercita visión, streaming y llamadas de herramientas mediante el seam propio", async () => {
    const response = {
      decision: {
        type: "propose_action" as const,
        capabilityId: "files",
        actionName: "inspect",
        input: { path: "error.log" },
      },
      usage: {
        modelId: "fake-model",
        inputTokens: 25,
        cachedInputTokens: 5,
        outputTokens: 10,
        costUsd: 0.001,
      },
    };
    const streamed: ModelStreamEvent[] = [
      { type: "text_delta", delta: "Revisando" },
      { type: "decision", decision: response.decision },
      { type: "usage", usage: response.usage },
    ];
    const adapter = new FakeModelAdapter([{ response, events: streamed }]);
    const observed: ModelStreamEvent[] = [];

    await expect(
      adapter.decide(turn, new AbortController().signal, (event) => observed.push(event)),
    ).resolves.toEqual(response);
    expect(adapter.turns).toEqual([turn]);
    expect(observed).toEqual(streamed);
  });

  it("expone errores normalizados sin detalles internos del proveedor", async () => {
    const adapter = new FakeModelAdapter([
      { error: new ModelGatewayError("rate_limit", "Demasiadas solicitudes.", true) },
    ]);

    await expect(adapter.decide(turn, new AbortController().signal)).rejects.toMatchObject({
      name: "ModelGatewayError",
      code: "rate_limit",
      retryable: true,
    });
  });
});
