import { randomUUID } from "node:crypto";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  next(): string;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export const randomIdGenerator: IdGenerator = {
  next: randomUUID,
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
