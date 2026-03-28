import TelegramBot from 'node-telegram-bot-api'
import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { SessionManager } from './session-manager'
import { getProjects, addTask, getTasksForProject } from './store'

export interface TelegramConfig {
  botToken: string
  chatId: string
  openaiApiKey?: string
}

/**
 * Maps Telegram message IDs to session IDs so replies get routed correctly.
 */
const messageToSession = new Map<number, string>()

const SYSTEM_PROMPT = `You are SessionManager Bot — a concise assistant that manages terminal sessions and projects via Telegram.

You have tools to check session status, read terminal output, send commands to terminals, and manage project backlogs. Use them to fulfill the user's requests.

Rules:
- Be concise. This is Telegram — short messages, no walls of text.
- Use tools proactively. If the user asks "what's running", call get_status. If they say "send X to Y", call send_command.
- When listing sessions or tasks, use clean formatting with emojis for status.
- If a request is ambiguous, make your best guess from context rather than asking clarifying questions.
- When sending commands, always confirm what you sent and to which session.
- For backlog items, if no project is specified and there's only one project, use that one.`

const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Get the status of all active terminal sessions including their name, status (running/exited), whether they are waiting for input, current working directory, and last few lines of output.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_projects',
      description: 'List all projects with their sessions and task counts.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_session_logs',
      description: 'Read the last N lines of output from a specific terminal session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The session ID' },
          lines: { type: 'number', description: 'Number of lines to retrieve (default 20, max 100)' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_command',
      description: 'Send a command or text input to a terminal session. The command will be followed by a carriage return (Enter key).',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The session ID to send to' },
          command: { type: 'string', description: 'The command or text to send' },
        },
        required: ['session_id', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_backlog_item',
      description: 'Add a task to a project\'s backlog.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID to add the task to' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Optional task description' },
        },
        required: ['project_id', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tasks',
      description: 'List all tasks for a project, grouped by status (backlog, todo, in-progress, done).',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID' },
        },
        required: ['project_id'],
      },
    },
  },
]

export class TelegramBridge {
  private bot: TelegramBot | null = null
  private sessionManager: SessionManager
  private chatId: string
  private botToken: string
  private openai: OpenAI | null = null

  constructor(sessionManager: SessionManager, config: TelegramConfig) {
    this.sessionManager = sessionManager
    this.botToken = config.botToken
    this.chatId = config.chatId
    if (config.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openaiApiKey })
    }
  }

  start(): void {
    this.bot = new TelegramBot(this.botToken, { polling: true })

    this.bot.on('message', (msg) => {
      if (String(msg.chat.id) !== this.chatId) return
      if (!msg.text) return

      // Reply to an input-waiting notification → route directly to terminal
      if (msg.reply_to_message) {
        const sessionId = messageToSession.get(msg.reply_to_message.message_id)
        if (sessionId) {
          this.sessionManager.writeToSession(sessionId, msg.text + '\r')
          this.bot?.sendMessage(msg.chat.id, `Sent to terminal.`, {
            reply_to_message_id: msg.message_id,
          })
          return
        }
      }

      // Everything else goes through the LLM
      if (this.openai) {
        this.handleWithLlm(msg.chat.id, msg.text)
      } else {
        this.bot?.sendMessage(msg.chat.id, 'LLM not configured. Set OPENAI_API_KEY to enable natural language commands.')
      }
    })

    // Listen for input-waiting events from SessionManager
    this.sessionManager.on('input-waiting', (sessionId: string) => {
      this.notifyInputWaiting(sessionId)
    })

    console.log('Telegram bot started')
  }

  stop(): void {
    if (this.bot) {
      this.bot.stopPolling()
      this.bot = null
    }
  }

  private async handleWithLlm(chatId: number | string, userMessage: string): Promise<void> {
    if (!this.openai || !this.bot) return

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ]

    try {
      // Tool-use loop: keep calling until the model produces a final text response
      for (let i = 0; i < 5; i++) {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages,
          tools,
        })

        const choice = response.choices[0]
        if (!choice.message) break

        messages.push(choice.message)

        // If no tool calls, we have the final response
        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
          const text = choice.message.content
          if (text) {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
          }
          return
        }

        // Execute each tool call
        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type !== 'function') continue
          const args = JSON.parse(toolCall.function.arguments || '{}')
          const result = await this.executeTool(toolCall.function.name, args)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          })
        }
      }

      // If we exhausted the loop without a text response
      await this.bot.sendMessage(chatId, 'Done.')
    } catch (err) {
      console.error('LLM error:', err)
      await this.bot.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'get_status': {
        const sessions = this.sessionManager.getAllSessionsStatus()
        return sessions.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          inputWaiting: s.inputWaiting,
          cwd: s.currentCwd ?? s.cwd,
          exitCode: s.exitCode,
          recentLines: s.recentLines,
          projectName: s.projectName,
        }))
      }

      case 'get_projects': {
        const projects = getProjects()
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          sessionCount: p.sessions.length,
          sessions: p.sessions.map((s) => ({ id: s.id, name: s.name })),
          taskCount: (p.tasks ?? []).length,
        }))
      }

      case 'get_session_logs': {
        const id = args.session_id as string
        const n = Math.min((args.lines as number) || 20, 100)
        const lines = this.sessionManager.getRecentLines(id, n)
        if (lines === null) return { error: 'Session not found' }
        return { sessionId: id, lines }
      }

      case 'send_command': {
        const id = args.session_id as string
        const cmd = args.command as string
        const ok = this.sessionManager.writeToSession(id, cmd + '\r')
        if (!ok) return { error: 'Session not found' }
        return { ok: true, sessionId: id, command: cmd }
      }

      case 'add_backlog_item': {
        const projectId = args.project_id as string
        const title = args.title as string
        const description = (args.description as string) || ''
        try {
          const task = addTask(projectId, { title, description, status: 'backlog' })
          return { ok: true, taskId: task.id, title: task.title }
        } catch (err) {
          return { error: String(err) }
        }
      }

      case 'get_tasks': {
        const projectId = args.project_id as string
        const tasks = getTasksForProject(projectId)
        return tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          description: t.description || undefined,
          command: t.command || undefined,
        }))
      }

      default:
        return { error: `Unknown tool: ${name}` }
    }
  }

  private async notifyInputWaiting(sessionId: string): Promise<void> {
    if (!this.bot) return

    const sessions = this.sessionManager.getAllSessionsStatus()
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return

    const recentLines = this.sessionManager.getRecentLines(sessionId, 8) ?? []
    const preview = recentLines.join('\n')

    const text = [
      `\u26a0\ufe0f *Input needed* \u2014 *${escapeMarkdown(session.name)}*`,
      session.currentCwd ? `\`${session.currentCwd}\`` : '',
      '',
      '```',
      preview || '(no output)',
      '```',
      '',
      '_Reply to this message to send input._',
    ]
      .filter((l) => l !== '')
      .join('\n')

    try {
      const sent = await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'Markdown',
        disable_notification: false,
      })
      messageToSession.set(sent.message_id, sessionId)

      if (messageToSession.size > 200) {
        const keys = [...messageToSession.keys()]
        for (let i = 0; i < keys.length - 200; i++) {
          messageToSession.delete(keys[i])
        }
      }
    } catch (err) {
      console.error('Telegram send error:', err)
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}
