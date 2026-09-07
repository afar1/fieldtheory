// Runs using Electron's embedded Node, loading only the compiled Voice modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const archive = process.argv[2];
const runDir = process.argv[3];
assert(process.versions.electron, 'Must run inside the actual Electron runtime.');
assert.equal(process.env.ELECTRON_RUN_AS_NODE, '1');
assert.deepEqual(fs.readdirSync(process.env.PATH), [], 'Runtime PATH must contain no executables.');
assert.equal(process.env.HOME, undefined);
assert.equal(process.env.CODEX_HOME, undefined);
const { VoiceWorkManager } = require(path.join(archive, 'electron-dist/main/voiceWorkManager.js'));
const runner = require(path.join(archive, 'electron-dist/main/voiceCodexRunner.js'));
const checks = [];
const processes = [];
const managers = [];
const workspace = path.join(runDir, 'workspace');
fs.mkdirSync(workspace);
const stateDirectory = path.join(runDir, 'worker-state');
const serverState = () => JSON.parse(fs.readFileSync(path.join(runDir, 'fixture-app-server-state.json'), 'utf8'));
const fixtureOptions = (mode = 'ready') => ({
  binaryPath: process.execPath, homeDir: runDir, pathEnv: '', applicationDirs: [],
  requestTimeoutMs: 2000, turnTimeoutMs: 5000,
  spawnFn(command, args, options) {
    assert.equal(command, process.execPath);
    assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    assert(options.cwd === workspace || options.cwd === runDir);
    processes.push({ requestedExecutable: command, requestedArgs: args, fixture: true, mode });
    return spawn(process.execPath, [path.join(__dirname, 'fixture-app-server.cjs'), runDir, mode], { ...options, env: { ...process.env } });
  },
});
async function until(predicate, label) {
  const deadline = Date.now() + 7000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const fixture = {
  owner: 'fixture-account', enabled: false, generation: 0, jobs: [], calls: [], channels: [], failComplete: false,
  settings() { return { schema_version: 1, enabled: this.enabled, generation: this.generation, enabled_at: new Date().toISOString(), server_now: new Date().toISOString() }; },
  async rpc(name, args) {
    this.calls.push({ name, args });
    let data = { ok: true };
    if (name === 'voice_delivery_configure') {
      if (this.enabled !== args.p_enabled) this.generation++;
      this.enabled = args.p_enabled; data = { ...this.settings(), applied: true };
    } else if (name === 'voice_delivery_status') data = this.settings();
    else if (name === 'voice_jobs_claim') data = { settings: this.settings(), jobs: this.jobs.splice(0, 1), next_wake_at: null, server_now: new Date().toISOString() };
    else assert(['voice_jobs_record_dispatch', 'voice_jobs_begin_dispatch', 'voice_jobs_complete', 'voice_jobs_renew'].includes(name), `Unexpected RPC ${name}`);
    if (name === 'voice_jobs_complete' && this.failComplete) return { data: null, error: { code: 'fixture-network-failure' } };
    return { data, error: null };
  },
  channel(name, config) {
    const channel = {
      name, config, removed: false,
      on(kind, filter, callback) { assert.equal(kind, 'broadcast'); assert.equal(filter.event, 'voice_jobs_changed'); this.push = callback; return this; },
      subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; },
    };
    this.channels.push(channel); return channel;
  },
  async removeChannel(channel) { channel.removed = true; return 'ok'; },
  push() { for (const channel of this.channels) if (!channel.removed) channel.push(); },
};
const client = {
  rpc: fixture.rpc.bind(fixture), channel: fixture.channel.bind(fixture), removeChannel: fixture.removeChannel.bind(fixture),
};
function manager(directory = stateDirectory) {
  const value = new VoiceWorkManager({
    stateDirectory: directory,
    auth: { getSession: () => fixture.owner ? { user: { id: fixture.owner } } : null, getSupabaseClient: () => client },
    inspectRuntime: () => runner.inspectVoiceCodexRuntime(fixtureOptions()),
    runRequest: request => runner.runVoiceRequest(request, fixtureOptions()),
    recoverRequest: request => runner.recoverVoiceRequest(request, fixtureOptions()),
  });
  managers.push(value); return value;
}
const receipt = () => JSON.parse(fs.readFileSync(path.join(stateDirectory, 'fixture-account.json'), 'utf8'));
function job(id, overrides = {}) {
  return {
    job_id: id, user_id: 'fixture-account', generation: fixture.generation, transcript_id: `transcript-${id}`,
    text: 'Verification fixture input; no model is invoked.', previous_text: null, previous_thread_id: null,
    dispatch_key: `voice:${id}`, thread_id: null, dispatch_started_at: null, lease_token: `lease-${id}`,
    lease_expires_at: new Date(Date.now() + 90000).toISOString(), ...overrides,
  };
}
(async () => {
  try {
    const missing = await runner.inspectVoiceCodexRuntime({ homeDir: runDir, applicationDirs: [], pathEnv: '' });
    assert.equal(missing.status, 'not_installed');
    const signedOut = await runner.inspectVoiceCodexRuntime(fixtureOptions('signed-out'));
    assert.equal(signedOut.status, 'sign_in_required');
    checks.push('Missing executable and scripted signed-out runtime fail closed.');
    let worker = manager();
    assert.equal(worker.getState().status, 'signed_out');
    await worker.authChanged();
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.channels.length, 0);
    await worker.updateSettings({ workspacePath: workspace });
    await worker.updateSettings({ enabled: true });
    await until(() => worker.getState().status === 'ready', 'initial private catch-up');
    assert.equal(fixture.channels[0].name, 'voice-jobs:fixture-account');
    assert.deepEqual(fixture.channels[0].config, { config: { private: true } });
    checks.push('Explicit enable privately subscribes and completes one empty catch-up.');

    const first = job('first'); fixture.jobs.push(first); fixture.push();
    await until(() => receipt().attempts.first?.published && worker.getState().status === 'ready', 'event to published outcome');
    assert.equal(worker.getState().lastTask.status, 'completed');
    assert.match(fs.readFileSync(path.join(workspace, 'fixture-result-1.txt'), 'utf8'), /voice:first/);
    assert.equal(receipt().attempts.first.outcome.finalResponse, worker.getState().lastTask.finalResponse);
    assert.equal(fs.statSync(path.join(stateDirectory, 'fixture-account.json')).mode & 0o777, 0o600);
    const firstCalls = fixture.calls.filter(call => call.args.p_job_id === 'first').map(call => call.name);
    assert(firstCalls.indexOf('voice_jobs_record_dispatch') < firstCalls.indexOf('voice_jobs_begin_dispatch'));
    assert(firstCalls.indexOf('voice_jobs_begin_dispatch') < firstCalls.indexOf('voice_jobs_complete'));
    checks.push('Push event traverses compiled manager and runner into a scripted child process, writes fixture artifact, and persists ordered completion receipts.');

    fixture.jobs.push(first); fixture.push();
    await until(() => !fixture.jobs.length && worker.getState().status === 'ready', 'duplicate catch-up');
    assert.equal(serverState().turns, 1);
    checks.push('Duplicate job does not start another scripted turn.');

    fixture.failComplete = true; fixture.jobs.push(job('second')); fixture.push();
    await until(() => receipt().attempts.second?.outcome && worker.getState().status === 'error', 'failed receipt publication');
    assert.equal(receipt().attempts.second.published, undefined);
    assert.equal(serverState().turns, 2);
    worker.stop(); fixture.failComplete = false;
    worker = manager(); await worker.authChanged();
    await until(() => receipt().attempts.second?.published && worker.getState().status === 'ready', 'restart outcome flush');
    assert.equal(serverState().turns, 2);
    checks.push('Restart republishes retained completion after fixture transport failure without rerunning work.');

    await worker.updateSettings({ enabled: false });
    assert.equal(receipt().settings.enabled, false);
    const turnsBeforeDisablePush = serverState().turns;
    fixture.jobs.push(job('paused')); fixture.push();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(serverState().turns, turnsBeforeDisablePush);
    fixture.jobs.length = 0;
    checks.push('Disable persists and stops subsequent fixture pushes.');

    const priorOutcome = receipt().attempts.first.outcome;
    worker.stop();
    const recovering = manager(path.join(runDir, 'new-worker-state'));
    await recovering.authChanged(); await recovering.updateSettings({ workspacePath: workspace });
    await recovering.updateSettings({ enabled: true });
    await until(() => recovering.getState().status === 'ready', 'new worker ready');
    fixture.jobs.push(job('recovery-first', { dispatch_key: 'voice:first', thread_id: priorOutcome.threadId, dispatch_started_at: new Date().toISOString() })); fixture.push();
    await until(() => recovering.getState().lastTask?.status === 'completed' && recovering.getState().status === 'ready', 'read-only recovery');
    assert.equal(serverState().turns, 2); assert.equal(serverState().reads, 1);
    checks.push('New worker recovers prior scripted task by thread/read with no additional turn.');
    fixture.owner = null; await recovering.authChanged();
    assert.equal(recovering.getState().status, 'signed_out');
    assert.equal(recovering.getState().lastTask, undefined);
    checks.push('Sign-out disconnects delivery and removes prior account task from visible state.');

    const report = {
      passed: true, evidenceKind: 'Electron runtime with fixture ASAR and scripted transports',
      fullAppPackage: false, realCodexOrModel: false, realSupabaseOrPhone: false,
      executable: process.execPath, versions: process.versions, runtimePath: process.env.PATH,
      runtimePathEntries: fs.readdirSync(process.env.PATH), archive, checks,
      fixtureProcessInvocations: processes, fixtureServerCounters: { starts: serverState().starts, turns: serverState().turns, reads: serverState().reads },
      rpcCalls: fixture.calls, importedModules: Object.keys(require.cache).filter(file => file.includes('.asar')),
    };
    assert(report.importedModules.every(file => !/\/(index|authManager)\.js$/.test(file)));
    fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, electron: process.versions.electron, node: process.versions.node, checks: checks.length, runtimePathHasExecutables: false, realCodexOrModel: false, fullAppPackage: false }));
  } finally { for (const worker of managers) worker.stop(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
