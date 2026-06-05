// Integration tests: boot the real HTTPS server and drive the triage flow over
// the wire. PTYs can't spawn in CI/sandboxes, so dispatch runs in its resilient
// ptyOk:false mode — these assert the data-layer outcomes, which are identical
// with or without a live PTY.
const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const https = require('https')
const fs = require('fs'), os = require('os'), path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-flow-'))
const PORT = 7600 + Math.floor(Math.random() * 300)
const TOKEN = 'testtok'
let proc

function request(method, p, body, withAuth = true) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = {}
    if (withAuth) headers.Authorization = 'Bearer ' + TOKEN
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const req = https.request({ host: 'localhost', port: PORT, path: p, method, rejectUnauthorized: false, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null, headers: res.headers }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}
const inbox = async () => (await request('GET', '/api/triage/inbox')).json

test.before(async () => {
  proc = spawn('node', [path.join(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, SM_DATA_DIR: TMP, SM_TOKEN: TOKEN, SM_WORKTREES: 'off', PORT: String(PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await request('GET', '/api/triage/inbox')).status === 200) return } catch {}
    await new Promise((s) => setTimeout(s, 200))
  }
  throw new Error('server did not start')
})
test.after(() => { try { proc.kill('SIGKILL') } catch {} })

test('GET /api/triage/inbox returns the seeded payload', async () => {
  const r = await request('GET', '/api/triage/inbox')
  assert.equal(r.status, 200)
  assert.equal(r.json.items.length, 15)
  assert.equal(r.json.jobs.length, 3)
})

test('API requires a bearer token', async () => {
  const r = await request('GET', '/api/triage/inbox', null, false)
  assert.equal(r.status, 401)
})

test('PUT item persists an allowed field', async () => {
  const id = (await inbox()).items[0].id
  const r = await request('PUT', `/api/triage/items/${id}`, { size: 'large' })
  assert.equal(r.json.size, 'large')
})

test('dispatch a feedback item → one session, boot+ticket tasks, marked dispatched, no duplicate project', async () => {
  await request('PUT', '/api/triage/items/fb-003', { triageStatus: 'approved' })
  const d = await request('POST', '/api/triage/dispatch', { itemIds: ['fb-003'] })
  assert.equal(d.status, 200)
  assert.equal(d.json.jobs.length, 1)
  assert.ok(d.json.jobs[0].taskIds.length >= 2, 'claude boot task + the ticket')
  assert.equal((await inbox()).items.find((i) => i.id === 'fb-003').triageStatus, 'dispatched')
  const projects = (await request('GET', '/api/projects')).json
  assert.equal(projects.filter((p) => p.name === 'sessionmanager').length, 1, 'project not duplicated')
})

test('explicit groups produce separate sessions/worktrees for the same project (split)', async () => {
  await request('PUT', '/api/triage/items/fb-001', { triageStatus: 'approved' })
  await request('PUT', '/api/triage/items/fb-013', { triageStatus: 'approved' })
  const d = await request('POST', '/api/triage/dispatch', {
    groups: [
      { name: 'split A', project: 'community-marketplace', itemIds: ['fb-001'] },
      { name: 'split B', project: 'community-marketplace', itemIds: ['fb-013'] },
    ],
  })
  assert.equal(d.json.jobs.length, 2)
  assert.notEqual(d.json.jobs[0].sessionId, d.json.jobs[1].sessionId)
})

test('backlog job CRUD + build over HTTP', async () => {
  const j = (await request('POST', '/api/triage/jobs', { name: 'Search revamp', project: 'prolocaliq' })).json
  await request('POST', `/api/triage/jobs/${j.id}/tickets`, { title: 'fuzzy search', size: 'medium' })
  await request('POST', `/api/triage/jobs/${j.id}/tickets`, { title: 'filters sidebar', size: 'large' })
  const d = await request('POST', '/api/triage/dispatch', { jobIds: [j.id] })
  assert.equal(d.json.jobs.length, 1)
  assert.ok(d.json.jobs[0].taskIds.length >= 3, 'boot + 2 tickets')
  assert.equal((await inbox()).jobs.find((x) => x.id === j.id).status, 'dispatched')
})

test('re-dispatching an already-dispatched item is skipped', async () => {
  const d = await request('POST', '/api/triage/dispatch', { itemIds: ['fb-003'] })
  assert.ok(d.json.skipped.some((s) => s.id === 'fb-003' && /dispatched/.test(s.error)))
})

test('plan endpoint spawns a session and seeds CONTEXT.md', async () => {
  const r = await request('POST', '/api/triage/items/fb-010/plan')
  assert.equal(r.status, 200)
  assert.ok(r.json.sessionId)
  assert.ok(fs.existsSync(path.join(r.json.cwd, 'CONTEXT.md')), 'CONTEXT.md seeded into the session cwd')
})

test('reset clears all triage/dispatch state', async () => {
  const r = await request('POST', '/api/triage/reset')
  assert.equal(r.json.items.filter((i) => i.triageStatus !== 'pending').length, 0)
  assert.equal(r.json.jobs.filter((j) => j.status !== 'backlog').length, 0)
})
