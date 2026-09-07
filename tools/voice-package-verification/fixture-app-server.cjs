// Scripted protocol fixture. This is not Codex and performs no inference/auth.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const root = process.argv[2];
const mode = process.argv[3];
const statePath = path.join(root, 'fixture-app-server-state.json');
const read = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { threads: {}, starts: 0, turns: 0, reads: 0 };
const save = state => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const response = (id, result) => send({ id, result });
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const params = message.params ?? {};
  const state = read();
  switch (message.method) {
    case 'initialize': response(message.id, { userAgent: 'scripted-voice-verification-fixture' }); break;
    case 'account/read': response(message.id, { account: mode === 'signed-out' ? null : { type: 'chatgpt' } }); break;
    case 'config/read': response(message.id, { config: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } }); break;
    case 'thread/start': {
      const thread = { id: `fixture-thread-${++state.starts}`, status: { type: 'idle' }, turns: [] };
      state.threads[thread.id] = thread; save(state);
      response(message.id, { thread, sandbox: { type: 'workspaceWrite' }, approvalPolicy: 'on-request' }); break;
    }
    case 'thread/name/set': state.threads[params.threadId].name = params.name; save(state); response(message.id, {}); break;
    case 'thread/read': state.reads++; save(state); response(message.id, { thread: state.threads[params.threadId] }); break;
    case 'turn/start': {
      const thread = state.threads[params.threadId];
      const turnId = `fixture-turn-${++state.turns}`;
      const artifact = path.join(params.cwd, `fixture-result-${state.turns}.txt`);
      // A predetermined fixture action, not interpretation of a user instruction.
      fs.writeFileSync(artifact, `Fixture output for ${params.clientUserMessageId}\n`, { mode: 0o600 });
      const answer = {
        title: 'Field Theory - Fixture Voice result', status: 'completed',
        summary: 'Scripted fixture wrote its expected workspace artifact.',
        finalResponse: `Fixture transport result: ${artifact}`, question: null,
      };
      const turn = { id: turnId, status: 'completed', items: [
        { type: 'userMessage', clientId: params.clientUserMessageId },
        { type: 'agentMessage', phase: 'final_answer', text: JSON.stringify(answer) },
      ] };
      thread.turns.push(turn); save(state);
      response(message.id, { turn: { id: turnId } });
      setImmediate(() => {
        send({ method: 'turn/started', params: { threadId: thread.id, turn: { id: turnId } } });
        setImmediate(() => send({ method: 'turn/completed', params: { threadId: thread.id, turn } }));
      });
      break;
    }
    default: send({ id: message.id, error: { code: -32601, message: `Unexpected fixture method: ${message.method}` } });
  }
});
input.on('close', () => process.exit(0));
