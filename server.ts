import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createServer as createViteServer } from 'vite';

// RAG modules
import { setupDatabase, pool } from './src/storage/dbSetup';
import { PgDocumentRepository } from './src/storage/pgRepository';
import { HybridRetrievalService } from './src/retrieval/retrievalService';
import { SAMPLE_DOCUMENTS } from './src/data/sampleDocs';
import { ContextBuilder } from './src/retrieval/retrievalService';

dotenv.config();

const app = express();
const PORT = 3000;
const server = http.createServer(app);

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const upload = multer({ dest: 'uploads/' });

// Initialize repositories & services
const docRepo = new PgDocumentRepository();
const retrievalService = new HybridRetrievalService();

// Initialize database tables on server start
import { setupDbIntelDatabase } from './src/database-intelligence/storage/dbIntelSetup';
import { IntelRepository } from './src/database-intelligence/storage/intelRepository';
import { SchemaInspector, getConnector } from './src/database-intelligence/discovery/schema_inspector';
import { DataSampler } from './src/database-intelligence/discovery/data_sampler';
import { SemanticAnalyzer } from './src/database-intelligence/intelligence/semantic_analyzer';
import { LexicalRetriever } from './src/database-intelligence/retrieval/lexical_retriever';
import { SemanticRetriever } from './src/database-intelligence/retrieval/semantic_retriever';
import { RelationshipExpander } from './src/database-intelligence/retrieval/relationship_expander';
import { ContextBuilder as DbContextBuilder } from './src/database-intelligence/retrieval/context_builder';
import { QueryValidator } from './src/database-intelligence/security/query_validator';
import { QueryCompiler } from './src/database-intelligence/execution/query_compiler';
import { ReadExecutor } from './src/database-intelligence/execution/read_executor';
import { WriteExecutor } from './src/database-intelligence/execution/write_executor';
import { SchemaRefresh } from './src/database-intelligence/sync/schema_refresh';
import { encryptCredentials } from './src/database-intelligence/security/credentials';
import { sessionMemory } from './src/database-intelligence/memory/session_memory';

// Context Intelligence Modules
import { contextOrchestrator } from './src/context-intelligence/context_orchestrator';
import { retrievalExecutor } from './src/context-intelligence/retrieval_executor';
import { evidenceEngine } from './src/context-intelligence/evidence/evidence_engine';
import { evidenceGate } from './src/context-intelligence/evidence/evidence_gate';

// db-agent Service Integration
import { dbAgentService } from './src/services/dbAgentService';
import { IngestionWorker } from './src/knowledge-ingestion/worker';

setupDatabase()
  .then(async ({ usePgVector }) => {
    console.log(`[Database] Connection initialized. pgvector enabled: ${usePgVector}`);
    await setupDbIntelDatabase();

    // Auto-start Document Ingestion Worker loop in background alongside server
    const ingestionWorker = new IngestionWorker();
    ingestionWorker.start().catch(err => {
      console.error('[Ingestion Worker] Automatic background start failed:', err);
    });
  })
  .catch(err => {
    console.error('[Database] Failed to initialize database schema:', err);
  });

const intelRepo = new IntelRepository();
const schemaInspector = new SchemaInspector();
const dataSampler = new DataSampler();
const semanticAnalyzer = new SemanticAnalyzer();
const lexicalRetriever = new LexicalRetriever();
const semanticRetriever = new SemanticRetriever();
const relationshipExpander = new RelationshipExpander();
const dbContextBuilder = new DbContextBuilder();
const queryValidator = new QueryValidator();
const queryCompiler = new QueryCompiler();
const readExecutor = new ReadExecutor();
const writeExecutor = new WriteExecutor();
const schemaRefresh = new SchemaRefresh();

// Allow large payloads for audio base64 and document uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy initialize Gemini client
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Natasha System Prompt Builder
function buildSystemPrompt(retrievedContext: string) {
  let docContext = '';

  if (retrievedContext) {
    docContext =
      `\n\n--- RETRIEVED DOCUMENT KNOWLEDGE AVAILABLE FOR CONTEXT ---\n` +
      retrievedContext +
      `\n--- END OF RETRIEVED DOCUMENT KNOWLEDGE ---\n`;
  }

  return `# IDENTITY & PERSONA
You are Natasha, an intelligent, warm, highly adaptive, and polyglot real-time voice companion and assistant, you can access databases and documents and you will answer based on those according to the user requirements.
Your tone is professional, conversational, approachable, empathetic, eloquent, and witty when appropriate.

# 1. DYNAMIC MULTILINGUAL SWITCHING (ZERO-CONFIGURATION)
- DYNAMICALLY SWITCH LANGUAGES: Automatically detect whatever language or dialect the user is speaking in, and IMMEDIATELY respond in that EXACT same language.
- The user does NOT need to specify, configure, or announce their language.
- Seamlessly support all global and regional languages, including:
  * Indian languages: Hindi (हिंदी), Bengali (বাংলা), Tamil (தமிழ்), Telugu (తెలుగు), Marathi (मराठी), Gujarati (ગુજરાતી), Punjabi (ਪੰਜਾਬੀ), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Urdu (اردو), etc.
  * Code-mixing & Hinglish.
  * Global languages: Spanish, French, German, Japanese, Mandarin, Italian, Portuguese, Arabic, Russian, Korean, etc.
- MID-CONVERSATION SWITCHING: If the user changes languages mid-conversation, switch IMMEDIATELY with the user without commenting on the language switch.

# 2. ACCENT & PHONETIC AUTHENTICITY
- INDIAN ENGLISH ACCENT & CADENCE: When speaking English, speak with a natural, articulate, warm Indian English accent, intonation, and rhythm.
- NATIVE ACCENT FOR OTHER LANGUAGES: When speaking any language other than English, speak with authentic, fluent, natural pronunciation, vocabulary, and prosody appropriate to that language.

# 3. ATTENTIVE TURN-TAKING & IMMEDIATE STOP ON USER SPEECH
- NEVER TALK OVER THE USER: Whenever the user begins speaking or makes a sound, immediately stop speaking and listen.
- WAIT FOR COMPLETION: Patiently wait until the user has finished their complete thought before responding.
- CONCISE, NATURAL SPOKEN CADENCE: Keep answers bite-sized, engaging, and natural for real-time conversation.

# 4. VOICE-FIRST AUDIO CADENCE RULES
- You are speaking aloud in an audio conversation. Speak naturally as if engaged in real-time dialogue.
- ABSOLUTELY AVOID visual formatting artifacts that disrupt Text-to-Speech.
- NEVER output markdown asterisks, hashtags, bullet point characters, numbered markdown lists, raw tables, raw URLs, or code blocks.
- Do not expose internal technical terminology unless the user explicitly demonstrates technical expertise and asks for it.
- Explain information conversationally and naturally.
- CONVERSATIONAL FLOW: Use natural transitional phrases when appropriate.

# 5. DOCUMENT GROUNDING & RETRIEVAL
${retrievedContext
      ? `- You have active user-uploaded documents retrieved for your context below.
- PRIORITIZE uploaded content over general knowledge for project-specific questions.
- Maintain strict factual adherence to the provided documents when answering context-specific questions.
- If the user asks about the project or uploaded file and the answer is NOT present in the retrieved context, clearly explain in the user's current language that you could not find that information in the available information and ask whether they would like a general answer instead.`
      : `- No documents are currently available.
- Seamlessly operate as an open-ended conversational assistant without unnecessarily mentioning documents or file requirements.`}
${docContext}

# 6. DATABASE INTERACTION & CUSTOMER ASSISTANCE

You can access business databases through approved database tools. Your role is to help ordinary, non-technical customers access information and complete supported requests naturally.

IMPORTANT: Assume that the person speaking to you is a general customer unless the conversation clearly establishes otherwise.

The customer does NOT need to understand:
- databases
- tables
- columns
- records
- schemas
- SQL
- customer IDs
- database relationships
- internal systems

NEVER ask questions such as:
- "Which database table are you referring to?"
- "Which record should I query?"
- "What column should I search?"
- "What is the schema?"
- "Please provide the primary key."
- Any other technical database terminology.

You are responsible for translating the customer's natural language request into the appropriate database lookup or approved database action internally.

# 7. UNDERSTANDING CUSTOMER REQUESTS

Interpret ordinary customer language intelligently.

Examples:

If the customer says:
"Where is my order?"

Understand that they likely want their order status, shipment information, or delivery details.

If the customer says:
"How much do I owe?"

Understand that they may be asking about their account balance, invoice, payment, or outstanding amount.

If the customer says:
"I want to know about my booking."

Understand that they may want booking details, status, timing, location, or related information.

If the customer says:
"Can you check my account?"

Determine what information can reasonably be retrieved and ask for identification only when necessary.

If the customer's request is broad but understandable, do NOT immediately ask technical clarification questions. Use available context and conversation history to determine the most likely intent.

# 8. CUSTOMER IDENTIFICATION & DATABASE LOOKUPS

Before accessing customer-specific or sensitive information, determine whether you have enough information to identify the correct person or account.

Use information naturally provided during the conversation whenever possible.

Examples of useful identifiers may include:
- full name
- customer ID
- account number
- order number
- booking reference
- registered phone number
- registered email address
- invoice number
- ticket number
- any other appropriate business identifier

NEVER ask the customer which database table contains their information.

Instead, ask naturally for information that an ordinary customer would reasonably know.

Examples:

"Sure, I can check that for you. Could you provide your order number?"

"I'd be happy to look into that. Could you tell me the name the booking was made under?"

"Of course. Could you provide your customer ID or the email address associated with your account?"

"Let me check that for you. Could you share your booking reference or the phone number used for the booking?"

Choose the most natural identifier based on what the customer is asking about.

Do not ask for unnecessary identifiers.

# 9. INTELLIGENT DATABASE SEARCH STRATEGY

When the customer provides an identifier, use the database tools to locate the relevant information.

Internally determine:
- what type of entity the customer is referring to
- which available business data source is most relevant
- what identifier can locate the information
- what related information may be needed to answer the request

Do not expose this reasoning process to the customer.

Use conversation context to avoid repeatedly asking for information that has already been provided.

For example, if the customer already gave their order number earlier in the conversation, reuse it when appropriate instead of asking again.

If multiple possible customer records are found, resolve ambiguity naturally.

For example:

"I found more than one account under that name. Could you confirm the email address associated with your account?"

Never mention duplicate database rows, records, tables, or query ambiguity.

# 10. DATABASE TOOL USE

Use database tools whenever they are necessary to answer a customer-specific question.

Do not pretend to know customer-specific information.

Do not invent:
- order statuses
- balances
- account details
- bookings
- transactions
- customer information
- delivery information
- support history
- database results

If the answer depends on business data, retrieve it through the appropriate approved tool.

When database information is successfully retrieved:
- answer the customer's actual question directly
- summarize information in natural conversational language
- do not expose raw database output
- do not mention SQL, queries, tables, schemas, columns, or records
- only provide information relevant to the customer's request

# 11. HANDLING MISSING OR INSUFFICIENT INFORMATION

If you cannot identify the relevant customer, account, order, booking, or entity with the information available, ask for the most natural identifying detail.

Do not overwhelm the customer with a long list of requirements.

Ask for one or two useful identifiers at a time.

For example:

"I can definitely check that for you. Could you give me your order number?"

If they do not have it:

"No problem. Could you tell me the name and phone number associated with the order?"

Adapt naturally based on what information the business database supports.

# 12. DATABASE WRITE ACTIONS

Database access may include approved actions in addition to retrieving information.

Examples of supported actions may include:
- creating a support request
- adding notes
- updating permitted customer details
- creating a booking
- rescheduling a booking
- cancelling a booking
- updating other explicitly supported business information

However, NEVER treat the database as unrestricted.

Only perform actions through approved tools and supported operations.

Never attempt arbitrary database modifications.

Never generate or execute unrestricted SQL commands for modifying data.

Before performing an action that changes customer data or has a meaningful consequence:

1. Clearly explain what you are about to do.
2. Ask for confirmation when appropriate.
3. Only execute the action after receiving clear confirmation.

Example:

Customer: "Cancel my appointment."

Natasha should first identify the correct appointment.

Then say something like:

"I found your appointment for tomorrow at 3 PM. Would you like me to cancel it?"

Only after clear confirmation should the cancellation action be executed.

# 13. CONFIRMATION FOR IMPORTANT ACTIONS

Always require explicit confirmation before actions that could have significant consequences, including when applicable:

- cancellations
- financial changes
- refunds
- payments
- account closure
- deletion of information
- irreversible changes
- major changes to customer details

Do not interpret vague statements as confirmation.

For example:

"I think so."

"I guess."

"Whatever."

These should not automatically be treated as confirmation for a significant action.

Prefer clear confirmation such as:

"Yes, cancel it."

"Yes, please proceed."

"That's correct."

# 14. FAILURE HANDLING

If a database lookup returns no result, do not blame the customer and do not expose technical errors.

Say naturally:

"I couldn't find that with the information I have. Let me try another way."

Then request another useful identifier if necessary.

If the database tool fails or information cannot be retrieved, do not fabricate an answer.

Explain naturally that you are unable to access the information right now and offer the next appropriate step.

Never expose:
- SQL errors
- database errors
- internal system errors
- schemas
- table names
- infrastructure details
- stack traces
- internal implementation details

# 15. INFORMATION SOURCE PRIORITY

When answering, intelligently determine the appropriate information source.

Use conversation context for information already provided by the customer.

Use retrieved documents for business policies, product knowledge, procedures, and project-specific information.

Use database tools for dynamic, customer-specific, transactional, account-specific, or operational information.

Use general knowledge only when appropriate and when the answer does not require private or business-specific information.

Do not confuse these sources.

Examples:

"What is your return policy?"
→ Prefer retrieved business documents.

"Has my order been shipped?"
→ Use the database.

"What is artificial intelligence?"
→ Use general knowledge.

# 16. SOURCE SELECTION RULE

Before answering a question, internally determine:

Is this answer available from the conversation?

If not, is this a policy, product, procedural, or knowledge question?

If yes, use retrieved document knowledge.

Is this customer-specific, dynamic, transactional, or account-specific?

If yes, use the database tool.

Do not ask the customer which system contains the information.

That decision is your responsibility.

# 17. PRIVACY, SECURITY & CUSTOMER TRUST

Only retrieve and reveal information appropriate to the identified customer and the current request.

Do not reveal another customer's private information.

Do not expose internal business information unless it is intended to be customer-facing.

If identity verification is required by the business workflow, follow the approved verification process before revealing sensitive information.

Always prioritize customer privacy, accuracy, and trust.

# 18. FINAL RESPONSE BEHAVIOR

Your goal is to make database interactions feel invisible to the customer.

The customer should feel like they are simply talking to a knowledgeable and helpful customer service representative.

Never make the customer learn how the company's systems work.

You handle the technical complexity internally.

Speak naturally.

Ask simple human questions.

Use the available tools intelligently.

Retrieve real information when necessary.

Never invent customer-specific facts.

Never expose internal database terminology or infrastructure.

Always focus on solving the customer's actual problem efficiently and conversationally.
`;
}

// --- DATABASE INTELLIGENCE LAYER ENDPOINTS ---

// 1. Create a database connection (encrypted config)
app.post('/api/database-connections', async (req, res) => {
  try {
    const { name, provider, host, port, user, password, database, schema, ssl } = req.body;
    const workspaceId = req.body.workspaceId || 'default_workspace';

    if (!name || !provider || !host || !port || !user || !database) {
      return res.status(400).json({ error: 'Missing required database connection fields.' });
    }

    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const rawConfig = { host, port, user, password, database, schema, ssl };
    const encryptedConfig = encryptCredentials(JSON.stringify(rawConfig));

    console.log(`[API] Registering connection ${connectionId} and starting analysis...`);
    const record = await intelRepo.createConnection({
      id: connectionId,
      workspaceId,
      name,
      provider,
      connectionConfig: encryptedConfig,
      status: 'analyzing'
    });

    try {
      // Step A: Inspect Schema
      const schemaData = await schemaInspector.inspect(provider, encryptedConfig);

      // Step B: Save Table Structural Metadata
      const tableIdMap = await intelRepo.saveTablesMetadata(connectionId, schemaData.tables);
      await intelRepo.saveRelationships(connectionId, schemaData.relationships);

      // Step C: Generate semantic data for each table
      const connector = getConnector(provider, encryptedConfig);
      await connector.connect();
      try {
        for (const table of schemaData.tables) {
          // Skip platform internal metadata tables
          if (
            table.name.startsWith('db_') ||
            table.name === 'documents' ||
            table.name === 'document_chunks'
          ) {
            console.log(`[Discovery Pipeline] Skipping internal platform table: ${table.name}`);
            continue;
          }

          const tableId = tableIdMap.get(table.name);
          if (!tableId) continue;

          console.log(`[Discovery Pipeline] Sampling and generating semantic analysis for table: ${table.name}`);
          const sample = await dataSampler.sampleAndMask(connector, table.name, 10);

          const semantic = await semanticAnalyzer.analyzeTable(table, sample);
          const embedding = await semanticAnalyzer.generateEmbedding(semantic.description);

          await intelRepo.saveSemanticMetadata(
            tableId,
            semantic.description,
            semantic.businessConcepts,
            semantic.synonyms,
            embedding
          );
        }

        // Step D: Generate Logical Capabilities
        console.log('[Discovery Pipeline] Analyzing system tables to generate logical Capabilities...');
        const userTablesOnly = schemaData.tables.filter(table =>
          !table.name.startsWith('db_') &&
          table.name !== 'documents' &&
          table.name !== 'document_chunks'
        );
        const capabilities = await semanticAnalyzer.generateCapabilities(userTablesOnly);

        const capabilitiesWithEmbeddings = await Promise.all(
          capabilities.map(async cap => {
            const embedding = await semanticAnalyzer.generateEmbedding(cap.description);
            return { ...cap, embedding };
          })
        );

        await intelRepo.saveCapabilities(connectionId, capabilitiesWithEmbeddings);
      } finally {
        await connector.disconnect();
      }

      await intelRepo.updateConnectionStatus(connectionId, 'ready');
      console.log(`[Discovery Pipeline] Finished analysis successfully for connection ${connectionId}.`);

      const updatedRecord = await intelRepo.getConnection(connectionId);
      res.json(updatedRecord);
    } catch (pipelineErr: any) {
      console.error(`[Discovery Pipeline] Failed to analyze connection ${connectionId}:`, pipelineErr);
      await intelRepo.updateConnectionStatus(connectionId, 'failed', pipelineErr.message || 'Discovery pipeline failed.');
      res.status(400).json({ error: `Database analysis failed: ${pipelineErr.message}` });
    }
  } catch (err: any) {
    console.error('[API] Database connection creation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to create database connection.' });
  }
});

// 2. List connections
app.get('/api/database-connections', async (req, res) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || 'default_workspace';
    const list = await intelRepo.listConnections(workspaceId);

    // Scrub encrypted config from public response payload for security
    const scrubbedList = list.map(c => ({
      id: c.id,
      workspaceId: c.workspaceId,
      name: c.name,
      provider: c.provider,
      status: c.status,
      error: c.error,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }));

    res.json(scrubbedList);
  } catch (err: any) {
    console.error('[API] Connection list fetch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch connections.' });
  }
});

// 3. Delete connection
app.delete('/api/database-connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await intelRepo.deleteConnection(id);
    console.log(`[API] Deleted database connection ${id}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[API] Connection deletion failed:', err);
    res.status(500).json({ error: err.message || 'Failed to delete connection.' });
  }
});

// 4. Start database discovery analysis (asynchronously in the background)
app.post('/api/database-connections/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await intelRepo.getConnection(id);
    if (!connection) {
      return res.status(404).json({ error: 'Database connection not found.' });
    }

    // Set connection status to 'analyzing'
    await intelRepo.updateConnectionStatus(id, 'analyzing');

    // Run discovery pipeline in the background
    (async () => {
      try {
        console.log(`[Discovery Pipeline] Starting analysis for connection ${id}...`);

        // Step A: Inspect Schema
        const schema = await schemaInspector.inspect(connection.provider, connection.connectionConfig);

        // Step B: Save Table Structural Metadata
        const tableIdMap = await intelRepo.saveTablesMetadata(id, schema.tables);
        await intelRepo.saveRelationships(id, schema.relationships);

        // Step C: Generate semantic data for each table
        const connector = getConnector(connection.provider, connection.connectionConfig);
        await connector.connect();
        try {
          for (const table of schema.tables) {
            // Skip platform internal metadata tables
            if (
              table.name.startsWith('db_') ||
              table.name === 'documents' ||
              table.name === 'document_chunks'
            ) {
              console.log(`[Discovery Pipeline] Skipping internal platform table: ${table.name}`);
              continue;
            }

            const tableId = tableIdMap.get(table.name);
            if (!tableId) continue;

            console.log(`[Discovery Pipeline] Sampling and generating semantic analysis for table: ${table.name}`);
            const sample = await dataSampler.sampleAndMask(connector, table.name, 10);

            const semantic = await semanticAnalyzer.analyzeTable(table, sample);
            const embedding = await semanticAnalyzer.generateEmbedding(semantic.description);

            await intelRepo.saveSemanticMetadata(
              tableId,
              semantic.description,
              semantic.businessConcepts,
              semantic.synonyms,
              embedding
            );
          }

          // Step D: Generate Logical Capabilities for DB connection
          console.log('[Discovery Pipeline] Analyzing system tables to generate logical Capabilities...');
          const userTablesOnly = schema.tables.filter(table =>
            !table.name.startsWith('db_') &&
            table.name !== 'documents' &&
            table.name !== 'document_chunks'
          );
          const capabilities = await semanticAnalyzer.generateCapabilities(userTablesOnly);

          const capabilitiesWithEmbeddings = await Promise.all(
            capabilities.map(async cap => {
              const embedding = await semanticAnalyzer.generateEmbedding(cap.description);
              return { ...cap, embedding };
            })
          );

          await intelRepo.saveCapabilities(id, capabilitiesWithEmbeddings);
        } finally {
          await connector.disconnect();
        }

        await intelRepo.updateConnectionStatus(id, 'ready');
        console.log(`[Discovery Pipeline] Finished analysis successfully for connection ${id}.`);
      } catch (pipelineErr: any) {
        console.error(`[Discovery Pipeline] Failed to analyze connection ${id}:`, pipelineErr);
        await intelRepo.updateConnectionStatus(id, 'failed', pipelineErr.message || 'Discovery pipeline failed.');
      }
    })();

    res.json({ success: true, status: 'analyzing' });
  } catch (err: any) {
    console.error('[API] Database analysis start failed:', err);
    res.status(500).json({ error: err.message || 'Failed to start database analysis.' });
  }
});

// 5. Get status of discovery pipeline
app.get('/api/database-connections/:id/analysis-status', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await intelRepo.getConnection(id);
    if (!connection) {
      return res.status(404).json({ error: 'Database connection not found.' });
    }
    res.json({ status: connection.status, error: connection.error });
  } catch (err: any) {
    console.error('[API] Analysis status fetch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch status.' });
  }
});

// 6. Get schema metadata
app.get('/api/database-connections/:id/schema', async (req, res) => {
  try {
    const { id } = req.params;
    const connection = await intelRepo.getConnection(id);
    if (!connection) {
      return res.status(404).json({ error: 'Database connection not found.' });
    }

    const tables = await intelRepo.getTablesMetadata(id);
    const schemaDetails = [];
    for (const table of tables) {
      const columns = await intelRepo.getTableColumns(table.id);

      // Fetch semantic description
      const semRes = await pool.query(
        'SELECT semantic_description, business_concepts, synonyms FROM db_semantic_metadata WHERE table_id = $1',
        [table.id]
      );
      const semantics = semRes.rows[0] || null;

      schemaDetails.push({
        table: table.name,
        schemaName: table.schemaName,
        description: table.description,
        rowCount: table.rowCount,
        columns: columns.map(c => ({
          name: c.name,
          dataType: c.dataType,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
          classification: c.classification
        })),
        semantics: semantics ? {
          description: semantics.semantic_description,
          businessConcepts: semantics.business_concepts,
          synonyms: semantics.synonyms
        } : null
      });
    }

    const relationships = await intelRepo.getRelationships(id);

    res.json({ schemaDetails, relationships });
  } catch (err: any) {
    console.error('[API] Schema retrieval failed:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve schema.' });
  }
});

// 7. Context Retrieval testing endpoint
app.post('/api/database-context/retrieve', async (req, res) => {
  try {
    const { tenant_id, database_connection_id, query } = req.body;
    const workspaceId = tenant_id || 'default_workspace';

    if (!database_connection_id || !query) {
      return res.status(400).json({ error: 'Missing database_connection_id or query.' });
    }

    // A. Perform Keyword match
    const lexicalMatches = await lexicalRetriever.retrieve(database_connection_id, query);

    // B. Perform Semantic match (threshold 0.45)
    const semanticMatches = await semanticRetriever.retrieveTables(database_connection_id, query, 0.45);
    const semanticCaps = await semanticRetriever.retrieveCapabilities(database_connection_id, query, 0.45);

    // Merge tables matching either lexical or semantic search
    const uniqueTableNames = new Set<string>();
    lexicalMatches.forEach(m => uniqueTableNames.add(m.tableName));
    semanticMatches.forEach(m => uniqueTableNames.add(m.tableName));

    // C. Expand relationships between matched tables
    const expansion = await relationshipExpander.expand(database_connection_id, Array.from(uniqueTableNames));

    // D. Build compact XML context block
    const xmlContext = await dbContextBuilder.buildContext(
      database_connection_id,
      expansion.expandedTables,
      expansion.relationships,
      semanticCaps
    );

    res.json({
      contextXml: xmlContext,
      matchedTables: expansion.expandedTables,
      relationships: expansion.relationships,
      capabilities: semanticCaps
    });
  } catch (err: any) {
    console.error('[API] Context retrieval failed:', err);
    res.status(500).json({ error: err.message || 'Context retrieval failed.' });
  }
});

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Natasha Voice Agent API' });
});

// Document Upload Endpoint
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }

    const workspaceId = req.body.workspaceId || 'default_workspace';

    // Create new document job record with 'uploaded' status
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const docRecord = await docRepo.create({
      id: docId,
      workspaceId,
      name: file.originalname,
      fileType: file.originalname.split('.').pop() || 'txt',
      storagePath: file.path,
      status: 'uploaded',
      size: file.size,
      uploadedAt: Date.now()
    });

    console.log(`[API] Document [${file.originalname}] uploaded and queued for processing.`);
    res.json(docRecord);
  } catch (err: any) {
    console.error('[API] Document upload failed:', err);
    res.status(500).json({ error: err.message || 'Failed to upload document.' });
  }
});

// Document List Endpoint
app.get('/api/documents', async (req, res) => {
  try {
    const workspaceId = (req.query.workspaceId as string) || 'default_workspace';
    const list = await docRepo.list(workspaceId);
    res.json(list);
  } catch (err: any) {
    console.error('[API] Document list fetch failed:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch documents.' });
  }
});

// Document Delete Endpoint
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = await docRepo.get(docId);

    if (doc) {
      // 1. Delete file from disk
      if (fs.existsSync(doc.storagePath)) {
        fs.unlinkSync(doc.storagePath);
      }
      // 2. Delete from DB (foreign keys cascade deletes chunks)
      await docRepo.delete(docId);
      console.log(`[API] Document [${doc.name}] deleted.`);
      return res.json({ success: true });
    }

    res.status(404).json({ error: 'Document not found' });
  } catch (err: any) {
    console.error('[API] Document deletion failed:', err);
    res.status(500).json({ error: err.message || 'Failed to delete document.' });
  }
});

// Reset Samples Endpoint
app.post('/api/documents/reset-samples', async (req, res) => {
  try {
    const workspaceId = req.body.workspaceId || 'default_workspace';

    // Clean existing documents for default_workspace
    const existing = await docRepo.list(workspaceId);
    for (const doc of existing) {
      if (fs.existsSync(doc.storagePath)) {
        fs.unlinkSync(doc.storagePath);
      }
      await docRepo.delete(doc.id);
    }

    // Write sample files to disk and queue them
    const created = [];

    for (const sample of SAMPLE_DOCUMENTS) {
      const sampleFileId = `doc_sample_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const samplePath = path.join(uploadDir, `${sampleFileId}.txt`);
      fs.writeFileSync(samplePath, sample.content);

      const docRecord = await docRepo.create({
        id: sampleFileId,
        workspaceId,
        name: sample.name,
        fileType: sample.type,
        storagePath: samplePath,
        status: 'uploaded',
        size: Buffer.byteLength(sample.content),
        uploadedAt: Date.now()
      });
      created.push(docRecord);
    }

    res.json(created);
  } catch (err: any) {
    console.error('[API] Reset samples failed:', err);
    res.status(500).json({ error: err.message || 'Failed to reset samples.' });
  }
});

// Chat Endpoint (Generates text response + optional TTS audio using RAG retrieval)
app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      history = [],
      activeDocumentIds = [],
      workspaceId = 'default_workspace',
      sessionId = 'default_session',
      voiceName = 'Kore',
      generateAudio = true
    } = req.body;

    if (!message && (!history || history.length === 0)) {
      return res.status(400).json({ error: 'Message or history is required.' });
    }

    const activeDocIds = Array.isArray(activeDocumentIds)
      ? activeDocumentIds
      : (activeDocumentIds ? [activeDocumentIds] : []);

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Stage 1 to 5: Context Intelligence Routing Cascade -> ContextPlan
    const contextPlan = await contextOrchestrator.buildContext({
      requestId,
      workspaceId,
      sessionId,
      userMessage: message,
      activeDocumentIds: activeDocIds,
      conversationHistory: history
    });

    // 2. Parallel Retrieval Execution
    const rawResults = await retrievalExecutor.execute(contextPlan, activeDocIds);

    // 3. Unified Evidence Engine Normalization & Conflict Resolution
    const evidencePack = evidenceEngine.process(contextPlan, rawResults);

    // 4. Evidence Gate Evaluation
    const gateEvaluation = evidenceGate.evaluate(contextPlan, evidencePack);

    // Structured Observability Logging
    console.log('\n[Context Intelligence Pipeline]');
    console.log(`  RequestId:         ${requestId}`);
    console.log(`  SessionId:         ${sessionId}`);
    console.log(`  User Message:      "${message}"`);
    console.log(`  Resolved Message:  "${contextPlan.resolvedMessage}"`);
    console.log(`  Resolved Entities: ${JSON.stringify(contextPlan.entities)}`);
    console.log(`  Routing Strategy:  ${contextPlan.routing.strategy} (Confidence: ${contextPlan.routing.confidence})`);
    console.log(`  Selected Sources:  ${JSON.stringify(contextPlan.sources)}`);
    console.log(`  Evidence Decision: ${gateEvaluation.decision} (${gateEvaluation.explanation})\n`);

    // Handle early gate decisions (Clarification, Safe Fallbacks without LLM guessing)
    if (gateEvaluation.decision === 'ASK_CLARIFICATION' || gateEvaluation.decision === 'SAFE_RESPONSE') {
      const replyText = gateEvaluation.groundedMessage || "Could you please clarify your request?";

      let audioBase64: string | undefined;
      if (generateAudio && replyText) {
        try {
          const ai = getGenAI();
          const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
          const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';
          const cleanForTts = replyText.replace(/[*#_`~[\]]/g, '').replace(/\n+/g, ' ').slice(0, 1500);

          const ttsResponse = await ai.models.generateContent({
            model: 'gemini-3.1-flash-tts-preview',
            contents: [{ parts: [{ text: cleanForTts }] }],
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: selectedVoice },
                },
              },
            },
          });
          audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        } catch (ttsErr) {
          console.warn('TTS generation warning:', ttsErr);
        }
      }

      return res.json({
        text: replyText,
        audioBase64,
        suggestedQuestions: [
          'Can you clarify your question?',
          'What would you like to search for next?',
          'How can I help you further?'
        ],
        groundedDocs: [],
        metrics: rawResults.latencies,
        contextPlan,
        evidenceDecision: gateEvaluation.decision
      });
    }

    const retrievedContext = rawResults.docContextString;
    const dbContextXml = rawResults.dbContextXml;
    const activeConnection = rawResults.activeConnection;
    const groundedDocs = rawResults.docChunks.map(c => c.documentName);

    const ai = getGenAI();
    let systemPrompt = buildSystemPrompt(retrievedContext);

    // Add Grounding Rules to system prompt
    systemPrompt += `\n\n# GROUNDING & EVIDENCE RULES
1. Operational facts MUST strictly match retrieved live database records. Do NOT invent order statuses, balances, or customer details.
2. Policies and static rules MUST strictly match retrieved document knowledge.
3. If database evidence is absent or no matching record was found, state clearly that the record was not found in the live system.
4. If asked to update or write data, only perform allowed write capability tool calls.
`;

    if (dbContextXml) {
      systemPrompt += `\n\n# 6. DATABASE INTELLIGENCE GROUNDING
Use the schema definitions and capabilities below to search, read, and write customer data in real time.
To query or modify data, make a structured tool call.
DO NOT assume schema column or table names; only use the specific tables and columns listed.
If database results are returned, present them conversationally and naturally. Do not read out JSON raw format.

--- DATABASE SCHEMA CONTEXT ---
${dbContextXml}
--- END OF DATABASE SCHEMA CONTEXT ---
`;
    }

    // Format conversation history for Gemini
    const contents: any[] = [];
    for (const h of history) {
      if (h.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: h.content }] });
      } else if (h.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: h.content }] });
      }
    }

    if (message) {
      contents.push({ role: 'user', parts: [{ text: message }] });
    }

    // DYNAMIC TOOL EXPOSURE: Expose tools ONLY when ContextPlan permits them
    const exposedFunctionDecls: any[] = [];
    if (activeConnection && contextPlan.sources.database) {
      exposedFunctionDecls.push({
        name: 'execute_db_read',
        description: 'Queries the connected customer database. Use this to search for order statuses, shipment details, customers, tickets, or any business record. Input must be a structured QueryPlan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            queryPlan: {
              type: 'OBJECT',
              properties: {
                operation: { type: 'STRING', enum: ['SELECT'] },
                tables: { type: 'ARRAY', items: { type: 'STRING' } },
                fields: { type: 'ARRAY', items: { type: 'STRING' } },
                joins: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      leftTable: { type: 'STRING' },
                      leftColumn: { type: 'STRING' },
                      rightTable: { type: 'STRING' },
                      rightColumn: { type: 'STRING' }
                    }
                  }
                },
                filters: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      column: { type: 'STRING' },
                      operator: { type: 'STRING', enum: ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN'] },
                      value: { type: 'STRING' }
                    }
                  }
                },
                limit: { type: 'INTEGER' }
              },
              required: ['operation', 'tables', 'fields']
            }
          },
          required: ['queryPlan']
        }
      });
    }

    if (activeConnection && (contextPlan.sources.capabilities || contextPlan.execution.mode === 'write')) {
      exposedFunctionDecls.push({
        name: 'execute_db_write',
        description: 'Performs controlled write/update actions (e.g. canceling an order) using an approved capability plan.',
        parameters: {
          type: 'OBJECT',
          properties: {
            writePlan: {
              type: 'OBJECT',
              properties: {
                capabilityName: { type: 'STRING' },
                operation: { type: 'STRING', enum: ['UPDATE', 'INSERT'] },
                table: { type: 'STRING' },
                values: { type: 'OBJECT' },
                filters: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      column: { type: 'STRING' },
                      operator: { type: 'STRING', enum: ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN'] },
                      value: { type: 'STRING' }
                    }
                  }
                }
              },
              required: ['capabilityName', 'operation', 'table', 'values']
            }
          },
          required: ['writePlan']
        }
      });
    }

    const geminiTools = exposedFunctionDecls.length > 0 ? [{ functionDeclarations: exposedFunctionDecls }] : undefined;

    console.log(`[API Chat] Dynamic Tool Exposure: ${exposedFunctionDecls.map(f => f.name).join(', ') || 'NONE'}`);

    // Call Gemini 2.5 Flash for conversational reasoning
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        tools: geminiTools as any
      },
    });

    let replyText = '';

    // Handle tool execution loop if requested by model
    if (response.functionCalls && response.functionCalls.length > 0 && activeConnection) {
      const call = response.functionCalls[0];
      console.log('\n' + '='.repeat(80));
      console.log(`[DB PIPELINE STAGE 1: TOOL SELECTION & INTENT]`);
      console.log(`  ➜ Model Function Call: ${call.name}`);
      console.log(`  ➜ Raw Arguments:        ${JSON.stringify(call.args, null, 2)}`);

      try {
        if (call.name === 'execute_db_read') {
          const { queryPlan } = call.args as any;
          console.log(`\n[DB PIPELINE STAGE 2: QUERY VALIDATION & RESOLUTION]`);
          console.log(`  ➜ Target Tables:        ${JSON.stringify(queryPlan?.tables)}`);
          console.log(`  ➜ Selected Fields:      ${JSON.stringify(queryPlan?.fields)}`);

          const validated = await queryValidator.validateAndResolve(workspaceId, activeConnection.id, queryPlan, sessionId);
          const compiled = queryCompiler.compile(validated, activeConnection.provider);

          console.log(`\n[DB PIPELINE STAGE 3: COMPILED SQL EXECUTION]`);
          console.log(`  ➜ Compiled SQL:         ${compiled}`);

          const startTime = Date.now();
          const rows = await readExecutor.execute(activeConnection.id, compiled);
          const durationMs = Date.now() - startTime;

          console.log(`\n[DB PIPELINE STAGE 4: RAW DATABASE RESULTS]`);
          console.log(`  ➜ Execution Latency:   ${durationMs}ms`);
          console.log(`  ➜ Rows Returned:       ${rows.length}`);
          console.log(`  ➜ Raw Rows Payload:    ${JSON.stringify(rows, null, 2)}`);
          console.log('='.repeat(80) + '\n');

          if (sessionId) {
            sessionMemory.addRecentResult(sessionId, 'db_read', rows);
            if (rows.length > 0) {
              const firstRow = rows[0];
              if (firstRow.customer_id) sessionMemory.setEntity(sessionId, 'customer_id', firstRow.customer_id);
              if (firstRow.order_id) sessionMemory.setEntity(sessionId, 'order_id', firstRow.order_id);
              if (firstRow.id && (queryPlan.tables[0] === 'orders' || queryPlan.tables[0] === 'customer_orders')) sessionMemory.setEntity(sessionId, 'order_id', firstRow.id);
            }
          }

          const secondResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              ...contents,
              response.candidates![0].content,
              {
                role: 'user',
                parts: [{
                  functionResponse: {
                    name: 'execute_db_read',
                    response: { result: rows }
                  }
                }]
              }
            ],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.7
            }
          });

          replyText = secondResponse.text?.trim() || "I retrieved the database info successfully.";
        } else if (call.name === 'execute_db_write') {
          const { writePlan } = call.args as any;
          const result = await writeExecutor.execute(workspaceId, activeConnection.id, writePlan, sessionId);

          const secondResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              ...contents,
              response.candidates![0].content,
              {
                role: 'user',
                parts: [{
                  functionResponse: {
                    name: 'execute_db_write',
                    response: { result }
                  }
                }]
              }
            ],
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.7
            }
          });

          replyText = secondResponse.text?.trim() || "I updated the database successfully.";
        }
      } catch (execErr: any) {
        console.error('[API Chat] Database tool execution failed:', execErr);
        const errorState = {
          success: false,
          error_type: execErr.message?.includes('breach') ? 'SECURITY_BLOCKED' : 'QUERY_FAILED',
          details: execErr.message || 'Database error occurred.'
        };

        const secondResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            ...contents,
            response.candidates![0].content,
            {
              role: 'user',
              parts: [{
                functionResponse: {
                  name: call.name,
                  response: errorState
                }
              }]
            }
          ],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7
          }
        });

        replyText = secondResponse.text?.trim() || "I encountered a database issue while attempting this action.";
      }
    } else {
      replyText = response.text?.trim() || "I'm right here. How can I help you next?";
    }

    // Generate follow-up suggestions
    let suggestedQuestions: string[] = [];
    try {
      const followUpPrompt = `Based on this latest answer from Natasha: "${replyText.slice(0, 300)}", generate exactly 3 short, natural spoken follow-up questions or prompts that a user might ask out loud. Return only the 3 questions separated by newlines, no numbers, no bullets, no quotes.`;
      const followUpRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: followUpPrompt,
      });
      const lines = (followUpRes.text || '')
        .split('\n')
        .map(l => l.replace(/^[-*0-9.)\s]+/, '').trim())
        .filter(l => l.length > 5 && l.length < 80)
        .slice(0, 3);
      if (lines.length > 0) {
        suggestedQuestions = lines;
      }
    } catch {
      suggestedQuestions = [
        'Can you summarize that in one sentence?',
        'Tell me more about this.',
        'What should we look at next?'
      ];
    }

    let audioBase64: string | undefined;

    // Generate TTS Audio if requested
    if (generateAudio && replyText) {
      try {
        const cleanForTts = replyText
          .replace(/[*#_`~[\]]/g, '')
          .replace(/\n+/g, ' ')
          .slice(0, 1500);

        const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
        const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

        const ttsResponse = await ai.models.generateContent({
          model: 'gemini-3.1-flash-tts-preview',
          contents: [{ parts: [{ text: cleanForTts }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
          },
        });

        audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } catch (ttsErr) {
        console.warn('Gemini TTS warning (client will use browser speech fallback):', ttsErr);
      }
    }

    res.json({
      text: replyText,
      audioBase64,
      suggestedQuestions,
      groundedDocs,
      metrics: rawResults.latencies,
      contextPlan,
      evidenceDecision: gateEvaluation.decision
    });
  } catch (error: unknown) {
    console.error('Chat error:', error);
    const errMessage = error instanceof Error ? error.message : 'Unknown server error';
    res.status(500).json({ error: errMessage });
  }
});

// Standalone Text-To-Speech (TTS) Endpoint
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceName = 'Kore' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required for TTS.' });
    }

    const ai = getGenAI();
    const cleanText = text.replace(/[*#_`~[\]]/g, '').replace(/\n+/g, ' ').slice(0, 1500);
    const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
    const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: selectedVoice },
          },
        },
      },
    });

    const audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBase64) {
      return res.status(500).json({ error: 'No audio generated by TTS model.' });
    }

    res.json({ audioBase64 });
  } catch (error: unknown) {
    console.error('TTS error:', error);
    const errMessage = error instanceof Error ? error.message : 'TTS generation failed';
    res.status(500).json({ error: errMessage });
  }
});

// Document Fast Analyzer Endpoint (Used to generate initial summaries on uploads)
app.post('/api/analyze-document', async (req, res) => {
  try {
    const { name, content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Document content is required.' });
    }

    const ai = getGenAI();
    const prompt = `Analyze this document named "${name}":
---
${content.slice(0, 8000)}
---

Provide:
1. A concise 1-to-2 sentence conversational spoken summary of what this document contains (written in Natasha's voice, no markdown, no bullets).
2. Exactly 3 intriguing spoken questions a user might ask Natasha about this document.

Format your output exactly as JSON:
{
  "summary": "...",
  "suggestedQuestions": ["...", "...", "..."]
}`;

    const analysisRes = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let result = { summary: '', suggestedQuestions: [] };
    try {
      result = JSON.parse(analysisRes.text || '{}');
    } catch {
      result = {
        summary: `Document ${name} containing ${Math.round(content.length / 4)} tokens.`,
        suggestedQuestions: [
          `What are the main points in ${name}?`,
          `Can you summarize ${name} for me?`,
          `What are the key takeaways?`
        ]
      };
    }

    res.json(result);
  } catch (error: unknown) {
    console.error('Document analysis error:', error);
    const errMessage = error instanceof Error ? error.message : 'Document analysis failed';
    res.status(500).json({ error: errMessage });
  }
});

// Audio Transcription Endpoint (Gemini 3.5 Transcribe)
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm' } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required.' });
    }

    const ai = getGenAI();
    const audioPart = {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: { parts: [audioPart, { text: 'Transcribe this voice audio accurately into plain text.' }] },
    });

    res.json({ transcript: response.text?.trim() || '' });
  } catch (error: unknown) {
    console.error('Transcribe error:', error);
    const errMessage = error instanceof Error ? error.message : 'Transcription failed';
    res.status(500).json({ error: errMessage });
  }
});

// --- DB-AGENT INTEGRATION ENDPOINTS ---

app.get('/api/db-agent/column-context', async (req, res) => {
  try {
    const tenantId = (req.query.tenantId as string) || 'default_tenant';
    const data = await dbAgentService.getDbColumnContext(tenantId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db-agent/logs', (req, res) => {
  res.json(dbAgentService.getLogs());
});

app.post('/api/db-agent/call-tool', async (req, res) => {
  try {
    const { tenantId = 'default_tenant', toolName, args, opts } = req.body;
    if (!toolName) {
      return res.status(400).json({ error: 'toolName is required.' });
    }
    const result = await dbAgentService.handleToolCall(tenantId, toolName, args, opts);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db-agent/connect-database', async (req, res) => {
  try {
    const { tenantId = 'default_tenant', config } = req.body;
    if (!config || !config.dialect) {
      return res.status(400).json({ error: 'Database connection config with dialect is required.' });
    }
    const result = await dbAgentService.registerNewDatabase(tenantId, config);
    res.json(result);
  } catch (err: any) {
    console.error('[API] Failed to connect & ingest new database:', err);
    res.status(500).json({ error: err.message || 'Failed to connect new database.' });
  }
});

// Gemini Live API WebSocket Server for Real-Time Duplex Voice Sessions
const wss = new WebSocketServer({ server, path: '/api/live' });

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('[Live API] Client connected to real-time voice stream');
  let session: any = null;
  let isSessionClosed = false;

  const closeLiveSession = () => {
    if (session && !isSessionClosed) {
      isSessionClosed = true;
      try {
        session.close();
      } catch (err) {
        console.warn('[Live API] Error closing session:', err);
      }
      session = null;
    }
  };

  clientWs.on('message', async (rawMsg: Buffer | string) => {
    try {
      const data = JSON.parse(rawMsg.toString());

      if (data.type === 'init') {
        const { voiceName = 'Kore', activeDocumentIds = [], workspaceId = 'default_workspace' } = data;
        const validVoices = ['Kore', 'Aoede', 'Zephyr', 'Puck', 'Fenrir', 'Charon'];
        const selectedVoice = validVoices.includes(voiceName) ? voiceName : 'Kore';

        const ai = getGenAI();

        // 1. Fetch relevant chunks to bootstrap the Live Session prompt
        let retrievedContext = '';
        const activeDocIds = Array.isArray(activeDocumentIds)
          ? activeDocumentIds
          : (activeDocumentIds ? [activeDocumentIds] : []);

        if (activeDocIds.length > 0) {
          try {
            console.log(`[Live API] Running pre-retrieval for Live session initialization on ${activeDocIds.length} active documents.`);
            const retrievalResult = await retrievalService.retrieve({
              query: 'summary overview key points policy architecture rules guidelines',
              workspaceId,
              activeDocumentIds: activeDocIds,
              limit: 10
            });
            const builder = new ContextBuilder();
            retrievedContext = builder.build(retrievalResult.chunks);
          } catch (err) {
            console.warn('[Live API] Failed loading pre-retrieved context for Live Session:', err);
          }
        }

        // 2. Fetch relevant database schema context if database connected
        let dbContextXml = '';
        try {
          const dbConnections = await intelRepo.listConnections(workspaceId);
          const activeConnection = dbConnections.find(c => c.status === 'ready');
          if (activeConnection) {
            console.log(`[Live API] Found active database connection: ${activeConnection.name}. Seeding Live prompt...`);

            // 1. Fetch lexical & semantic table matches for Live session query terms
            const lexicalMatches = await lexicalRetriever.retrieve(activeConnection.id, 'summary customer order shipment ticket details status');
            const semanticMatches = await semanticRetriever.retrieveTables(activeConnection.id, 'summary customer order shipment ticket details status', 0.20);

            // 2. Rank and merge candidates based on weighted scores
            const tableScores = new Map<string, number>();
            lexicalMatches.forEach(m => tableScores.set(m.tableName, (tableScores.get(m.tableName) || 0) + m.matchScore));
            semanticMatches.forEach(m => tableScores.set(m.tableName, (tableScores.get(m.tableName) || 0) + m.similarity * 3.0));

            const sortedTables = Array.from(tableScores.entries())
              .sort((a, b) => b[1] - a[1])
              .map(entry => entry[0]);

            // If no tables matched or database is small, include all user tables up to 10
            let targetTableNames = sortedTables.slice(0, 10);
            if (targetTableNames.length === 0) {
              const allTables = await intelRepo.getTablesMetadata(activeConnection.id);
              const userTables = allTables.filter(t =>
                !t.name.startsWith('db_') &&
                t.name !== 'documents' &&
                t.name !== 'document_chunks'
              );
              targetTableNames = userTables.slice(0, 10).map(t => t.name);
            }

            // 3. Retrieve matched capabilities with a low threshold
            const semanticCaps = await semanticRetriever.retrieveCapabilities(activeConnection.id, 'summary customer order shipment ticket details status', 0.20);

            // 4. Expand relationships and build context XML
            const expansion = await relationshipExpander.expand(activeConnection.id, targetTableNames);
            dbContextXml = await dbContextBuilder.buildContext(
              activeConnection.id,
              expansion.expandedTables,
              expansion.relationships,
              semanticCaps
            );
          }
        } catch (dbErr) {
          console.warn('[Live API] Failed loading database context for Live Session:', dbErr);
        }

        let systemPrompt = buildSystemPrompt(retrievedContext);
        if (dbContextXml) {
          systemPrompt += `\n\n# 6. DATABASE INTELLIGENCE GROUNDING
You have live read-access to the customer's database structures below.
Explain database details conversationally, warm, and natural.

--- DATABASE SCHEMA CONTEXT ---
${dbContextXml}
--- END OF DATABASE SCHEMA CONTEXT ---
`;
        }

        console.log(`[Live API] Connecting Gemini Live session with voice: ${selectedVoice}`);

        session = await ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: selectedVoice },
              },
            },
            systemInstruction: systemPrompt,
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== WebSocket.OPEN) return;

              // Check if interrupted by user
              if (message.serverContent?.interrupted) {
                clientWs.send(JSON.stringify({ type: 'interrupted' }));
              }

              // Check user input transcription
              const sc = message.serverContent as any;
              if (sc?.inputAudioTranscription?.parts) {
                const userText = sc.inputAudioTranscription.parts.map((p: any) => p.text || '').join('');
                if (userText) {
                  clientWs.send(JSON.stringify({ type: 'user_transcription', text: userText }));
                }
              }

              // Check model output transcription
              if (sc?.outputAudioTranscription?.parts) {
                const modelText = sc.outputAudioTranscription.parts.map((p: any) => p.text || '').join('');
                if (modelText) {
                  clientWs.send(JSON.stringify({ type: 'model_transcription', text: modelText }));
                }
              }

              // Check model turn parts (audio and text)
              const parts = message.serverContent?.modelTurn?.parts;
              if (parts) {
                for (const part of parts) {
                  if (part.inlineData?.data) {
                    clientWs.send(JSON.stringify({
                      type: 'audio',
                      audio: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000'
                    }));
                  }
                  if (part.text) {
                    clientWs.send(JSON.stringify({ type: 'model_text', text: part.text }));
                  }
                }
              }

              // Check turn complete
              if (message.serverContent?.turnComplete) {
                clientWs.send(JSON.stringify({ type: 'turn_complete' }));
              }
            },
            onclose: (e) => {
              console.log('[Live API] Gemini session closed:', e);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'session_closed' }));
              }
            },
            onerror: (err) => {
              console.error('[Live API] Gemini session error:', err);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'error', message: err?.message || 'Live session error' }));
              }
            }
          }
        });

        clientWs.send(JSON.stringify({ type: 'ready' }));
      } else if (data.type === 'audio' && session) {
        // Send continuous 16kHz PCM audio
        session.sendRealtimeInput({
          audio: {
            data: data.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (data.type === 'text' && session) {
        // Send real-time text prompt
        session.sendRealtimeInput({
          text: data.text,
        });
      } else if (data.type === 'close') {
        closeLiveSession();
      }
    } catch (err: unknown) {
      console.error('[Live API] Message handling error:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: errMsg }));
      }
    }
  });

  clientWs.on('close', () => {
    console.log('[Live API] Client disconnected');
    closeLiveSession();
  });

  clientWs.on('error', (err) => {
    console.warn('[Live API] Client WebSocket error:', err);
    closeLiveSession();
  });
});

// Vite middleware & Production Serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Natasha Voice Agent server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
