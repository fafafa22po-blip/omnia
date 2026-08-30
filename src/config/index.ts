import { resolve } from "node:path";

export type TaskLimits = Readonly<{
  maxSteps: number;
  maxRetriesPerAction: number;
  timeoutMs: number;
  maxCostUsd: number;
  maxMonthlyCostUsd: number;
}>;

export type LocalConfig = Readonly<{
  databasePath: string;
  taskLimits: TaskLimits;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

function positiveInteger(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return value;
}
function nonNegativeInteger(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero no negativo.`);
  }
  return value;
}

function positiveNumber(environment: Environment, name: string, fallback: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} debe ser un número positivo.`);
  }
  return value;
}

export function loadLocalConfig(
  environment: Environment = process.env,
  workingDirectory = process.cwd(),
): LocalConfig {
  const dataDirectory = environment.OMNIA_DATA_DIR ?? ".omnia";
  return {
    databasePath: resolve(workingDirectory, dataDirectory, "omnia.sqlite"),
    taskLimits: {
      maxSteps: positiveInteger(environment, "OMNIA_MAX_STEPS", 12),
      maxRetriesPerAction: nonNegativeInteger(
        environment,
        "OMNIA_MAX_RETRIES_PER_ACTION",
        1,
      ),
      timeoutMs: positiveInteger(environment, "OMNIA_TASK_TIMEOUT_MS", 120_000),
      maxCostUsd: positiveNumber(environment, "OMNIA_MAX_COST_USD", 0.25),
      maxMonthlyCostUsd: positiveNumber(environment, "OMNIA_MAX_MONTHLY_COST_USD", 10),
    },
  };
}
