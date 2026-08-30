import { IngestionWorker } from './worker';

const worker = new IngestionWorker();

// Handle termination gracefully
process.on('SIGINT', () => {
  console.log('[Worker Runner] Gracefully shutting down worker...');
  worker.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Worker Runner] Gracefully shutting down worker...');
  worker.stop();
  process.exit(0);
});

console.log('[Worker Runner] Booting Ingestion Worker...');
worker.start().catch(err => {
  console.error('[Worker Runner] Fatal error running ingestion worker:', err);
  process.exit(1);
});
