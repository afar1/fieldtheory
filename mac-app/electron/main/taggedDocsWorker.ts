// Off-main-thread tagged-docs scanner. Runs as an Electron utilityProcess so the
// file crawl (stat + read + parse + hash of a potentially huge library tree)
// never blocks the browser main thread. It is stateless: it receives a job
// (roots, email, freshness ledger) and posts back parse results — the MAIN
// process owns every SQLite write. See TaggedDocsManager.runScan().
//
// Imports only the pure scan core from taggedDocsScan (scanRoots and its
// helpers touch fs/crypto only, not the DB or chokidar).
import { scanRoots, type ScanLedgerEntry } from './taggedDocsScan';

interface ReconcileMessage {
  type: 'reconcile';
  jobId: number;
  roots: string[];
  email: string | null;
  ledger: Map<string, ScanLedgerEntry>;
  maxReadBytes?: number;
}

// In a utilityProcess child, messages arrive on process.parentPort.
const parentPort = (process as unknown as { parentPort?: NodeJS.EventEmitter & { postMessage(value: unknown): void } }).parentPort;

parentPort?.on('message', (event: { data?: ReconcileMessage } | ReconcileMessage) => {
  // utilityProcess delivers the payload on event.data; tolerate either shape.
  const msg = (event as { data?: ReconcileMessage }).data ?? (event as ReconcileMessage);
  if (!msg || msg.type !== 'reconcile') return;

  void scanRoots({ roots: msg.roots, email: msg.email, ledger: msg.ledger, maxReadBytes: msg.maxReadBytes })
    .then((out) => parentPort.postMessage({ type: 'result', jobId: msg.jobId, out }))
    .catch((err: unknown) => parentPort.postMessage({
      type: 'error',
      jobId: msg.jobId,
      message: err instanceof Error ? err.message : String(err),
    }));
});
