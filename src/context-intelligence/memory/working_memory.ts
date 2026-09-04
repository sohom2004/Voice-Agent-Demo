import { ContextEntity, Evidence } from '../types';

export class WorkingMemory {
  private requestId: string;
  private entities: ContextEntity[] = [];
  private scratchpad: Map<string, unknown> = new Map();
  private collectedEvidence: Evidence[] = [];

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  getRequestId(): string {
    return this.requestId;
  }

  addEntity(entity: ContextEntity): void {
    const existingIdx = this.entities.findIndex(e => e.type === entity.type && e.value === entity.value);
    if (existingIdx >= 0) {
      if (entity.confidence > this.entities[existingIdx].confidence) {
        this.entities[existingIdx] = entity;
      }
    } else {
      this.entities.push(entity);
    }
  }

  getEntities(): ContextEntity[] {
    return [...this.entities];
  }

  set(key: string, value: unknown): void {
    this.scratchpad.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.scratchpad.get(key) as T | undefined;
  }

  addEvidence(item: Evidence): void {
    this.collectedEvidence.push(item);
  }

  getEvidence(): Evidence[] {
    return [...this.collectedEvidence];
  }
}
