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

export type ModelTurn = Readonly<{
  taskId: string;
  objective: string;
  observations: readonly ActionObservation[];
  budget: Readonly<{
    remainingSteps: number;
    remainingCostUsd: number;
  }>;
}>;

export type ModelUsage = Readonly<{
  costUsd: number;
}>;

export type ModelResponse = Readonly<{
  decision: ModelDecision;
  usage: ModelUsage;
}>;

export type ModelGateway = {
  decide(turn: ModelTurn, signal: AbortSignal): Promise<ModelResponse>;
};
