import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";

import type { SecretStore } from "../secrets/index.js";
import type { JsonValue } from "../shared/index.js";
import {
  calculateModelCost,
  ModelGatewayError,
  selectModel,
  type ModelDecision,
  type ModelGateway,
  type ModelResponse,
  type ModelStreamObserver,
  type ModelTurn,
  type ModelUsage,
} from "./index.js";

const DEFAULT_CREDENTIAL_NAME = "omnia/openai-api-key";

type OpenAIModelAdapterOptions = Readonly<{
  secrets: SecretStore;
  credentialName?: string;
  fetch?: typeof globalThis.fetch;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

function parseDecision(response: Response): ModelDecision {
  const call = response.output.find((item) => item.type === "function_call");
  if (call === undefined) {
    throw new ModelGatewayError(
      "invalid_response",
      "El modelo no devolvió una decisión mediante una herramienta.",
      false,
    );
  }

  let argumentsValue: unknown;
  try {
    argumentsValue = JSON.parse(call.arguments) as unknown;
  } catch {
    throw new ModelGatewayError(
      "invalid_response",
      "El modelo devolvió argumentos que no son JSON válido.",
      false,
    );
  }
  if (!isRecord(argumentsValue)) {
    throw new ModelGatewayError("invalid_response", "La decisión no es un objeto.", false);
  }

  if (call.name === "complete") {
    if (typeof argumentsValue.summary !== "string" || argumentsValue.summary.length === 0) {
      throw new ModelGatewayError(
        "invalid_response",
        "La finalización del modelo no contiene un resumen.",
        false,
      );
    }
    return { type: "complete", summary: argumentsValue.summary };
  }

  if (call.name === "propose_action") {
    const { capabilityId, actionName, input } = argumentsValue;
    if (
      typeof capabilityId !== "string" ||
      typeof actionName !== "string" ||
      !isJsonValue(input)
    ) {
      throw new ModelGatewayError(
        "invalid_response",
        "La Acción propuesta por el modelo tiene argumentos inválidos.",
        false,
      );
    }
    return { type: "propose_action", capabilityId, actionName, input };
  }

  throw new ModelGatewayError(
    "invalid_response",
    `El modelo solicitó una herramienta desconocida: ${call.name}.`,
    false,
  );
}

function parseUsage(response: Response, turn: ModelTurn): ModelUsage {
  const usage = response.usage;
  if (usage === undefined) {
    throw new ModelGatewayError(
      "invalid_response",
      "OpenAI no informó el consumo de la generación.",
      false,
    );
  }
  const tokenUsage = {
    modelId: response.model,
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    outputTokens: usage.output_tokens,
  };
  return {
    ...tokenUsage,
    costUsd: calculateModelCost(selectModel(turn.modelTier), tokenUsage),
  };
}

function requestFor(turn: ModelTurn): ResponseCreateParamsNonStreaming {
  return {
    model: selectModel(turn.modelTier).id,
    store: false,
    parallel_tool_calls: false,
    reasoning: { effort: "medium" },
    instructions:
      "Eres el planificador de Omnia. Elige exactamente una herramienta. " +
      "No declares éxito sin observaciones con Evidencia.",
    input: [
      {
        role: "user",
        content: turn.inputs.map((input) =>
          input.type === "text"
            ? { type: "input_text" as const, text: input.text }
            : {
                type: "input_image" as const,
                image_url: input.url,
                detail: input.detail,
              },
        ),
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              objective: turn.objective,
              availableActions: turn.availableActions,
              observations: turn.observations,
              budget: turn.budget,
            }),
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        name: "propose_action",
        description: "Propone la siguiente Acción de una Capacidad disponible.",
        strict: false,
        parameters: {
          type: "object",
          properties: {
            capabilityId: { type: "string" },
            actionName: { type: "string" },
            input: { type: "object", additionalProperties: true },
          },
          required: ["capabilityId", "actionName", "input"],
          additionalProperties: false,
        },
      },
      {
        type: "function",
        name: "complete",
        description: "Finaliza la Tarea cuando existe Evidencia suficiente.",
        strict: true,
        parameters: {
          type: "object",
          properties: { summary: { type: "string" } },
          required: ["summary"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: "required",
  };
}

function normalizeError(error: unknown): ModelGatewayError {
  if (error instanceof ModelGatewayError) {
    return error;
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new ModelGatewayError("authentication", "OpenAI rechazó la credencial.", false);
  }
  if (error instanceof OpenAI.BadRequestError) {
    return new ModelGatewayError("invalid_request", "OpenAI rechazó la solicitud.", false);
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new ModelGatewayError("rate_limit", "OpenAI limitó temporalmente las solicitudes.", true);
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new ModelGatewayError("timeout", "OpenAI excedió el tiempo de espera.", true);
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return new ModelGatewayError("aborted", "La generación fue cancelada.", false);
  }
  if (error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) {
    return new ModelGatewayError("unavailable", "OpenAI no está disponible.", true);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelGatewayError("aborted", "La generación fue cancelada.", false);
  }
  return new ModelGatewayError("unknown", "Falló la generación del modelo.", false);
}

export class OpenAIModelAdapter implements ModelGateway {
  readonly #secrets: SecretStore;
  readonly #credentialName: string;
  readonly #fetch: typeof globalThis.fetch | undefined;

  constructor(options: OpenAIModelAdapterOptions) {
    this.#secrets = options.secrets;
    this.#credentialName = options.credentialName ?? DEFAULT_CREDENTIAL_NAME;
    this.#fetch = options.fetch;
  }

  async decide(
    turn: ModelTurn,
    signal: AbortSignal,
    observe?: ModelStreamObserver,
  ): Promise<ModelResponse> {
    try {
      const apiKey = await this.#secrets.get(this.#credentialName);
      if (apiKey === undefined || apiKey.length === 0) {
        throw new ModelGatewayError(
          "authentication",
          "No existe una credencial de OpenAI en el almacén seguro.",
          false,
        );
      }
      const client = new OpenAI({
        apiKey,
        maxRetries: 0,
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      });
      if (observe !== undefined) {
        const streamRequest: ResponseCreateParamsStreaming = {
          ...requestFor(turn),
          stream: true,
        };
        const stream = await client.responses.create(streamRequest, { signal });
        let completedResponse: Response | undefined;
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            observe({ type: "text_delta", delta: event.delta });
          } else if (event.type === "response.completed") {
            completedResponse = event.response;
          } else if (event.type === "response.failed") {
            throw new ModelGatewayError(
              "invalid_response",
              "OpenAI no pudo completar la generación.",
              false,
            );
          }
        }
        if (completedResponse === undefined) {
          throw new ModelGatewayError(
            "invalid_response",
            "El stream de OpenAI terminó sin una respuesta completa.",
            false,
          );
        }
        const result = {
          decision: parseDecision(completedResponse),
          usage: parseUsage(completedResponse, turn),
        };
        observe({ type: "decision", decision: result.decision });
        observe({ type: "usage", usage: result.usage });
        return result;
      }

      const response = await client.responses.create(requestFor(turn), { signal });
      const result = { decision: parseDecision(response), usage: parseUsage(response, turn) };
      return result;
    } catch (error) {
      throw normalizeError(error);
    }
  }
}
