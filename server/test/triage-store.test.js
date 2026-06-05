// Unit tests for the triage store + classifier. No server, no PTY.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs'), os = require('os'), path = require('path')

// Point the store at a throwaway data dir BEFORE requiring it (env read at load).
process.env.SM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-store-'))
process.env.SM_WORKTREES = 'off'
const store = require('../dist/triage-store.js')

test.beforeEach(() => store.resetInbox())

test('seed inbox loads 15 feedback items + 3 backlog jobs', () => {
  const inbox = store.getInbox()
  assert.equal(inbox.items.length, 15)
  assert.equal(inbox.jobs.length, 3)
  assert.ok(inbox.items[0].account && inbox.items[0].channel, 'items carry account + channel')
})

test('classify: typo→small, integration→large, idea→large, plain bug→medium', () => {
  assert.equal(store.classify({ type: 'feedback', title: 'Fix typo on hero', body: 'one char', signals: { severity: 'low' } }), 'small')
  assert.equal(store.classify({ type: 'feature', title: 'Wire webhook integration across two codebases', body: 'x'.repeat(60), signals: { severity: 'medium' } }), 'large')
  assert.equal(store.classify({ type: 'idea', title: 'New thing', body: 'x', signals: { severity: 'medium' } }), 'large')
  assert.equal(store.classify({ type: 'bug', title: 'Something broke', body: 'x'.repeat(60), signals: { severity: 'medium' } }), 'medium')
})

test('updateItem mutates only allowed fields (title is protected)', () => {
  const it = store.getInbox().items[0]
  const r = store.updateItem(it.id, { size: 'large', triageStatus: 'approved', title: 'HACKED' })
  assert.equal(r.size, 'large')
  assert.equal(r.triageStatus, 'approved')
  assert.notEqual(r.title, 'HACKED')
})

test('jobs + tickets CRUD', () => {
  const j = store.addJob('Test job', 'proj-x')
  assert.equal(j.status, 'backlog')
  const t = store.addTicket(j.id, 'do thing', 'small')
  assert.equal(store.getJob(j.id).tickets.length, 1)
  store.updateTicket(j.id, t.id, { size: 'large', title: 'do other' })
  assert.equal(store.getJob(j.id).tickets[0].size, 'large')
  assert.equal(store.getJob(j.id).tickets[0].title, 'do other')
  store.removeTicket(j.id, t.id)
  assert.equal(store.getJob(j.id).tickets.length, 0)
  store.removeJob(j.id)
  assert.equal(store.getJob(j.id), undefined)
})

test('resetInbox restores seed (clears triage edits)', () => {
  const id = store.getInbox().items[0].id
  store.updateItem(id, { triageStatus: 'approved' })
  store.resetInbox()
  assert.equal(store.getInbox().items[0].triageStatus, 'pending')
})
