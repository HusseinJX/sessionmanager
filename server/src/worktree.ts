import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFileSync } from 'child_process'

// Git-worktree isolation for triage Jobs. Each dispatched Job runs in its own
// worktree + branch so concurrent Claude Code sessions never stomp each other's
// files. On job completion we commit, push, and open a PR.

const REPOS_DIR = process.env.SM_REPOS_DIR || ''
const WORKTREES_DIR = process.env.SM_WORKTREES_DIR || path.join(os.tmpdir(), 'sm-worktrees')

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function isGitRepo(dir: string): boolean {
  try { return !!dir && fs.existsSync(dir) && git(dir, ['rev-parse', '--is-inside-work-tree']) === 'true' }
  catch { return false }
}

// Locate the on-disk git repo for a target project by name. Honors SM_REPOS_DIR
// (the VPS convention: all repos under one dir), else tries common local roots.
export function resolveRepoPath(projectName: string): string | null {
  const candidates = [
    REPOS_DIR && path.join(REPOS_DIR, projectName),
    path.join(os.homedir(), 'dev', projectName),
    path.join(os.homedir(), 'Desktop', 'dev', projectName),
    path.join(os.homedir(), projectName),
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (isGitRepo(c)) return c
  }
  return null
}

export interface WorktreeInfo {
  repoPath: string
  branch: string
  path: string
  baseBranch: string
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'job'
}

// Create an isolated worktree for a job. Returns null (caller falls back to ~)
// if the project has no resolvable git repo on this host.
export function worktreesEnabled(): boolean {
  return !/^(0|off|false|no)$/i.test(process.env.SM_WORKTREES || '')
}

export function createWorktree(projectName: string, date: string, sessionId: string): WorktreeInfo | null {
  if (!worktreesEnabled()) return null // kill switch (SM_WORKTREES=off)
  const repoPath = resolveRepoPath(projectName)
  if (!repoPath) return null

  let baseBranch = 'main'
  try { baseBranch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main' } catch { /* keep default */ }

  const branch = `triage/${date}/${slug(projectName)}-${sessionId.slice(0, 8)}`
  const dest = path.join(WORKTREES_DIR, sessionId)

  try {
    fs.mkdirSync(WORKTREES_DIR, { recursive: true })
    // Prune any stale registrations, then add a fresh worktree on a new branch.
    try { git(repoPath, ['worktree', 'prune']) } catch { /* best effort */ }
    git(repoPath, ['worktree', 'add', '-b', branch, dest, baseBranch])
    return { repoPath, branch, path: dest, baseBranch }
  } catch (e) {
    console.error(`[worktree] failed for ${projectName}:`, (e as Error)?.message)
    return null
  }
}

export interface PrResult {
  committed: boolean
  pushed: boolean
  prUrl: string | null
  branch: string
  note: string
}

// Finalize a completed job: commit any changes in the worktree, push the branch,
// and open a PR. Each step degrades gracefully (no changes / no remote / no gh).
export function finalizeJobPr(wt: WorktreeInfo, title: string, body: string): PrResult {
  const result: PrResult = { committed: false, pushed: false, prUrl: null, branch: wt.branch, note: '' }
  const cwd = wt.path
  try {
    const status = git(cwd, ['status', '--porcelain'])
    if (status) {
      git(cwd, ['add', '-A'])
      git(cwd, ['commit', '-m', title, '-m', body])
      result.committed = true
    } else {
      result.note = 'no changes to commit'
      return result
    }
  } catch (e) {
    result.note = 'commit failed: ' + (e as Error)?.message
    return result
  }

  // Push — skip silently if there's no remote configured.
  try {
    const hasRemote = (() => { try { return !!git(cwd, ['remote']) } catch { return false } })()
    if (!hasRemote) { result.note = 'committed; no remote to push'; return result }
    git(cwd, ['push', '-u', 'origin', wt.branch])
    result.pushed = true
  } catch (e) {
    result.note = 'committed; push failed: ' + (e as Error)?.message
    return result
  }

  // Open the PR with gh if available.
  try {
    const out = execFileSync('gh', ['pr', 'create', '--title', title, '--body', body, '--head', wt.branch],
      { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const m = out.match(/https?:\/\/\S+/)
    result.prUrl = m ? m[0] : null
    result.note = result.prUrl ? 'PR opened' : 'pushed; gh returned no URL'
  } catch (e) {
    result.note = 'pushed; gh pr create failed (gh not installed/authed?): ' + (e as Error)?.message
  }
  return result
}

// Remove a worktree after the PR is handled (best effort).
export function cleanupWorktree(wt: WorktreeInfo): void {
  try { git(wt.repoPath, ['worktree', 'remove', '--force', wt.path]) } catch { /* best effort */ }
}
