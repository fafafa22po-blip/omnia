import type { Evidence } from "../actions/index.js";
import type { RiskLevel } from "../authority/index.js";
import type { JsonValue } from "../shared/index.js";

export type CapabilityAction = Readonly<{
  name: string;
  description: string;
  risk: RiskLevel;
}>;

export type CapabilityManifest = Readonly<{
  id: string;
  version: string;
  description: string;
  actions: readonly CapabilityAction[];
}>;

export type CapabilityContext = Readonly<{
  taskId: string;
  actionId: string;
  signal: AbortSignal;
}>;

export type CapabilityResult = Readonly<{
  evidence: readonly Evidence[];
}>;

export type CapabilityAdapter = {
  readonly manifest: CapabilityManifest;
  execute(actionName: string, input: JsonValue, context: CapabilityContext): Promise<CapabilityResult>;
};

export class CapabilityRegistry {
  readonly #adapters = new Map<string, CapabilityAdapter>();

  constructor(adapters: readonly CapabilityAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: CapabilityAdapter): void {
    if (this.#adapters.has(adapter.manifest.id)) {
      throw new Error(`La Capacidad ${adapter.manifest.id} ya está registrada.`);
    }

    const actionNames = new Set<string>();
    for (const action of adapter.manifest.actions) {
      if (actionNames.has(action.name)) {
        throw new Error(
          `La Capacidad ${adapter.manifest.id} declara dos veces la Acción ${action.name}.`,
        );
      }
      actionNames.add(action.name);
    }

    this.#adapters.set(adapter.manifest.id, adapter);
  }

  describeAction(capabilityId: string, actionName: string): CapabilityAction {
    const adapter = this.#adapter(capabilityId);
    const action = adapter.manifest.actions.find((candidate) => candidate.name === actionName);
    if (action === undefined) {
      throw new Error(`La Capacidad ${capabilityId} no declara la Acción ${actionName}.`);
    }
    return action;
  }

  execute(
    capabilityId: string,
    actionName: string,
    input: JsonValue,
    context: CapabilityContext,
  ): Promise<CapabilityResult> {
    this.describeAction(capabilityId, actionName);
    return this.#adapter(capabilityId).execute(actionName, input, context);
  }

  #adapter(capabilityId: string): CapabilityAdapter {
    const adapter = this.#adapters.get(capabilityId);
    if (adapter === undefined) {
      throw new Error(`La Capacidad ${capabilityId} no está registrada.`);
    }
    return adapter;
  }
}
