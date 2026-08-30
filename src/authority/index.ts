import type { JsonValue } from "../shared/index.js";

export type RiskLevel = "low" | "medium" | "high";

export type ActionScope = Readonly<{
  capabilityId: string;
  actionName: string;
}>;

export type ProposedAction = ActionScope &
  Readonly<{
    id: string;
    taskId: string;
    input: JsonValue;
    risk: RiskLevel;
  }>;

export type AuthorityDenialReason =
  | "authorization_required"
  | "confirmation_required"
  | "session_closed";

export type AuthorityDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: AuthorityDenialReason }>;

export type AuthorityGate = {
  check(action: ProposedAction): Promise<AuthorityDecision>;
};

export type AuthorizationLifetime = "once" | "session";

type AuthorizationGrant = Readonly<{
  scope: ActionScope;
  lifetime: AuthorizationLifetime;
}>;

function matchesScope(grant: AuthorizationGrant, action: ProposedAction): boolean {
  return (
    grant.scope.capabilityId === action.capabilityId && grant.scope.actionName === action.actionName
  );
}

function confirmationKey(action: ProposedAction): string {
  return `${action.taskId}:${action.capabilityId}:${action.actionName}:${JSON.stringify(action.input)}`;
}

export class SessionAuthority implements AuthorityGate {
  readonly #authorizations: AuthorizationGrant[] = [];
  readonly #confirmations = new Set<string>();
  #closed = false;

  grant(scope: ActionScope, lifetime: AuthorizationLifetime): void {
    this.#ensureOpen();
    this.#authorizations.push({ scope, lifetime });
  }

  confirm(action: ProposedAction): void {
    this.#ensureOpen();
    this.#confirmations.add(confirmationKey(action));
  }

  close(): void {
    this.#closed = true;
    this.#authorizations.length = 0;
    this.#confirmations.clear();
  }

  check(action: ProposedAction): Promise<AuthorityDecision> {
    if (this.#closed) {
      return Promise.resolve({ allowed: false, reason: "session_closed" });
    }

    if (action.risk === "low") {
      return Promise.resolve({ allowed: true });
    }

    if (action.risk === "high") {
      if (!this.#confirmations.delete(confirmationKey(action))) {
        return Promise.resolve({ allowed: false, reason: "confirmation_required" });
      }
      return Promise.resolve({ allowed: true });
    }

    const grantIndex = this.#authorizations.findIndex((grant) => matchesScope(grant, action));
    if (grantIndex === -1) {
      return Promise.resolve({ allowed: false, reason: "authorization_required" });
    }

    const grant = this.#authorizations[grantIndex];
    if (grant?.lifetime === "once") {
      this.#authorizations.splice(grantIndex, 1);
    }

    return Promise.resolve({ allowed: true });
  }

  #ensureOpen(): void {
    if (this.#closed) {
      throw new Error("La Sesión está cerrada.");
    }
  }
}
