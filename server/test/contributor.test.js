// Contributor Mode: boot the real HTTPS server with a separate contributor
// token and assert the access boundary — the low-privilege token may ONLY reach
// the restricted /api/contributor/* namespace, admin creates/destroys the
// session, and the contributor-facing status never leaks the repo path.
const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs'), os = require('os'), path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-contrib-'))
const PORT = 7900 + Math.floor(Math.random() * 300)
const ADMIN = 'admintok'
const CONTRIB = 'contribtok'
let proc

function request(method, p, body, tokenOverride) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = {}
    // tokenOverride: string token, or null for no auth. undefined = admin.
    const tok = tokenOverride === undefined ? ADMIN : tokenOverride
    if (tok) headers.Authorization = 'Bearer ' + tok
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const req = https.request({ host: 'localhost', port: PORT, path: p, method, rejectUnauthorized: false, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null, raw: b }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

test.before(async () => {
  proc = spawn('node', [path.join(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, SM_DATA_DIR: TMP, SM_TOKEN: ADMIN, SM_CONTRIBUTOR_TOKEN: CONTRIB, SM_WORKTREES: 'off', PORT: String(PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await request('GET', '/api/status')).status === 200) return } catch {}
    await new Promise((s) => setTimeout(s, 200))
  }
  throw new Error('server did not start')
})
test.after(async () => {
  try { await request('DELETE', '/api/contributor/session') } catch {}
  try { proc.kill('SIGKILL') } catch {}
})

test('no token is rejected on a contributor route', async () => {
  const r = await request('GET', '/api/contributor/session', null, null)
  assert.equal(r.status, 401)
})

test('contributor token is forbidden on admin routes', async () => {
  assert.equal((await request('GET', '/api/status', null, CONTRIB)).status, 403)
  assert.equal((await request('GET', '/api/triage/inbox', null, CONTRIB)).status, 403)
  assert.equal((await request('GET', '/api/projects', null, CONTRIB)).status, 403)
})

test('contributor token cannot create or destroy its own session (admin-only)', async () => {
  assert.equal((await request('POST', '/api/contributor/session', { project: 'x' }, CONTRIB)).status, 403)
  assert.equal((await request('DELETE', '/api/contributor/session', null, CONTRIB)).status, 403)
})

test('contributor token reaches its namespace (404 before a session exists, not 403)', async () => {
  const r = await request('GET', '/api/contributor/session', null, CONTRIB)
  assert.equal(r.status, 404)
})

test('admin creates the contributor session; status is non-leaky', async () => {
  const c = await request('POST', '/api/contributor/session', { project: 'sessionmanager' })
  assert.equal(c.status, 201)
  assert.equal(c.json.name, 'Contributor: sessionmanager')

  const s = await request('GET', '/api/contributor/session', null, CONTRIB)
  assert.equal(s.status, 200)
  assert.equal(s.json.project, 'sessionmanager')
  // The contributor must never receive an on-disk path or the raw cwd.
  assert.ok(!('cwd' in s.json), 'cwd must not be exposed')
  assert.ok(!('worktree' in s.json), 'worktree must not be exposed')
  assert.ok(!/\//.test(JSON.stringify(s.json).replace(/https?:\/\//g, '')), 'no filesystem paths in status')
})

test('contributor input + history routes are reachable (auth passes, not 401/403)', async () => {
  const i = await request('POST', '/api/contributor/input', { text: 'hello there' }, CONTRIB)
  assert.ok(i.status !== 401 && i.status !== 403, 'input reachable by contributor')
  const h = await request('GET', '/api/contributor/history', null, CONTRIB)
  assert.ok(h.status !== 401 && h.status !== 403, 'history reachable by contributor')
})

test('admin can tear the session down', async () => {
  assert.equal((await request('DELETE', '/api/contributor/session')).status, 200)
  assert.equal((await request('GET', '/api/contributor/session', null, CONTRIB)).status, 404)
})
