import type { ActionJournal, Evidence } from "../actions/index.js";
import type { AuthorityDenialReason, AuthorityGate, ProposedAction } from "../authority/index.js";
import { CapabilityRegistry } from "../capabilities/index.js";
import type { TaskLimits } from "../config/index.js";
import type { ActionObservation, ModelGateway, ModelResponse } from "../models/index.js";
import {
  errorMessage,
  randomIdGenerator,
  systemClock,
  type Clock,
  type IdGenerator,
  type JsonValue,
} from "../shared/index.js";

export type TaskRequest = Readonly<{
  id: string;
  objective: string;
}>;

export type TaskStopReason =
  | AuthorityDenialReason
  | "cost_limit"
  | "missing_evidence"
  | "retry_limit"
  | "step_limit"
  | "time_limit";

export type TaskResult =
  | Readonly<{
      status: "succeeded";
      taskId: string;
      summary: string;
      evidence: readonly Evidence[];
      steps: number;
      costUsd: number;
    }>
  | Readonly<{
      status: "stopped";
      taskId: string;
      reason: TaskStopReason;
      pendingAction?: ProposedAction;
      evidence: readonly Evidence[];
      steps: number;
      costUsd: number;
    }>
  | Readonly<{
      status: "failed";
      taskId: string;
      error: string;
      evidence: readonly Evidence[];
      steps: number;
      costUsd: number;
    }>;

export class TaskAlreadyActiveError extends Error {
  constructor() {
    super("Omnia ya tiene una Tarea activa.");
    this.name = "TaskAlreadyActiveError";
  }
}

type TaskHarnessDependencies = Readonly<{
  model: ModelGateway;
  authority: AuthorityGate;
  capabilities: CapabilityRegistry;
  journal: ActionJournal;
  limits: TaskLimits;
  clock?: Clock;
  ids?: IdGenerator;
}>;

class DeadlineExceededError extends Error {}

function actionKey(capabilityId: string, actionName: string, input: JsonValue): string {
  return `${capabilityId}:${actionName}:${JSON.stringify(input)}`;
}

export class TaskHarness {
  readonly #model: ModelGateway;
  readonly #authority: AuthorityGate;
  readonly #capabilities: CapabilityRegistry;
  readonly #journal: ActionJournal;
  readonly #limits: TaskLimits;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  #active = false;

  constructor(dependencies: TaskHarnessDependencies) {
    this.#model = dependencies.model;
    this.#authority = dependencies.authority;
    this.#capabilities = dependencies.capabilities;
    this.#journal = dependencies.journal;
    this.#limits = dependencies.limits;
    this.#clock = dependencies.clock ?? systemClock;
    this.#ids = dependencies.ids ?? randomIdGenerator;
  }

  async run(task: TaskRequest): Promise<TaskResult> {
    if (this.#active) {
      throw new TaskAlreadyActiveError();
    }
    this.#active = true;

    const startedAt = this.#clock.now().getTime();
    const evidence: Evidence[] = [];
    const observations: ActionObservation[] = [];
    const failures = new Map<string, number>();
    let costUsd = 0;
    let steps = 0;

    const stopped = (reason: TaskStopReason, pendingAction?: ProposedAction): TaskResult => ({
      status: "stopped",
      taskId: task.id,
      reason,
      ...(pendingAction === undefined ? {} : { pendingAction }),
      evidence,
      steps,
      costUsd,
    });

    try {
      while (steps < this.#limits.maxSteps) {
        const remainingMs = this.#remainingMs(startedAt);
        if (remainingMs <= 0) {
          return stopped("time_limit");
        }

        let response: ModelResponse;
        try {
          response = await this.#withinDeadline(remainingMs, (signal) =>
            this.#model.decide(
              {
                taskId: task.id,
                objective: task.objective,
                observations,
                budget: {
                  remainingSteps: this.#limits.maxSteps - steps,
                  remainingCostUsd: Math.max(0, this.#limits.maxCostUsd - costUsd),
                },
              },
              signal,
            ),
          );
        } catch (error) {
          if (error instanceof DeadlineExceededError) {
            return stopped("time_limit");
          }
          return {
            status: "failed",
            taskId: task.id,
            error: errorMessage(error),
            evidence,
            steps,
            costUsd,
          };
        }

        steps += 1;
        if (!Number.isFinite(response.usage.costUsd) || response.usage.costUsd < 0) {
          return {
            status: "failed",
            taskId: task.id,
            error: "El adaptador de modelo informó un costo inválido.",
            evidence,
            steps,
            costUsd,
          };
        }
        costUsd += response.usage.costUsd;
        if (costUsd > this.#limits.maxCostUsd) {
          return stopped("cost_limit");
        }

        if (response.decision.type === "complete") {
          if (evidence.length === 0) {
            return stopped("missing_evidence");
          }
          return {
            status: "succeeded",
            taskId: task.id,
            summary: response.decision.summary,
            evidence,
            steps,
            costUsd,
          };
        }

        const decision = response.decision;
        const key = actionKey(decision.capabilityId, decision.actionName, decision.input);
        if ((failures.get(key) ?? 0) > this.#limits.maxRetriesPerAction) {
          return stopped("retry_limit");
        }

        let proposedAction: ProposedAction;
        try {
          const declaration = this.#capabilities.describeAction(
            decision.capabilityId,
            decision.actionName,
          );
          proposedAction = {
            id: this.#ids.next(),
            taskId: task.id,
            capabilityId: decision.capabilityId,
            actionName: decision.actionName,
            input: decision.input,
            risk: declaration.risk,
          };
        } catch (error) {
          return {
            status: "failed",
            taskId: task.id,
            error: errorMessage(error),
            evidence,
            steps,
            costUsd,
          };
        }

        const authority = await this.#authority.check(proposedAction);
        if (!authority.allowed) {
          return stopped(authority.reason, proposedAction);
        }

        const actionStartedAt = this.#clock.now();
        await this.#journal.started(proposedAction, actionStartedAt);
        try {
          const actionResult = await this.#withinDeadline(
            this.#remainingMs(startedAt),
            (signal) =>
              this.#capabilities.execute(
                proposedAction.capabilityId,
                proposedAction.actionName,
                proposedAction.input,
                { taskId: task.id, actionId: proposedAction.id, signal },
              ),
          );

          if (actionResult.evidence.length === 0) {
            const message = "La Acción terminó sin Evidencia verificable.";
            await this.#journal.finished(proposedAction.id, {
              status: "failed",
              error: message,
              finishedAt: this.#clock.now(),
            });
            failures.set(key, (failures.get(key) ?? 0) + 1);
            observations.push({
              capabilityId: proposedAction.capabilityId,
              actionName: proposedAction.actionName,
              status: "failed",
              evidence: [],
              error: message,
            });
            continue;
          }

          await this.#journal.finished(proposedAction.id, {
            status: "succeeded",
            evidence: actionResult.evidence,
            finishedAt: this.#clock.now(),
          });
          evidence.push(...actionResult.evidence);
          observations.push({
            capabilityId: proposedAction.capabilityId,
            actionName: proposedAction.actionName,
            status: "succeeded",
            evidence: actionResult.evidence,
          });
          failures.delete(key);
        } catch (error) {
          const message = errorMessage(error);
          await this.#journal.finished(proposedAction.id, {
            status: "failed",
            error: message,
            finishedAt: this.#clock.now(),
          });
          if (error instanceof DeadlineExceededError) {
            return stopped("time_limit");
          }
          failures.set(key, (failures.get(key) ?? 0) + 1);
          observations.push({
            capabilityId: proposedAction.capabilityId,
            actionName: proposedAction.actionName,
            status: "failed",
            evidence: [],
            error: message,
          });
        }
      }

      return stopped("step_limit");
    } finally {
      this.#active = false;
    }
  }

  #remainingMs(startedAt: number): number {
    return this.#limits.timeoutMs - (this.#clock.now().getTime() - startedAt);
  }

  async #withinDeadline<T>(
    remainingMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (remainingMs <= 0) {
      throw new DeadlineExceededError();
    }

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new DeadlineExceededError());
      }, remainingMs);
      timeout.unref();
    });

    try {
      return await Promise.race([operation(controller.signal), deadline]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
