import { Capability } from './types';

export class CapabilityRegistry {
  private capabilities: Map<string, Capability> = new Map();

  constructor() {
    this.registerDefaultCapabilities();
  }

  private registerDefaultCapabilities() {
    this.register({
      id: 'cancel_order',
      name: 'cancel_order',
      description: 'Cancels an existing customer order if eligible under policy',
      operation: 'write',
      requiredInputs: [
        { name: 'order_id', type: 'string', required: true, description: 'Order ID (e.g. ORD-10001)' }
      ],
      requiredSources: ['database', 'documents'],
      confirmationRequired: true
    });

    this.register({
      id: 'update_address',
      name: 'update_address',
      description: 'Updates shipping or billing address for a customer or order',
      operation: 'write',
      requiredInputs: [
        { name: 'order_id', type: 'string', required: true },
        { name: 'new_address', type: 'string', required: true }
      ],
      requiredSources: ['database'],
      confirmationRequired: true
    });

    this.register({
      id: 'get_order_status',
      name: 'get_order_status',
      description: 'Fetches live status and tracking details for a specific order',
      operation: 'read',
      requiredInputs: [
        { name: 'order_id', type: 'string', required: true }
      ],
      requiredSources: ['database'],
      confirmationRequired: false
    });
  }

  register(cap: Capability): void {
    this.capabilities.set(cap.name, cap);
  }

  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  listCapabilities(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  findMatchingCapabilities(query: string): Capability[] {
    const text = query.toLowerCase();
    return this.listCapabilities().filter(cap => 
      text.includes(cap.name) || text.includes(cap.description.toLowerCase())
    );
  }
}

export const capabilityRegistry = new CapabilityRegistry();
