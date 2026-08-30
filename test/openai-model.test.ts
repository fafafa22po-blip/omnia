import { describe, expect, it, vi } from "vitest";

import {
  OpenAIModelAdapter,
  type ModelTurn,
  type SecretStore,
} from "../src/index.js";

const turn: ModelTurn = {
  taskId: "task-openai",
  objective: "Inspecciona el error visible.",
  inputs: [
    { type: "text", text: "Inspecciona el error visible." },
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
  budget: { remainingSteps: 3, remainingCostUsd: 0.25, remainingMonthlyCostUsd: 10 },
};

function completedResponse(): Record<string, unknown> {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1_788_088_800,
    status: "completed",
    completed_at: 1_788_088_801,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: "gpt-5.6-terra",
    output: [
      {
        type: "function_call",
        id: "fc_test",
        call_id: "call_test",
        name: "propose_action",
        arguments:
          '{"capabilityId":"files","actionName":"inspect","input":{"path":"error.log"}}',
      },
    ],
    parallel_tool_calls: false,
    previous_response_id: null,
    reasoning: { effort: "medium", summary: null },
    store: false,
    temperature: 1,
    text: { format: { type: "text" } },
    tool_choice: "required",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 150,
    },
  };
}

describe("OpenAIModelAdapter", () => {
  it("traduce visión, herramientas y uso mediante el seam de Omnia", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const providerFetch: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBody = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      expect(request.headers.get("authorization")).toBe("Bearer test-secret");
      return new Response(JSON.stringify(completedResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const getSecret = vi.fn(async () => "test-secret");
    const secrets: SecretStore = { get: getSecret };
    const adapter = new OpenAIModelAdapter({ secrets, fetch: providerFetch });

    const response = await adapter.decide(turn, new AbortController().signal);

    expect(response).toEqual({
      decision: {
        type: "propose_action",
        capabilityId: "files",
        actionName: "inspect",
        input: { path: "error.log" },
      },
      usage: {
        modelId: "gpt-5.6-terra",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        costUsd: 0.000764,
      },
    });
    expect(getSecret).toHaveBeenCalledWith("omnia/openai-api-key");
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      parallel_tool_calls: false,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Inspecciona el error visible." },
            {
              type: "input_image",
              image_url: "data:image/png;base64,aW1hZ2U=",
              detail: "low",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                objective: "Inspecciona el error visible.",
                availableActions: [
                  {
                    capabilityId: "files",
                    actionName: "inspect",
                    description: "Inspecciona un archivo",
                  },
                ],
                observations: [],
                budget: {
                  remainingSteps: 3,
                  remainingCostUsd: 0.25,
                  remainingMonthlyCostUsd: 10,
                },
              }),
            },
          ],
        },
      ],
    });
    const serializedRequest = JSON.stringify(requestBody);
    expect(serializedRequest).toContain('"name":"propose_action"');
    expect(serializedRequest).toContain('"name":"complete"');
    expect(serializedRequest).not.toContain("test-secret");
  });

  it("publica deltas de texto y conserva la respuesta final al usar streaming", async () => {
    const providerFetch: typeof globalThis.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      const textDelta = {
        type: "response.output_text.delta",
        sequence_number: 0,
        item_id: "msg_test",
        output_index: 0,
        content_index: 0,
        delta: "Analizando",
        logprobs: [],
      };
      const completed = {
        type: "response.completed",
        sequence_number: 1,
        response: completedResponse(),
      };
      return new Response(
        `event: response.output_text.delta\ndata: ${JSON.stringify(textDelta)}\n\n` +
          `event: response.completed\ndata: ${JSON.stringify(completed)}\n\n` +
          "data: [DONE]\n\n",
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
    const adapter = new OpenAIModelAdapter({
      secrets: { get: async () => "test-secret" },
      fetch: providerFetch,
    });
    const events: unknown[] = [];

    const response = await adapter.decide(
      turn,
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(response.decision).toMatchObject({ type: "propose_action" });
    expect(events).toEqual([
      { type: "text_delta", delta: "Analizando" },
      { type: "decision", decision: response.decision },
      { type: "usage", usage: response.usage },
    ]);
  });

  it("rechaza una ejecución sin credencial antes de contactar al proveedor", async () => {
    const providerFetch = vi.fn<typeof globalThis.fetch>();
    const adapter = new OpenAIModelAdapter({
      secrets: { get: async () => undefined },
      fetch: providerFetch,
    });

    await expect(adapter.decide(turn, new AbortController().signal)).rejects.toMatchObject({
      name: "ModelGatewayError",
      code: "authentication",
      retryable: false,
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("normaliza los límites temporales del proveedor como errores reintentables", async () => {
    const adapter = new OpenAIModelAdapter({
      secrets: { get: async () => "test-secret" },
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { message: "Rate limit", type: "rate_limit", code: "rate_limit" },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(adapter.decide(turn, new AbortController().signal)).rejects.toMatchObject({
      name: "ModelGatewayError",
      code: "rate_limit",
      retryable: true,
    });
  });
});
