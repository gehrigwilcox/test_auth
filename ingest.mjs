// Reads the issue event, validates the run, writes it to data/runs/.
// The issue body is untrusted input: it is only ever parsed here, never put in a shell command.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAX_GZ_BYTES = 16 * 1024;        // compressed size cap
const MAX_JSON_BYTES = 256 * 1024;     // decompressed size cap (zip-bomb guard)
const MAX_TICKS = 3000;
const TICK_LEN = 7;

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;

function out(status, reason = '') {
  appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\nreason=${reason}\n`);
  console.log(status, reason);
  process.exit(0);
}

if (!issue.title.startsWith('run: ')) out('skip', 'not a run submission');

const m = /```run\s+([A-Za-z0-9_-]+)\s+```/.exec(issue.body || '');
if (!m) out('rejected', 'no run block found');

let gz;
try {
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  gz = Buffer.from(b64, 'base64');
} catch { out('rejected', 'bad encoding'); }
if (gz.length > MAX_GZ_BYTES) out('rejected', 'too large');

let run;
try {
  const json = gunzipSync(gz, { maxOutputLength: MAX_JSON_BYTES }).toString('utf8');
  run = JSON.parse(json);
} catch { out('rejected', 'could not decode'); }

if (run?.v !== 1) out('rejected', 'unknown version');
if (!Number.isInteger(run.hz) || run.hz < 1 || run.hz > 30) out('rejected', 'bad sample rate');
if (!['player_won', 'boss_won', 'timeout'].includes(run.outcome)) out('rejected', 'bad outcome');
if (!Array.isArray(run.ticks) || run.ticks.length < 10 || run.ticks.length > MAX_TICKS) out('rejected', 'bad tick count');
for (const t of run.ticks) {
  if (!Array.isArray(t) || t.length !== TICK_LEN || !t.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    out('rejected', 'bad tick values');
  }
}

// Store only the validated fields, re-serialized, so nothing extra rides along.
const clean = { v: 1, hz: run.hz, outcome: run.outcome, ticks: run.ticks, by: issue.user.id };
mkdirSync('data/runs', { recursive: true });
writeFileSync(`data/runs/${issue.number}.json.gz`, gzipSync(JSON.stringify(clean)));
out('ok');
