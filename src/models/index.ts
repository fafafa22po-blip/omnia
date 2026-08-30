import type { Evidence } from "../actions/index.js";
import type { JsonValue } from "../shared/index.js";

export type ActionObservation = Readonly<{
  capabilityId: string;
  actionName: string;
  status: "succeeded" | "failed";
  evidence: readonly Evidence[];
  error?: string;
}>;

export type ModelDecision =
  | Readonly<{
      type: "propose_action";
      capabilityId: string;
      actionName: string;
      input: JsonValue;
    }>
  | Readonly<{
      type: "complete";
      summary: string;
    }>;

export type ModelInput =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{
      type: "image";
      url: string;
      detail: "low" | "high" | "auto";
    }>;

export type AvailableModelAction = Readonly<{
  capabilityId: string;
  actionName: string;
  description: string;
}>;

export type ModelTurn = Readonly<{
  taskId: string;
  objective: string;
  inputs: readonly ModelInput[];
  availableActions: readonly AvailableModelAction[];
  observations: readonly ActionObservation[];
  modelTier: ModelTier;
  budget: Readonly<{
    remainingSteps: number;
    remainingCostUsd: number;
    remainingMonthlyCostUsd: number;
  }>;
}>;

export type ModelUsage = Readonly<{
  modelId: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}>;

export type ModelUsageRecord = Readonly<{
  taskId: string;
  usage: ModelUsage;
  occurredAt: Date;
}>;

export type ModelUsageLedger = {
  record(entry: ModelUsageRecord): Promise<void>;
  spentInMonth(at: Date): Promise<number>;
};

function sameUtcMonth(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

export class InMemoryModelUsageLedger implements ModelUsageLedger {
  readonly #entries: ModelUsageRecord[] = [];

  record(entry: ModelUsageRecord): Promise<void> {
    this.#entries.push(entry);
    return Promise.resolve();
  }

  spentInMonth(at: Date): Promise<number> {
    return Promise.resolve(
      this.#entries
        .filter((entry) => sameUtcMonth(entry.occurredAt, at))
        .reduce((total, entry) => total + entry.usage.costUsd, 0),
    );
  }
}

export type ModelTier = "usual" | "escalated";

export type ModelProfile = Readonly<{
  provider: string;
  id: string;
  capabilities: Readonly<{
    text: boolean;
    vision: boolean;
    streaming: boolean;
    toolCalling: boolean;
  }>;
  pricingUsdPerMillionTokens: Readonly<{
    input: number;
    cachedInput: number;
    output: number;
  }>;
}>;

const usualModel: ModelProfile = {
  provider: "openai",
  id: "gpt-5.6-terra",
  capabilities: { text: true, vision: true, streaming: true, toolCalling: true },
  pricingUsdPerMillionTokens: { input: 2, cachedInput: 0.2, output: 12 },
};

const escalatedModel: ModelProfile = {
  provider: "openai",
  id: "gpt-5.6-sol",
  capabilities: { text: true, vision: true, streaming: true, toolCalling: true },
  pricingUsdPerMillionTokens: { input: 4, cachedInput: 0.4, output: 20 },
};

export const modelCatalog: readonly ModelProfile[] = [usualModel, escalatedModel];

const modelByTier: Readonly<Record<ModelTier, ModelProfile>> = {
  usual: usualModel,
  escalated: escalatedModel,
};

export function selectModel(tier: ModelTier): ModelProfile {
  return modelByTier[tier];
}

export function calculateModelCost(
  profile: ModelProfile,
  usage: Omit<ModelUsage, "costUsd">,
): number {
  if (usage.cachedInputTokens > usage.inputTokens) {
    throw new Error("Los tokens de entrada en caché superan el total de entrada.");
  }
  const uncachedInputTokens = usage.inputTokens - usage.cachedInputTokens;
  const usesLongContextPricing = usage.inputTokens > 272_000;
  const inputMultiplier = usesLongContextPricing ? 2 : 1;
  const outputMultiplier = usesLongContextPricing ? 1.5 : 1;
  return (
    (uncachedInputTokens * profile.pricingUsdPerMillionTokens.input * inputMultiplier +
      usage.cachedInputTokens *
        profile.pricingUsdPerMillionTokens.cachedInput *
        inputMultiplier +
      usage.outputTokens * profile.pricingUsdPerMillionTokens.output * outputMultiplier) /
    1_000_000
  );
}

export type ModelResponse = Readonly<{
  decision: ModelDecision;
  usage: ModelUsage;
}>;

export type ModelStreamEvent =
  | Readonly<{ type: "text_delta"; delta: string }>
  | Readonly<{ type: "decision"; decision: ModelDecision }>
  | Readonly<{ type: "usage"; usage: ModelUsage }>;

export type ModelStreamObserver = (event: ModelStreamEvent) => void;

export type ModelGatewayErrorCode =
  | "aborted"
  | "authentication"
  | "invalid_request"
  | "invalid_response"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "unknown";

export class ModelGatewayError extends Error {
  readonly code: ModelGatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: ModelGatewayErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "ModelGatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ModelGateway = {
  decide(
    turn: ModelTurn,
    signal: AbortSignal,
    observe?: ModelStreamObserver,
  ): Promise<ModelResponse>;
};

export type FakeModelExchange =
  | Readonly<{ response: ModelResponse; events?: readonly ModelStreamEvent[] }>
  | Readonly<{ error: ModelGatewayError }>;

export class FakeModelAdapter implements ModelGateway {
  readonly #exchanges: readonly FakeModelExchange[];
  readonly #turns: ModelTurn[] = [];
  #index = 0;

  constructor(exchanges: readonly FakeModelExchange[]) {
    this.#exchanges = exchanges;
  }

  get turns(): readonly ModelTurn[] {
    return this.#turns;
  }

  async decide(
    turn: ModelTurn,
    signal: AbortSignal,
    observe?: ModelStreamObserver,
  ): Promise<ModelResponse> {
    if (signal.aborted) {
      throw new ModelGatewayError("aborted", "La generación fue cancelada.", false);
    }
    const exchange = this.#exchanges[this.#index];
    if (exchange === undefined) {
      throw new ModelGatewayError("invalid_response", "No hay otra respuesta preparada.", false);
    }
    this.#index += 1;
    this.#turns.push(turn);
    if ("error" in exchange) {
      throw exchange.error;
    }
    for (const event of exchange.events ?? []) {
      observe?.(event);
    }
    return exchange.response;
  }
}
