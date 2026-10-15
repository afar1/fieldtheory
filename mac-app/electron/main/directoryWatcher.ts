import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as nativeWatcher from '@parcel/watcher';

// Serialize native subscription changes: a root removed during startup must not
// tear down a shared backend while another subscription is being established.
let subscriptionQueue: Promise<unknown> = Promise.resolve();
function updateSubscriptions<T>(change: () => Promise<T>): Promise<T> {
  const pending = subscriptionQueue.then(change);
  subscriptionQueue = pending.catch(() => undefined);
  return pending;
}

type WatchOptions = {
  depth?: number;
  ignoreInitial?: boolean;
  ignorePermissionErrors?: boolean;
  ignored?: (filePath: string, stats?: fs.Stats) => boolean;
  awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number };
};

// FSEvents watches a directory tree without retaining a descriptor for every file.
// Keep the managers' add/change/unlink contract and write-stability handling here.
export class FSWatcher extends EventEmitter {
  private closed = false;
  private known = new Map<string, fs.Stats>();
  private timers = new Map<string, NodeJS.Timeout>();
  private subscriptions: nativeWatcher.AsyncSubscription[] = [];
  private initialization: Promise<void>;
  private shutdown?: Promise<void>;
  private roots: string[];

  constructor(roots: string | string[], private options: WatchOptions = {}) {
    super();
    this.roots = [...new Set((Array.isArray(roots) ? roots : [roots]).map(root => path.resolve(root)))];
    this.initialization = this.initialize().catch(error => this.report(error));
  }

  private report(error: unknown): void {
    if (this.closed) return;
    if (this.options.ignorePermissionErrors && ['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    this.emit('error', error);
  }

  private included(root: string, candidate: string, stats?: fs.Stats): boolean {
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return false;
    if (relative && this.options.depth !== undefined && relative.split(path.sep).length > this.options.depth + 1) return false;
    // Apply directory exclusions to descendants too (e.g. node_modules).
    const parts = relative.split(path.sep);
    for (let i = 1; i < parts.length; i++) {
      if (this.options.ignored?.(path.join(root, ...parts.slice(0, i)))) return false;
    }
    return !this.options.ignored?.(candidate, stats);
  }

  private async scan(root: string, directory: string): Promise<void> {
    if (this.closed) return;
    const stats = await fs.promises.stat(directory);
    if (!this.included(root, directory, stats)) return;
    this.known.set(directory, stats);
    if (!stats.isDirectory()) return;
    if (directory !== root && this.options.depth !== undefined && path.relative(root, directory).split(path.sep).length > this.options.depth) return;
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (this.closed) return;
      // Do not follow links out of the subscribed tree or recurse through cycles.
      if (entry.isSymbolicLink()) continue;
      try { await this.scan(root, path.join(directory, entry.name)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.report(error);
      }
    }
  }

  private async initialize(): Promise<void> {
    for (const root of this.roots) {
      if (this.closed) return;
      const queued: nativeWatcher.Event[] = [];
      let ready = false;
      const nativeRoot = await fs.promises.realpath(root);
      const subscription = await updateSubscriptions(() => nativeWatcher.subscribe(nativeRoot, (error, nativeEvents) => {
        const events = nativeEvents.map(event => ({ ...event, path: path.join(root, path.relative(nativeRoot, event.path)) }));
        if (error) { this.report(error); return; }
        if (!ready) queued.push(...events);
        else for (const event of events) this.schedule(root, event);
      }, process.platform === 'darwin' ? { backend: 'fs-events' } : {}));
      this.subscriptions.push(subscription);
      if (this.closed) return;
      await this.scan(root, root);
      ready = true;
      for (const event of queued) this.schedule(root, event);
    }
    if (!this.closed) this.emit('ready');
  }

  private schedule(root: string, event: nativeWatcher.Event): void {
    if (this.closed) return;
    const previous = this.known.get(event.path);
    if (!this.included(root, event.path, previous)) return;
    const pending = this.timers.get(event.path);
    if (pending) clearTimeout(pending);
    const delay = this.options.awaitWriteFinish?.stabilityThreshold ?? 0;
    this.timers.set(event.path, setTimeout(() => {
      this.timers.delete(event.path);
      void this.deliver(root, event.path).catch(error => this.report(error));
    }, delay));
  }

  private async deliver(root: string, candidate: string): Promise<void> {
    const previous = this.known.get(candidate);
    let stats: fs.Stats;
    try { stats = await fs.promises.stat(candidate); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (this.closed || !previous) return;
      this.known.delete(candidate);
      this.emit(previous.isDirectory() ? 'unlinkDir' : 'unlink', candidate);
      return;
    }
    if (this.closed || !this.included(root, candidate, stats)) return;
    const stability = this.options.awaitWriteFinish;
    if (stats.isFile() && stability) {
      await new Promise(resolve => setTimeout(resolve, stability.pollInterval));
      if (this.closed || this.timers.has(candidate)) return;
      const current = await fs.promises.stat(candidate).catch(() => undefined);
      if (!current || current.size !== stats.size || current.mtimeMs !== stats.mtimeMs) {
        this.schedule(root, { path: candidate, type: 'update' });
        return;
      }
      stats = current;
    }
    if (this.closed) return;
    this.known.set(candidate, stats);
    if (!previous) this.emit(stats.isDirectory() ? 'addDir' : 'add', candidate);
    else if (!stats.isDirectory()) this.emit('change', candidate);
  }

  getWatched(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [candidate, stats] of this.known) {
      if (stats.isDirectory()) result[candidate] ??= [];
      else (result[path.dirname(candidate)] ??= []).push(path.basename(candidate));
    }
    return result;
  }

  close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.known.clear();
    this.shutdown ??= this.initialization.then(async () => {
      await Promise.all(this.subscriptions.map(subscription => updateSubscriptions(() => subscription.unsubscribe())));
      this.subscriptions = [];
      this.known.clear();
    });
    return this.shutdown;
  }
}

export function watch(roots: string | string[], options?: WatchOptions): FSWatcher {
  return new FSWatcher(roots, options);
}
