// Contributor Mode: boot the real HTTPS server with a separate contributor
// token and assert the access boundary — the low-privilege token may ONLY reach
// the restricted /api/contributor/* namespace; the link is device-locked (first
// claimer wins) and its status never leaks the repo path.
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

function request(method, p, body, tokenOverride, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const headers = {}
    const tok = tokenOverride === undefined ? ADMIN : tokenOverride
    if (tok) headers.Authorization = 'Bearer ' + tok
    if (cookie) headers.Cookie = cookie
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const req = https.request({ host: 'localhost', port: PORT, path: p, method, rejectUnauthorized: false, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null, raw: b, headers: res.headers }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}
// Pull the device cookie value back out of a claim's Set-Cookie for reuse.
function cookieFrom(res) {
  const sc = res.headers['set-cookie']
  if (!sc) return null
  const m = /sm_contrib_device=([^;]+)/.exec(sc[0])
  return m ? 'sm_contrib_device=' + m[1] : null
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
  assert.equal((await request('POST', '/api/contributor/claim', null, null)).status, 401)
})

test('contributor token is forbidden on admin routes', async () => {
  assert.equal((await request('GET', '/api/status', null, CONTRIB)).status, 403)
  assert.equal((await request('GET', '/api/triage/inbox', null, CONTRIB)).status, 403)
  assert.equal((await request('GET', '/api/projects', null, CONTRIB)).status, 403)
})

test('contributor token cannot create/destroy/rebind (admin-only)', async () => {
  assert.equal((await request('POST', '/api/contributor/session', { project: 'x' }, CONTRIB)).status, 403)
  assert.equal((await request('DELETE', '/api/contributor/session', null, CONTRIB)).status, 403)
  assert.equal((await request('POST', '/api/contributor/rebind', null, CONTRIB)).status, 403)
})

test('before a session is armed, claim is reachable but says not active', async () => {
  const r = await request('POST', '/api/contributor/claim', null, CONTRIB)
  assert.equal(r.status, 403)
  assert.match(r.json.error, /not active/i)
})

test('admin creates session → link armed; first device claims it', async () => {
  const c = await request('POST', '/api/contributor/session', { project: 'sessionmanager' })
  assert.equal(c.status, 201)
  assert.ok(c.json.contributorUrl && /\/contributor\?token=/.test(c.json.contributorUrl))

  const claim = await request('POST', '/api/contributor/claim', null, CONTRIB)
  assert.equal(claim.status, 200)
  const cookie = cookieFrom(claim)
  assert.ok(cookie, 'claim sets a device cookie')

  // With the device cookie, contributor routes work and status is non-leaky.
  const s = await request('GET', '/api/contributor/session', null, CONTRIB, cookie)
  assert.equal(s.status, 200)
  assert.equal(s.json.project, 'sessionmanager')
  assert.ok(!('cwd' in s.json) && !('worktree' in s.json), 'no path leak')

  const i = await request('POST', '/api/contributor/input', { text: 'hello there' }, CONTRIB, cookie)
  assert.ok(i.status !== 401 && i.status !== 403, 'input works with the device cookie')
})

test('another device (no/!= cookie) is locked out after the first claims', async () => {
  // Same token, but a different (missing) device cookie → locked.
  const other = await request('GET', '/api/contributor/session', null, CONTRIB /* no cookie */)
  assert.equal(other.status, 403)
  assert.match(other.json.error, /locked to the computer/i)
  const claim2 = await request('POST', '/api/contributor/claim', null, CONTRIB /* no cookie */)
  assert.equal(claim2.status, 403)
})

test('admin rebind lets a new device claim', async () => {
  assert.equal((await request('POST', '/api/contributor/rebind')).status, 200)
  const claim = await request('POST', '/api/contributor/claim', null, CONTRIB)
  assert.equal(claim.status, 200, 'after rebind a fresh device can claim again')
  assert.ok(cookieFrom(claim))
})

test('contributor /key whitelists control keys, rejects arbitrary input', async () => {
  await request('POST', '/api/contributor/rebind')                       // re-arm for a fresh claim
  const c = cookieFrom(await request('POST', '/api/contributor/claim', null, CONTRIB))
  assert.ok(c, 'got a device cookie')
  const good = await request('POST', '/api/contributor/key', { key: 'down' }, CONTRIB, c)
  assert.ok(good.status !== 401 && good.status !== 403, 'whitelisted key reachable')
  assert.equal((await request('POST', '/api/contributor/key', { key: '!' }, CONTRIB, c)).status, 400)
  assert.equal((await request('POST', '/api/contributor/key', { key: '/' }, CONTRIB, c)).status, 400)
  assert.equal((await request('POST', '/api/contributor/key', { key: 'rm -rf' }, CONTRIB, c)).status, 400)
})

test('admin can tear the session down', async () => {
  assert.equal((await request('DELETE', '/api/contributor/session')).status, 200)
})
