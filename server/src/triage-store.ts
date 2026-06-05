import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'

// --- Types ---

export type FeedbackSource = 'slack' | 'feedbase' | 'ideaboard' | 'personal-backlog' | 'atom-issues'
export type FeedbackType = 'bug' | 'feature' | 'chore' | 'feedback' | 'idea'
export type TaskSize = 'small' | 'medium' | 'large'
export type TriageStatus = 'pending' | 'approved' | 'dispatched' | 'dismissed'

export interface FeedbackItem {
  id: string
  source: FeedbackSource
  sourceDetail: string
  type: FeedbackType
  title: string
  body: string
  targetProject: string
  reporter: string
  account: string   // the customer the feedback is about
  channel: string   // the medium it arrived through (Slack, Email, Meetings, …)
  votes: number | null
  createdAt: string
  signals: { frequency: number; severity: 'low' | 'medium' | 'high' }
  // Triage fields (mutated as the human works the board)
  suggestedSize: TaskSize
  size: TaskSize | null
  triageStatus: TriageStatus
  autoQueue: boolean
  guidelines: string
  enrichedSpec: string
  // Set when a live Claude planning session is opened for this item
  planningSessionId?: string
  planningProjectId?: string
  // Set on dispatch
  dispatchedProjectId?: string
  dispatchedTaskId?: string
  dispatchedAt?: string
}

// Backlog Jobs are self-authored task groups (things John wants in the app),
// independent of the incoming feedback. Each is one buildable unit.
export interface JobTicket {
  id: string
  title: string
  size: TaskSize
}
export interface BacklogJob {
  id: string
  name: string
  project: string
  tickets: JobTicket[]
  status: 'backlog' | 'dispatched'
  createdAt: number
  dispatchedProjectId?: string
  dispatchedSessionId?: string
  dispatchedAt?: string
}

export interface TriageInbox {
  date: string
  generatedAt: string
  note?: string
  items: FeedbackItem[]
  jobs: BacklogJob[]
}

// --- Persistence ---
// Working copy lives next to data.json in SM_DATA_DIR. On first run we seed it
// from the bundled feedback-inbox.seed.json so the demo always has data.

const DATA_DIR = process.env.SM_DATA_DIR || process.cwd()
const INBOX_PATH = path.join(DATA_DIR, 'feedback-inbox.json')

function findSeed(): string | null {
  const candidates = [
    path.join(__dirname, '../feedback-inbox.seed.json'),     // dist/ -> server/
    path.join(__dirname, '../../feedback-inbox.seed.json'),  // alt nesting
    path.join(process.cwd(), 'feedback-inbox.seed.json'),
    path.join(process.cwd(), 'server', 'feedback-inbox.seed.json'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

let _inbox: TriageInbox | null = null

function load(): TriageInbox {
  if (_inbox) return _inbox
  // Prefer an existing working copy (preserves triage edits across restarts)
  try {
    _inbox = JSON.parse(fs.readFileSync(INBOX_PATH, 'utf-8')) as TriageInbox
    if (!_inbox.jobs) _inbox.jobs = []
    return _inbox
  } catch { /* fall through to seed */ }

  const seed = findSeed()
  if (seed) {
    _inbox = JSON.parse(fs.readFileSync(seed, 'utf-8')) as TriageInbox
  } else {
    _inbox = { date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), items: [], jobs: [] }
  }
  if (!_inbox.jobs) _inbox.jobs = [] // backfill older working copies
  save()
  return _inbox
}

function save(): void {
  if (!_inbox) return
  fs.mkdirSync(path.dirname(INBOX_PATH), { recursive: true })
  fs.writeFileSync(INBOX_PATH, JSON.stringify(_inbox, null, 2))
}

// --- Heuristic classifier ---
// Stands in for the selfimproving agent team: simple, dependency-free scoring
// that splits trivial fixes from medium work from things that need planning.

const SMALL_HINTS = /\b(typo|copy|color|colour|text|label|link|padding|margin|rename|wording|clamp|min date|favicon|alt text|placeholder)\b/i
const LARGE_HINTS = /\b(redesign|rebuild|architecture|integrat|migrat|payment|auth|webhook|cross|two codebases|split|spatial|pipeline|per-member|design pass|worktree|isolation|profiling)\b/i

export function classify(item: Pick<FeedbackItem, 'type' | 'title' | 'body' | 'signals'>): TaskSize {
  const text = `${item.title} ${item.body}`
  if (SMALL_HINTS.test(text) && item.body.length < 220) return 'small'
  if (LARGE_HINTS.test(text)) return 'large'
  if (item.type === 'chore' || item.type === 'feedback') {
    return item.body.length < 220 ? 'small' : 'medium'
  }
  if (item.type === 'idea') return 'large'
  // bug / feature default to medium; escalate big, high-severity asks
  if (item.signals.severity === 'high' && item.body.length > 320) return 'large'
  return 'medium'
}

// --- Public API ---

export function getInbox(): TriageInbox {
  return load()
}

export function getItem(id: string): FeedbackItem | undefined {
  return load().items.find((i) => i.id === id)
}

export function updateItem(id: string, updates: Partial<FeedbackItem>): FeedbackItem | null {
  const inbox = load()
  const item = inbox.items.find((i) => i.id === id)
  if (!item) return null
  // Only allow mutating triage-owned fields
  const allowed: (keyof FeedbackItem)[] = [
    'size', 'triageStatus', 'autoQueue', 'guidelines', 'enrichedSpec', 'targetProject',
    'planningSessionId', 'planningProjectId',
    'dispatchedProjectId', 'dispatchedTaskId', 'dispatchedAt',
  ]
  for (const key of allowed) {
    if (key in updates) (item as any)[key] = (updates as any)[key]
  }
  save()
  return item
}

// --- Backlog Jobs CRUD ---

export function getJob(jobId: string): BacklogJob | undefined {
  return load().jobs.find((j) => j.id === jobId)
}

export function addJob(name: string, project: string): BacklogJob {
  const job: BacklogJob = { id: uuidv4(), name, project, tickets: [], status: 'backlog', createdAt: Date.now() }
  load().jobs.push(job)
  save()
  return job
}

export function updateJob(jobId: string, updates: Partial<BacklogJob>): BacklogJob | null {
  const job = getJob(jobId)
  if (!job) return null
  const allowed: (keyof BacklogJob)[] = ['name', 'project', 'status', 'dispatchedProjectId', 'dispatchedSessionId', 'dispatchedAt']
  for (const k of allowed) if (k in updates) (job as any)[k] = (updates as any)[k]
  save()
  return job
}

export function removeJob(jobId: string): void {
  const inbox = load()
  inbox.jobs = inbox.jobs.filter((j) => j.id !== jobId)
  save()
}

export function addTicket(jobId: string, title: string, size: TaskSize = 'medium'): JobTicket | null {
  const job = getJob(jobId)
  if (!job) return null
  const ticket: JobTicket = { id: uuidv4(), title, size }
  job.tickets.push(ticket)
  save()
  return ticket
}

export function updateTicket(jobId: string, ticketId: string, updates: Partial<JobTicket>): JobTicket | null {
  const job = getJob(jobId)
  const ticket = job?.tickets.find((t) => t.id === ticketId)
  if (!ticket) return null
  if (typeof updates.title === 'string') ticket.title = updates.title
  if (updates.size) ticket.size = updates.size
  save()
  return ticket
}

export function removeTicket(jobId: string, ticketId: string): void {
  const job = getJob(jobId)
  if (!job) return
  job.tickets = job.tickets.filter((t) => t.id !== ticketId)
  save()
}

// Reset the working copy back to the seed (handy for re-running the demo).
export function resetInbox(): TriageInbox {
  _inbox = null
  try { fs.unlinkSync(INBOX_PATH) } catch { /* ignore */ }
  return load()
}
