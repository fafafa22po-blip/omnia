import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SystemSecretStore } from "../src/secrets/index.js";

describe("SystemSecretStore", () => {
  it("lee el almacén seguro del sistema sin inventar una credencial ausente", async () => {
    const store = new SystemSecretStore();

    await expect(store.get(`omnia-test-${randomUUID()}/missing`)).resolves.toBeUndefined();
  });
});
