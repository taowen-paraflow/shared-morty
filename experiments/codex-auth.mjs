// Run the real pinned Codex binary against a localhost OAuth fixture, never a real account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-codex-protocol-'));
const account = 'account-synthetic-fixture';
const jwt = marker => [
  Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({
    sub: 'user-synthetic-fixture', email: 'fixture@example.invalid',
    exp: Math.floor(Date.now() / 1000) + 3600, marker,
    'https://api.openai.com/auth': { chatgpt_account_id: account, chatgpt_plan_type: 'plus' },
  })).toString('base64url'),
  'synthetic-signature',
].join('.');
const oldToken = jwt('old'), newToken = jwt('rotated');
const externallyRefreshedToken = jwt('external-refreshed');
const requests = [];
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url, body, authorization: request.headers.authorization });
  response.setHeader('content-type', 'application/json');
  if (request.url === '/oauth/token') {
    const payload = JSON.parse(body);
    assert.equal(payload.grant_type, 'refresh_token');
    assert.equal(payload.refresh_token, 'synthetic-refresh-old');
    response.end(JSON.stringify({
      access_token: newToken, id_token: newToken, refresh_token: 'synthetic-refresh-new',
      expires_in: 3600, token_type: 'Bearer',
    }));
  } else if (request.url.includes('/responses')) {
    if (request.headers.authorization === `Bearer ${newToken}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { message: 'Synthetic expired access token', type: 'authentication_error', code: 'invalid_api_key' } }));
    } else {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: { message: 'Synthetic stop after refreshed retry', type: 'invalid_request_error' } }));
    }
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'Local fixture does not implement this endpoint' } }));
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;

function appServer(name, seed) {
  const home = path.join(base, name);
  const codexHome = path.join(home, '.codex');
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'cli_auth_credentials_store = "file"',
    `chatgpt_base_url = "${origin}/backend-api"`,
  ].join('\n'));
  if (seed) fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify(seed), { mode: 0o600 });
  const pending = new Map();
  const notifications = [];
  const hostRefreshRequests = [];
  let stderr = '', nextId = 0;
  const child = spawn('codex', ['app-server'], {
    env: {
      PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome,
      CODEX_REFRESH_TOKEN_URL_OVERRIDE: `${origin}/oauth/token`,
      RUST_LOG: 'error',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16_000); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.method) {
      notifications.push(value);
      if (value.method === 'account/chatgptAuthTokens/refresh' && value.id !== undefined) {
        hostRefreshRequests.push({ method: value.method, params: value.params });
        child.stdin.write(JSON.stringify({ id: value.id, result: {
          accessToken: externallyRefreshedToken, chatgptAccountId: account, chatgptPlanType: 'plus',
        } }) + '\n');
      }
    }
    else if (pending.has(value.id)) {
      const waiter = pending.get(value.id);
      pending.delete(value.id);
      clearTimeout(waiter.timer);
      if (value.error) waiter.reject(new Error(JSON.stringify(value.error)));
      else waiter.resolve(value.result);
    }
  });
  child.on('exit', (code, signal) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`Codex exited: ${code}/${signal}; ${stderr}`));
    }
    pending.clear();
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out; ${stderr}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  const initialize = async () => {
    await rpc('initialize', {
      clientInfo: { name: 'shared_morty_fixture', version: '0.0.1' },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.stdin.end();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    try { await exited; } finally { clearTimeout(timer); lines.close(); }
  };
  const waitFor = async predicate => {
    const existing = notifications.find(predicate);
    if (existing) return existing;
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const message = notifications.find(predicate);
      if (message) return message;
    }
    throw new Error(`Notification timeout; methods=${notifications.map(n => n.method).join(',')}; ${stderr}`);
  };
  return { home, codexHome, rpc, initialize, stop, notifications, hostRefreshRequests, waitFor };
}

const results = [];
const managed = appServer('managed', {
  auth_mode: 'chatgpt',
  tokens: { id_token: oldToken, access_token: oldToken, refresh_token: 'synthetic-refresh-old', account_id: account },
  last_refresh: new Date().toISOString(),
});
let external;
try {
  await managed.initialize();
  const before = await managed.rpc('account/read', { refreshToken: false });
  assert.equal(before.account?.type, 'chatgpt');
  const countBefore = requests.filter(r => r.path === '/oauth/token').length;
  const refreshed = await managed.rpc('account/read', { refreshToken: true });
  assert.equal(refreshed.account?.type, 'chatgpt');
  await managed.stop();
  const updated = JSON.parse(fs.readFileSync(path.join(managed.codexHome, 'auth.json')));
  const refreshCalls = requests.filter(r => r.path === '/oauth/token').length - countBefore;
  assert.equal(refreshCalls, 1, 'account/read refreshToken:true must issue a refresh');
  assert.equal(updated.tokens.access_token, newToken);
  assert.equal(updated.tokens.refresh_token, 'synthetic-refresh-new');
  results.push({ test: 'managed-auth-read-forces-refresh-and-persists', passed: true, refreshCalls, persistedAfterProcessExit: true });

  external = appServer('external');
  await external.initialize();
  await external.rpc('account/login/start', {
    type: 'chatgptAuthTokens', accessToken: newToken, chatgptAccountId: account, chatgptPlanType: 'plus',
  });
  const count = requests.filter(r => r.path === '/oauth/token').length;
  const externalAccount = await external.rpc('account/read', { refreshToken: true });
  assert.equal(externalAccount.account?.type, 'chatgpt');
  assert.equal(requests.filter(r => r.path === '/oauth/token').length, count, 'External mode must not use the managed refresh endpoint');
  const thread = await external.rpc('thread/start', {
    model: 'gpt-5.4', cwd: external.home, approvalPolicy: 'never', sandbox: 'read-only',
  });
  await external.rpc('turn/start', {
    threadId: thread.thread.id, input: [{ type: 'text', text: 'Synthetic local fixture only.' }],
  });
  await external.waitFor(value => value.method === 'turn/completed');
  assert(external.hostRefreshRequests.length >= 1, '401 must invoke host refresh callback');
  const modelRequests = requests.filter(r => r.path.includes('/responses'));
  assert(modelRequests.some(r => r.authorization === `Bearer ${newToken}`));
  assert(modelRequests.some(r => r.authorization === `Bearer ${externallyRefreshedToken}`), 'Original request should retry with host-supplied new access token');
  assert.equal(requests.filter(r => r.path === '/oauth/token').length, count, 'External host recovery must not refresh a native refresh token');
  await external.stop();
  const externalAuthFile = path.join(external.codexHome, 'auth.json');
  const persisted = fs.existsSync(externalAuthFile) ? fs.readFileSync(externalAuthFile, 'utf8') : '';
  assert(!persisted.includes('synthetic-refresh'));
  results.push({ test: 'external-auth-accepts-access-token-without-refresh-token', passed: true, nativeRefreshCalls: 0, authFileExists: fs.existsSync(externalAuthFile) });
  results.push({ test: 'external-auth-401-host-callback-and-retry', passed: true, callbacks: external.hostRefreshRequests.length, modelRequests: modelRequests.length, modelServer: 'localhost fixture' });

  const output = {
    codexVersion: '0.154.0', results,
    endpoint: 'localhost-only OAuth fixture',
    limitations: 'Real binary and file writes, synthetic OAuth/model server. Does not prove real account acceptance, multi-user OAuth policy, callback timeout behavior, or Morty integration.',
  };
  console.log(JSON.stringify(output, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Real Codex protocol fixture\n\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n`);
} finally {
  await managed.stop();
  if (external) await external.stop();
  server.closeAllConnections();
  server.close();
}
