import { DocumentFile } from '../types';

export const SAMPLE_DOCUMENTS: DocumentFile[] = [
  {
    id: 'sample-readme',
    name: 'PROJECT_AURORA_README.md',
    type: 'markdown',
    size: 2450,
    uploadedAt: Date.now() - 3600000,
    enabled: true,
    summary: 'Overview of Aurora distributed event engine including architecture, 3-tier caching, and deployment instructions.',
    suggestedQuestions: [
      'What are the three tiers in Aurora caching architecture?',
      'How do I configure the Redis replication cluster?',
      'What is the maximum throughput supported by Aurora?'
    ],
    content: `# Project Aurora: Next-Gen Event Processing Engine

## Overview
Project Aurora is a distributed, low-latency streaming pipeline designed for financial real-time telemetry and anomaly detection. It processes up to 250,000 events per second with sub-five-millisecond p99 latency.

## Architecture
Aurora uses a decoupled three-tier caching pipeline:
1. **L1 Hot Cache**: In-memory ring buffer using Lock-Free RingBuffer structures (capacity: 50,000 items, retention: 200 milliseconds).
2. **L2 Warm Cache**: Redis 7.2 Sentinel cluster with active-active regional replication and sub-millisecond local reads.
3. **L3 Cold Archive**: Partitioned Parquet files on Google Cloud Storage compressed via Snappy.

## Deployment & Configuration
- **Prerequisites**: Node.js version 22 or higher, Redis cluster 7.2+, and Docker 26+.
- **Environment Variables**:
  - \`AURORA_PORT\`: Server listen port (default: 8080).
  - \`AURORA_CLUSTER_MODE\`: Set to \`distributed\` for production or \`standalone\` for local development.
  - \`AURORA_REPLICATION_FACTOR\`: Recommended minimum of 3 nodes in production.
- **Start Command**: \`npm run start:cluster\`

## Known Limitations
Aurora does not currently support out-of-order event stitching exceeding a four-hour timestamp drift. For historic telemetry older than twenty-four hours, queries must be routed to the BigQuery Cold Pipeline.`
  },
  {
    id: 'sample-roadmap',
    name: 'Q3_PRODUCT_STRATEGY.txt',
    type: 'text',
    size: 1680,
    uploadedAt: Date.now() - 7200000,
    enabled: true,
    summary: 'Executive strategic goals for Q3 covering mobile voice expansion, SOC2 Type II certification, and European data residency.',
    suggestedQuestions: [
      'What are our top three engineering deliverables for Q3?',
      'When is the SOC2 Type II audit scheduled?',
      'What is the budget allocated for Frankfurt data residency?'
    ],
    content: `Q3 PRODUCT & ENGINEERING STRATEGY MEMORANDUM
Confidential - Internal Team Only

Objective 1: Mobile Voice First Experience
- Target Launch: August 15th
- Primary focus: Sub-300ms speech response times using neural compression.
- Key Milestone: Beta release to 5,000 pilot enterprise users across North America.

Objective 2: Enterprise Security & Compliance
- Target Date: September 30th
- Scope: Complete SOC2 Type II audit and HIPAA compliance certification.
- Lead auditor: Schellman & Company.
- Action items: Implement automated audit logs, biometric session validation, and customer-managed KMS keys.

Objective 3: European Regional Data Residency
- Target Launch: September 1st
- Data Centers: Frankfurt (eu-central-1) and Dublin (eu-west-1).
- Total Infrastructure Budget: 180,000 USD for the fiscal quarter.
- Requirements: Zero telemetry data transfer outside EU boundaries without explicit tenant consent.`
  }
];
