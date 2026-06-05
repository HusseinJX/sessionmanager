// Unit tests for git worktree isolation + PR finalize. Uses real git against a
// throwaway repo + bare remote. No PTY, no network/GitHub needed.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs'), os = require('os'), path = require('path')
const { execFileSync } = require('child_process')

const REPOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-repos-'))
process.env.SM_REPOS_DIR = REPOS
process.env.SM_WORKTREES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-wt-'))
process.env.SM_WORKTREES = 'on'
const wt = require('../dist/worktree.js')

const REMOTE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sm-remote-')), 'remote.git')
const REPO = path.join(REPOS, 'demoapp')
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test.before(() => {
  execFileSync('git', ['init', '--bare', '-q', REMOTE])
  fs.mkdirSync(REPO, { recursive: true })
  git(REPO, ['init', '-q'])
  git(REPO, ['config', 'user.email', 't@t.co'])
  git(REPO, ['config', 'user.name', 'tester'])
  git(REPO, ['checkout', '-q', '-b', 'main'])
  fs.writeFileSync(path.join(REPO, 'app.txt'), 'v1\n')
  git(REPO, ['add', '-A']); git(REPO, ['commit', '-qm', 'init'])
  git(REPO, ['remote', 'add', 'origin', REMOTE])
  git(REPO, ['push', '-q', '-u', 'origin', 'main'])
})

test('worktreesEnabled respects the SM_WORKTREES kill switch', () => {
  process.env.SM_WORKTREES = 'off'; assert.equal(wt.worktreesEnabled(), false)
  process.env.SM_WORKTREES = 'on'; assert.equal(wt.worktreesEnabled(), true)
})

test('resolveRepoPath finds a known repo, null for unknown', () => {
  assert.ok(wt.resolveRepoPath('demoapp'))
  assert.equal(wt.resolveRepoPath('nope-not-real-xyz'), null)
})

test('createWorktree makes an isolated branch + dir off the base branch', () => {
  process.env.SM_WORKTREES = 'on'
  const info = wt.createWorktree('demoapp', '2026-06-05', 'sess1234')
  assert.ok(info, 'worktree created')
  assert.match(info.branch, /^triage\/2026-06-05\/demoapp-sess1234/)
  assert.equal(info.baseBranch, 'main')
  assert.ok(fs.existsSync(info.path))
  assert.equal(git(info.path, ['branch', '--show-current']), info.branch)
})

test('createWorktree returns null when the kill switch is off', () => {
  process.env.SM_WORKTREES = 'off'
  assert.equal(wt.createWorktree('demoapp', '2026-06-05', 'sessOFF'), null)
  process.env.SM_WORKTREES = 'on'
})

test('finalizeJobPr commits + pushes the branch (PR step degrades without gh/GitHub)', () => {
  process.env.SM_WORKTREES = 'on'
  const info = wt.createWorktree('demoapp', '2026-06-05', 'sess5678')
  fs.writeFileSync(path.join(info.path, 'app.txt'), 'v2 changed in isolated worktree\n')
  const r = wt.finalizeJobPr(info, 'test job', 'body')
  assert.equal(r.committed, true)
  assert.equal(r.pushed, true)
  const branches = execFileSync('git', ['branch'], { cwd: REMOTE, encoding: 'utf8' })
  assert.ok(branches.includes('sess5678'), 'branch landed in the remote')
})

test('finalizeJobPr reports nothing to commit when the worktree is clean', () => {
  process.env.SM_WORKTREES = 'on'
  const info = wt.createWorktree('demoapp', '2026-06-05', 'sessclean')
  const r = wt.finalizeJobPr(info, 'noop', 'body')
  assert.equal(r.committed, false)
  assert.match(r.note, /no changes/)
})
