import { AsyncEntry } from "@napi-rs/keyring";

export type SecretStore = {
  get(name: string): Promise<string | undefined>;
};

export type WritableSecretStore = SecretStore & {
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
};

function entryFor(name: string): AsyncEntry {
  const separator = name.indexOf("/");
  if (separator <= 0 || separator === name.length - 1) {
    throw new Error("El nombre del secreto debe tener el formato servicio/cuenta.");
  }
  return new AsyncEntry(name.slice(0, separator), name.slice(separator + 1));
}

export class SystemSecretStore implements WritableSecretStore {
  async get(name: string): Promise<string | undefined> {
    return (await entryFor(name).getPassword()) ?? undefined;
  }

  async set(name: string, value: string): Promise<void> {
    await entryFor(name).setPassword(value);
  }

  async delete(name: string): Promise<boolean> {
    return await entryFor(name).deleteCredential();
  }
}
