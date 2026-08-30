import type { ActionJournal } from "../actions/index.js";
import type { AuthorityGate } from "../authority/index.js";
import { CapabilityRegistry, type CapabilityAdapter } from "../capabilities/index.js";
import type { TaskLimits } from "../config/index.js";
import type { ModelGateway } from "../models/index.js";
import { TaskHarness } from "../tasks/index.js";

export type OmniaDependencies = Readonly<{
  model: ModelGateway;
  authority: AuthorityGate;
  journal: ActionJournal;
  capabilities: readonly CapabilityAdapter[];
  limits: TaskLimits;
}>;

export function createOmnia(dependencies: OmniaDependencies): TaskHarness {
  return new TaskHarness({
    model: dependencies.model,
    authority: dependencies.authority,
    journal: dependencies.journal,
    capabilities: new CapabilityRegistry(dependencies.capabilities),
    limits: dependencies.limits,
  });
}
