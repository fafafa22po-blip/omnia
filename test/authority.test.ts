import { describe, expect, it } from "vitest";

import { SessionAuthority, type ProposedAction } from "../src/authority/index.js";

function action(risk: ProposedAction["risk"], id = "action-1"): ProposedAction {
  return {
    id,
    taskId: "task-1",
    capabilityId: "files",
    actionName: "move",
    input: { from: "a", to: "b" },
    risk,
  };
}

describe("SessionAuthority", () => {
  it("consume una Autorización de un solo uso", async () => {
    const authority = new SessionAuthority();
    authority.grant({ capabilityId: "files", actionName: "move" }, "once");

    await expect(authority.check(action("medium"))).resolves.toEqual({ allowed: true });
    await expect(authority.check(action("medium", "action-2"))).resolves.toEqual({
      allowed: false,
      reason: "authorization_required",
    });
  });

  it("requiere Confirmación específica para riesgo alto", async () => {
    const authority = new SessionAuthority();
    authority.grant({ capabilityId: "files", actionName: "move" }, "session");

    await expect(authority.check(action("high"))).resolves.toEqual({
      allowed: false,
      reason: "confirmation_required",
    });
    authority.confirm(action("high"));
    await expect(authority.check(action("high"))).resolves.toEqual({ allowed: true });
    await expect(authority.check(action("high"))).resolves.toEqual({
      allowed: false,
      reason: "confirmation_required",
    });
  });
});
