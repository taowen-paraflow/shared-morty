// Real GitHub API/Actions experiments. All credential-looking values are synthetic.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const id = process.env.EXPERIMENT_ID;
const repo = process.env.GH_REPOSITORY;
const branch = `sm-exp-state-${id}`;
const lock = `sm-exp-lock-${id}`;
const root = `/repos/${repo}`;
const key = crypto.createHash('sha256').update(`PUBLIC-SYNTHETIC-FIXTURE-${id}`).digest();
const aad = Buffer.from(`${repo}:${id}:fixture`);
const summary = (name, data) => {
  console.log(JSON.stringify({ experiment: name, ...data }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${name}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`);
  }
};
async function api(method, endpoint, body, allowed = []) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok && !allowed.includes(response.status)) {
    throw new Error(`${method} ${endpoint}: ${response.status} ${value?.message ?? ''}`);
  }
  return { status: response.status, value };
}
function encrypt(value, encryptionKey = key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { schema: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decrypt(envelope, encryptionKey = key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString());
}
async function readFile(name = 'codex.enc') {
  const { value } = await api('GET', `${root}/contents/${name}?ref=${branch}`);
  return { sha: value.sha, body: decrypt(JSON.parse(Buffer.from(value.content, 'base64').toString())) };
}
async function writeFile(name, body, sha, allowed = []) {
  return api('PUT', `${root}/contents/${name}`, {
    branch, sha,
    message: `experiment ${id}: ${name}`,
    content: Buffer.from(JSON.stringify(encrypt(body))).toString('base64'),
  }, allowed);
}
async function createLock(contender) {
  const { value: base } = await api('GET', `${root}/git/ref/heads/${branch}`);
  const { value: commit } = await api('GET', `${root}/git/commits/${base.object.sha}`);
  const owner = { runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, jobName: process.env.GITHUB_JOB, contender, nonce: crypto.randomUUID() };
  const { value: own } = await api('POST', `${root}/git/commits`, {
    message: JSON.stringify(owner), tree: commit.tree.sha, parents: [base.object.sha],
  });
  const created = await api('POST', `${root}/git/refs`, { ref: `refs/heads/${lock}`, sha: own.sha }, [422, 409]);
  if (created.status === 201) return { sha: own.sha, owner };
  const existing = await api('GET', `${root}/git/ref/heads/${lock}`, undefined, [404]);
  if (existing.status === 404) return null;
  assert(existing.value.object.sha, 'Failed creation must be explained by an existing lock');
  return null;
}
async function releaseLock(own) {
  const { value } = await api('GET', `${root}/git/ref/heads/${lock}`);
  assert.equal(value.object.sha, own.sha, 'Only the owner releases the lock');
  await api('DELETE', `${root}/git/refs/heads/${lock}`);
}

const [command, subject] = process.argv.slice(2);
if (command === 'initialize') {
  const { value: base } = await api('GET', `${root}/git/ref/heads/${process.env.GITHUB_REF_NAME}`);
  await api('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha });
  await writeFile('codex.enc', { kind: 'ready', revision: 0, refreshCount: 0, token: 'SYNTHETIC-OLD-TOKEN' });
  summary('bootstrap-with-job-token', { branch, contentsWrite: true, usesRealCredentials: false });
} else if (command === 'contend') {
  let own, conflicts = 0;
  const deadline = Date.now() + 120_000;
  while (!own && Date.now() < deadline) {
    own = await createLock(subject);
    if (!own) { conflicts++; await delay(350); }
  }
  assert(own, 'Lock acquisition timed out');
  try {
    const previous = await readFile();
    let outcome;
    if (previous.body.revision === 0) {
      const intent = await writeFile('codex.enc', { ...previous.body, kind: 'refreshing', revision: 1, operationId: own.owner.nonce }, previous.sha);
      // A deliberate long critical section ensures independently scheduled jobs contend.
      await delay(8_000);
      const temporary = path.join(process.env.RUNNER_TEMP, `auth-${subject}`);
      fs.mkdirSync(temporary, { recursive: true });
      fs.writeFileSync(path.join(temporary, 'auth.json'), JSON.stringify({ token: 'SYNTHETIC-ROTATED-TOKEN' }), { mode: 0o600 });
      const local = JSON.parse(fs.readFileSync(path.join(temporary, 'auth.json')));
      const published = await writeFile('codex.enc', {
        kind: 'ready', revision: 2, refreshCount: 1, token: local.token, operationId: own.owner.nonce,
      }, intent.value.content.sha);
      assert.equal(published.status, 200);
      // Simulate a lost HTTP response by discarding the returned value and reading it back.
      const confirmed = await readFile();
      assert.equal(confirmed.body.operationId, own.owner.nonce);
      assert.equal(confirmed.body.kind, 'ready');
      const stale = await writeFile('codex.enc', previous.body, previous.sha, [409, 422]);
      assert.equal(stale.status, 409, 'Old SHA must not overwrite the refreshed credential');
      outcome = { action: 'refreshed', staleWriteStatus: stale.status, readBackConfirmed: true };
    } else {
      assert.equal(previous.body.kind, 'ready');
      assert.equal(previous.body.revision, 2);
      assert.equal(previous.body.refreshCount, 1);
      outcome = { action: 'reused-new-token' };
    }
    summary('parallel-ref-lock', { subject, conflicts, ...outcome });
  } finally {
    await releaseLock(own);
  }
} else if (command === 'verify') {
  const latest = await readFile();
  assert.equal(latest.body.revision, 2);
  assert.equal(latest.body.refreshCount, 1);
  assert.equal(latest.body.token, 'SYNTHETIC-ROTATED-TOKEN');
  const own = await createLock('crash-fixture');
  assert(own);
  await writeFile('codex.enc', { kind: 'refreshing', revision: 3, operationId: own.owner.nonce }, latest.sha);
  // This is the production policy boundary: unknown provider outcome must not be refreshed again.
  const unknown = await readFile();
  assert.equal(unknown.body.kind, 'refreshing');
  assert.notEqual(unknown.body.kind, 'ready');
  await releaseLock(own);
  summary('new-runner-readback-and-uncertain-state', {
    restoredLatestRevision: latest.body.revision,
    refreshCount: latest.body.refreshCount,
    refusesRefreshingAsReady: true,
    limitation: 'The crash marker is injected; this does not validate a real process kill or OAuth server rotation.',
  });
} else if (command === 'crash') {
  const own = await createLock('real-exit-after-intent');
  assert(own);
  const previous = await readFile();
  await writeFile('codex.enc', { kind: 'refreshing', revision: 4, operationId: own.owner.nonce, refreshCount: 1 }, previous.sha);
  summary('intentional-process-crash', { leavesLock: true, leavesRefreshingMarker: true, expectedExitCode: 23 });
  process.exit(23);
} else if (command === 'recover-crash') {
  const { value: ref } = await api('GET', `${root}/git/ref/heads/${lock}`);
  const { value: commit } = await api('GET', `${root}/git/commits/${ref.object.sha}`);
  const owner = JSON.parse(commit.message);
  assert.equal(owner.contender, 'real-exit-after-intent');
  const { value: jobs } = await api('GET', `${root}/actions/runs/${process.env.GITHUB_RUN_ID}/jobs?per_page=100`);
  const oldJob = jobs.jobs.find(job => job.name === owner.jobName);
  assert(oldJob, 'Must identify the exact old job');
  assert.equal(oldJob.status, 'completed', 'Never recover a lock from a running job');
  const previous = await readFile();
  assert.equal(previous.body.kind, 'refreshing');
  assert.equal(previous.body.revision, 4);
  assert.equal(previous.body.refreshCount, 1);
  await releaseLock({ sha: ref.object.sha });
  const own = await createLock('recovery-owner');
  assert(own);
  const check = await readFile();
  await writeFile('codex.enc', { kind: 'reauth_required', revision: 5, reason: 'uncertain-provider-outcome', refreshCount: 1 }, check.sha);
  await releaseLock(own);
  summary('cross-job-real-crash-recovery', {
    previousJob: oldJob.name, previousJobStatus: oldJob.status,
    persistedMarker: previous.body.kind, finalState: 'reauth_required',
    repeatedRefreshes: 0, realProcessExit: true,
  });
} else if (command === 'slot') {
  const start = Date.now();
  await delay(18_000);
  const result = { subject, actorId: process.env.GITHUB_ACTOR_ID, start, end: Date.now() };
  fs.writeFileSync('experiment-result.json', JSON.stringify(result));
  summary('concurrency-slot', result);
} else if (command === 'verify-slots') {
  const results = fs.readdirSync('slot-results').map(name => JSON.parse(fs.readFileSync(`slot-results/${name}/experiment-result.json`)));
  const a = results.filter(r => r.subject.startsWith('same-user')).sort((x, y) => x.start - y.start);
  const b = results.find(r => r.subject === 'other-group');
  assert.equal(a.length, 2);
  assert(a[0].end <= a[1].start, 'Same actor group must not overlap');
  assert(a.some(r => Math.max(r.start, b.start) < Math.min(r.end, b.end)), 'A different group should run concurrently');
  summary('user-concurrency-observation', {
    results, sameGroupSerialized: true, differentGroupOverlapped: true,
    limitation: 'Only one real GitHub actor is available. The other user is a synthetic group key, not a second authenticated account.',
  });
} else if (command === 'cache-save' || command === 'cache-restore') {
  const personalKey = crypto.createHash('sha256').update(`SYNTHETIC-PERSONAL-${id}-${subject}`).digest();
  const file = 'fixture-cache/state.enc';
  if (command === 'cache-save') {
    fs.mkdirSync('fixture-cache', { recursive: true });
    fs.writeFileSync(file, JSON.stringify(encrypt({ owner: subject, history: `SYNTHETIC-PRIVATE-${subject}` }, personalKey)));
    assert(!fs.readFileSync(file, 'utf8').includes('SYNTHETIC-PRIVATE'));
  } else {
    const envelope = JSON.parse(fs.readFileSync(file));
    assert.equal(decrypt(envelope, personalKey).owner, subject);
    assert.throws(() => decrypt(envelope, crypto.randomBytes(32)));
  }
  summary(command, { subject, ciphertextOnly: true, keyIsPublicSyntheticFixture: true });
} else if (command === 'cleanup') {
  for (const name of [lock, branch]) {
    const response = await api('DELETE', `${root}/git/refs/heads/${name}`, undefined, [404, 422]);
    summary('cleanup-ref', { name, status: response.status });
  }
} else {
  throw new Error(`Unknown command ${command}`);
}
