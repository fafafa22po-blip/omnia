export type Memory = Readonly<{
  id: string;
  content: string;
  createdAt: Date;
}>;

export type Commitment = Readonly<{
  id: string;
  description: string;
  startsAt: Date;
  endsAt?: Date;
  createdAt: Date;
}>;

export type ExplicitMemoryStore = {
  remember(memory: Memory): Promise<void>;
  listMemories(): Promise<readonly Memory[]>;
  addCommitment(commitment: Commitment): Promise<void>;
  listCommitments(): Promise<readonly Commitment[]>;
};

export class InMemoryExplicitMemoryStore implements ExplicitMemoryStore {
  readonly #memories = new Map<string, Memory>();
  readonly #commitments = new Map<string, Commitment>();

  remember(memory: Memory): Promise<void> {
    if (this.#memories.has(memory.id)) {
      throw new Error(`El Recuerdo ${memory.id} ya existe.`);
    }
    this.#memories.set(memory.id, memory);
    return Promise.resolve();
  }

  listMemories(): Promise<readonly Memory[]> {
    return Promise.resolve([...this.#memories.values()]);
  }

  addCommitment(commitment: Commitment): Promise<void> {
    if (this.#commitments.has(commitment.id)) {
      throw new Error(`El Compromiso ${commitment.id} ya existe.`);
    }
    this.#commitments.set(commitment.id, commitment);
    return Promise.resolve();
  }

  listCommitments(): Promise<readonly Commitment[]> {
    return Promise.resolve([...this.#commitments.values()]);
  }
}
