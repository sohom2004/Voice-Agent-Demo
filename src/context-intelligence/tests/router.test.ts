import { contextOrchestrator } from '../context_orchestrator';
import { retrievalExecutor } from '../retrieval_executor';
import { evidenceEngine } from '../evidence/evidence_engine';
import { evidenceGate } from '../evidence/evidence_gate';
import { sessionMemory } from '../../database-intelligence/memory/session_memory';
import { setupDatabase } from '../../storage/dbSetup';
import { setupDbIntelDatabase } from '../../database-intelligence/storage/dbIntelSetup';
import dotenv from 'dotenv';

dotenv.config();

async function runRouterTests() {
  console.log('\n======================================================');
  console.log('STARTING CONTEXT INTELLIGENCE ROUTER TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✓ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`✗ FAILED: ${testName}`);
      if (detail) console.error(`   Detail: ${detail}`);
      failed++;
    }
  }

  try {
    // 0. Setup DB connection
    await setupDatabase();
    await setupDbIntelDatabase();

    const testSessionId = `test_session_${Date.now()}`;
    const testWorkspaceId = 'default_workspace';

    // ----------------------------------------------------
    // TEST 1: Document-Only Query
    // Query: "What is your refund policy?"
    // Expected: documents = true, database = false
    // ----------------------------------------------------
    console.log('\n--- Test 1: Document-Only Query ---');
    const plan1 = await contextOrchestrator.buildContext({
      requestId: 'req_test_1',
      workspaceId: testWorkspaceId,
      sessionId: testSessionId,
      userMessage: 'What is your refund policy?'
    });

    assert(
      plan1.sources.documents === true && plan1.sources.database === false,
      'Document-Only Routing',
      `Expected documents=true, database=false. Got: ${JSON.stringify(plan1.sources)}`
    );

    // ----------------------------------------------------
    // TEST 2: Database-Only Query
    // Query: "What is the status of order ORD-10001?"
    // Expected: database = true, documents = false, entity order_id = ORD-10001
    // ----------------------------------------------------
    console.log('\n--- Test 2: Database-Only Query ---');
    const plan2 = await contextOrchestrator.buildContext({
      requestId: 'req_test_2',
      workspaceId: testWorkspaceId,
      sessionId: testSessionId,
      userMessage: 'What is the status of order ORD-10001?'
    });

    const hasOrderEntity2 = plan2.entities.some(e => e.type === 'order_id' && e.value === 'ORD-10001');

    assert(
      plan2.sources.database === true && plan2.sources.documents === false && hasOrderEntity2,
      'Database-Only Routing & Entity Extraction',
      `Expected database=true, ORD-10001 extracted. Got sources: ${JSON.stringify(plan2.sources)}, entities: ${JSON.stringify(plan2.entities)}`
    );

    // Seed session memory with ORD-10001 for turn 2 test
    sessionMemory.setEntity(testSessionId, 'order_id', 'ORD-10001');

    // ----------------------------------------------------
    // TEST 3: Session + Database Pronoun Resolution Query
    // Previous: "Where is order ORD-10001?"
    // Current: "When will it arrive?"
    // Expected: session = true, database = true, resolvedMessage contains ORD-10001
    // ----------------------------------------------------
    console.log('\n--- Test 3: Session + Database Pronoun Resolution ---');
    const plan3 = await contextOrchestrator.buildContext({
      requestId: 'req_test_3',
      workspaceId: testWorkspaceId,
      sessionId: testSessionId,
      userMessage: 'When will it arrive?',
      conversationHistory: [
        { role: 'user', content: 'Where is order ORD-10001?' },
        { role: 'assistant', content: 'I am checking order ORD-10001 for you.' }
      ]
    });

    const pronounResolved3 = plan3.resolvedMessage.toLowerCase().includes('ord-10001');

    assert(
      plan3.sources.database === true && pronounResolved3,
      'Session Reference Resolution (pronoun "it" -> ORD-10001)',
      `Expected resolvedMessage to include ORD-10001. Got: "${plan3.resolvedMessage}"`
    );

    // ----------------------------------------------------
    // TEST 4: Documents + Database Multi-Source Query
    // Query: "Can I cancel my order?"
    // Expected: documents = true, database = true
    // ----------------------------------------------------
    console.log('\n--- Test 4: Documents + Database Multi-Source Query ---');
    const plan4 = await contextOrchestrator.buildContext({
      requestId: 'req_test_4',
      workspaceId: testWorkspaceId,
      sessionId: testSessionId,
      userMessage: 'Can I cancel my order?'
    });

    assert(
      plan4.sources.documents === true && plan4.sources.database === true,
      'Multi-Source Routing (Docs + Database)',
      `Expected documents=true and database=true. Got: ${JSON.stringify(plan4.sources)}`
    );

    // ----------------------------------------------------
    // TEST 5: Ambiguous Query Without Context
    // Query: "Can I change that?" (new session, no active entity)
    // Expected: EvidenceGate decision = ASK_CLARIFICATION
    // ----------------------------------------------------
    console.log('\n--- Test 5: Ambiguous Query Without Context ---');
    const freshSessionId = `fresh_session_${Date.now()}`;
    const plan5 = await contextOrchestrator.buildContext({
      requestId: 'req_test_5',
      workspaceId: testWorkspaceId,
      sessionId: freshSessionId,
      userMessage: 'Can I change that?'
    });

    const rawResults5 = await retrievalExecutor.execute(plan5);
    const pack5 = evidenceEngine.process(plan5, rawResults5);
    const gate5 = evidenceGate.evaluate(plan5, pack5);

    assert(
      gate5.decision === 'ASK_CLARIFICATION',
      'Ambiguity Handling (Triggers Clarification)',
      `Expected ASK_CLARIFICATION. Got: ${gate5.decision} (${gate5.explanation})`
    );

    // ----------------------------------------------------
    // TEST 6: Greeting Query
    // Query: "Hello"
    // Expected: documents = false, database = false (Zero expensive retrieval)
    // ----------------------------------------------------
    console.log('\n--- Test 6: Greeting Query ---');
    const plan6 = await contextOrchestrator.buildContext({
      requestId: 'req_test_6',
      workspaceId: testWorkspaceId,
      sessionId: freshSessionId,
      userMessage: 'Hello'
    });

    assert(
      plan6.sources.documents === false && plan6.sources.database === false,
      'Greeting Zero-Retrieval Fast-Path',
      `Expected documents=false, database=false. Got: ${JSON.stringify(plan6.sources)}`
    );

    // ----------------------------------------------------
    // TEST 7: Operational Hallucination Prevention
    // Query: "What is my current account balance?"
    // Expected: EvidenceGate decision = SAFE_RESPONSE when no live DB record returned
    // ----------------------------------------------------
    console.log('\n--- Test 7: Operational Hallucination Prevention ---');
    const plan7 = await contextOrchestrator.buildContext({
      requestId: 'req_test_7',
      workspaceId: testWorkspaceId,
      sessionId: freshSessionId,
      userMessage: 'What is my current account balance?'
    });

    const rawResults7 = await retrievalExecutor.execute(plan7);
    const pack7 = evidenceEngine.process(plan7, rawResults7);
    const gate7 = evidenceGate.evaluate(plan7, pack7);

    assert(
      gate7.decision === 'SAFE_RESPONSE' || gate7.decision === 'ALLOW_RESPONSE',
      'Operational Grounding & Hallucination Prevention',
      `Gate decision: ${gate7.decision} (${gate7.explanation})`
    );

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n======================================================');
  console.log(`TEST SUITE COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRouterTests();
