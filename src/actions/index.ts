import type { ProposedAction } from "../authority/index.js";
import type { JsonValue } from "../shared/index.js";

export type Evidence = Readonly<{
  kind: string;
  summary: string;
  observedAt: Date;
  data?: JsonValue;
}>;

export type ActionOutcome =
  | Readonly<{ status: "succeeded"; evidence: readonly Evidence[]; finishedAt: Date }>
  | Readonly<{ status: "failed"; error: string; finishedAt: Date }>;

export type ActionJournal = {
  started(action: ProposedAction, startedAt: Date): Promise<void>;
  finished(actionId: string, outcome: ActionOutcome): Promise<void>;
};

export type RecordedAction = Readonly<{
  action: ProposedAction;
  startedAt: Date;
  outcome?: ActionOutcome;
}>;

export class InMemoryActionJournal implements ActionJournal {
  readonly #records = new Map<string, RecordedAction>();

  started(action: ProposedAction, startedAt: Date): Promise<void> {
    if (this.#records.has(action.id)) {
      throw new Error(`La Acción ${action.id} ya fue registrada.`);
    }
    this.#records.set(action.id, { action, startedAt });
    return Promise.resolve();
  }

  finished(actionId: string, outcome: ActionOutcome): Promise<void> {
    const existing = this.#records.get(actionId);
    if (existing === undefined) {
      throw new Error(`La Acción ${actionId} no fue iniciada.`);
    }
    if (existing.outcome !== undefined) {
      throw new Error(`La Acción ${actionId} ya terminó.`);
    }
    this.#records.set(actionId, { ...existing, outcome });
    return Promise.resolve();
  }

  list(taskId?: string): readonly RecordedAction[] {
    const records = [...this.#records.values()];
    return taskId === undefined ? records : records.filter(({ action }) => action.taskId === taskId);
  }
}
