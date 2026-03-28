import TelegramBot from 'node-telegram-bot-api'
import type { SessionManager } from './session-manager'
import { getProjects, addTask } from './store'

export interface TelegramConfig {
  botToken: string
  chatId: string
}

/**
 * Maps Telegram message IDs to session IDs so replies get routed correctly.
 */
const messageToSession = new Map<number, string>()

export class TelegramBridge {
  private bot: TelegramBot | null = null
  private sessionManager: SessionManager
  private chatId: string
  private botToken: string

  constructor(sessionManager: SessionManager, config: TelegramConfig) {
    this.sessionManager = sessionManager
    this.botToken = config.botToken
    this.chatId = config.chatId
  }

  start(): void {
    this.bot = new TelegramBot(this.botToken, { polling: true })

    // Handle replies to input-waiting messages
    this.bot.on('message', (msg) => {
      // Only accept messages from the configured chat
      if (String(msg.chat.id) !== this.chatId) return
      if (!msg.text) return

      // If it's a reply to one of our messages, route to that session
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

      // Slash commands
      if (msg.text === '/status') {
        this.sendStatus(msg.chat.id)
        return
      }

      if (msg.text === '/waiting') {
        this.sendWaiting(msg.chat.id)
        return
      }

      if (msg.text?.startsWith('/backlog')) {
        this.handleBacklog(msg.chat.id, msg.text.slice('/backlog'.length).trim())
        return
      }

      // Direct send: "sessionName: command"
      const colonIdx = msg.text.indexOf(':')
      if (colonIdx > 0) {
        const targetName = msg.text.slice(0, colonIdx).trim().toLowerCase()
        const command = msg.text.slice(colonIdx + 1).trim()
        if (command) {
          const sessions = this.sessionManager.getAllSessionsStatus()
          const match = sessions.find(
            (s) => s.name.toLowerCase() === targetName || s.id === targetName
          )
          if (match) {
            this.sessionManager.writeToSession(match.id, command + '\r')
            this.bot?.sendMessage(msg.chat.id, `Sent to *${match.name}*`, { parse_mode: 'Markdown' })
            return
          }
        }
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

      // Clean up old mappings (keep last 200)
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

  private async sendStatus(chatId: number | string): Promise<void> {
    const sessions = this.sessionManager.getAllSessionsStatus()
    if (sessions.length === 0) {
      this.bot?.sendMessage(chatId, 'No active sessions.')
      return
    }

    const lines = sessions.map((s) => {
      const icon = s.inputWaiting ? '\u26a0\ufe0f' : s.status === 'running' ? '\u2705' : '\u274c'
      return `${icon} *${escapeMarkdown(s.name)}* \u2014 ${s.status}${s.inputWaiting ? ' (waiting)' : ''}`
    })
    this.bot?.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' })
  }

  private async handleBacklog(chatId: number | string, text: string): Promise<void> {
    const projects = getProjects()
    if (projects.length === 0) {
      this.bot?.sendMessage(chatId, 'No projects found.')
      return
    }

    if (!text) {
      // Show usage + list projects
      const names = projects.map((p) => `• *${escapeMarkdown(p.name)}*`).join('\n')
      this.bot?.sendMessage(
        chatId,
        `Usage: \`/backlog task title\` or \`/backlog project: task title\`\n\nProjects:\n${names}`,
        { parse_mode: 'Markdown' }
      )
      return
    }

    let projectId: string
    let projectName: string
    let title: string

    // Check for "projectName: task title" syntax
    const colonIdx = text.indexOf(':')
    if (colonIdx > 0) {
      const targetName = text.slice(0, colonIdx).trim().toLowerCase()
      const match = projects.find((p) => p.name.toLowerCase() === targetName)
      if (match) {
        projectId = match.id
        projectName = match.name
        title = text.slice(colonIdx + 1).trim()
      } else {
        // No project match — treat the whole thing as the title, use first project
        projectId = projects[0].id
        projectName = projects[0].name
        title = text
      }
    } else {
      // No colon — use first project
      projectId = projects[0].id
      projectName = projects[0].name
      title = text
    }

    if (!title) {
      this.bot?.sendMessage(chatId, 'Please provide a task title.')
      return
    }

    try {
      const task = addTask(projectId, { title, description: '', status: 'backlog' })
      this.bot?.sendMessage(
        chatId,
        `✅ Added to *${escapeMarkdown(projectName)}* backlog:\n${escapeMarkdown(title)}`,
        { parse_mode: 'Markdown' }
      )
    } catch (err) {
      this.bot?.sendMessage(chatId, `Failed to add task: ${err}`)
    }
  }

  private async sendWaiting(chatId: number | string): Promise<void> {
    const sessions = this.sessionManager.getAllSessionsStatus().filter((s) => s.inputWaiting)
    if (sessions.length === 0) {
      this.bot?.sendMessage(chatId, 'No sessions waiting for input.')
      return
    }

    for (const session of sessions) {
      await this.notifyInputWaiting(session.id)
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}
