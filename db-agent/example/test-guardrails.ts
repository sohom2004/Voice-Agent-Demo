import { Guardrails, GuardrailViolation } from '../src/guardrails/Guardrails';
import type { ToolDefinition } from '../src/types';

const updateTool: ToolDefinition = {
  name: 'update_orders_by_id',
  description: 'test',
  operation: 'update_by_id',
  table: 'orders',
  isWrite: true,
  params: [
    { name: 'id', columnType: 'integer', required: true, isFilter: true },
    { name: 'status', columnType: 'varchar', required: false },
  ],
};

const readTool: ToolDefinition = {
  name: 'get_orders_by_id',
  description: 'test',
  operation: 'get_by_id',
  table: 'orders',
  isWrite: false,
  params: [{ name: 'id', columnType: 'integer', required: true, isFilter: true }],
};

const g = new Guardrails();
let failures = 0;

function check(label: string, cond: boolean) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

console.log('Guardrail checks:');

// Writes need confirmation by default
check('write without confirmed=true needs confirmation', g.needsConfirmation(updateTool, {}) === true);
check('write with confirmed=true does not need confirmation', g.needsConfirmation(updateTool, { confirmed: true }) === false);
check('reads never need confirmation', g.needsConfirmation(readTool, {}) === false);

// Missing required param throws
try {
  g.validateParams(updateTool, { status: 'shipped' });
  check('missing required param throws', false);
} catch (e) {
  check('missing required param throws', e instanceof GuardrailViolation);
}

// Unexpected param throws (prevents injecting arbitrary columns)
try {
  g.validateParams(updateTool, { id: 1, admin_override: true });
  check('unexpected param throws', false);
} catch (e) {
  check('unexpected param throws', e instanceof GuardrailViolation);
}

// Valid params pass
try {
  g.validateParams(updateTool, { id: 1, status: 'shipped' });
  check('valid params pass', true);
} catch {
  check('valid params pass', false);
}

// Row cap is enforced even if caller asks for more
check('row cap clamps to configured max', g.resolveRowCap({ maxRows: 999999 }) === 200);
check('row cap respects smaller caller request', g.resolveRowCap({ maxRows: 10 }) === 10);

console.log(failures === 0 ? '\nPASS — all guardrail checks passed.\n' : `\nFAIL — ${failures} check(s) failed.\n`);
if (failures > 0) process.exit(1);
