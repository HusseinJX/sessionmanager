import { SessionManager } from './session-manager'
import { HttpApiServer } from './http-server'
import { getProjects, getServerToken, getServerPort, getTelegramConfig } from './store'
import { TelegramBridge } from './telegram-bot'

const port = parseInt(process.env.PORT || String(getServerPort()), 10)
const token = process.env.SM_TOKEN || getServerToken()

console.log('=== Session Manager Server ===')
console.log(`Port:  ${port}`)
console.log(`Token: ${token}`)
console.log('')

const sessionManager = new SessionManager()
sessionManager.start()

// Restore sessions from store
const projects = getProjects()
for (const project of projects) {
  for (const session of project.sessions) {
    console.log(`  Starting session: ${session.name} (${session.cwd})`)
    sessionManager.createSession({
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      command: session.command,
      projectId: project.id,
      projectName: project.name,
      status: 'running',
    })
  }
}

const server = new HttpApiServer(sessionManager, port, token)
server.start().then(() => {
  console.log(`\nServer listening on http://0.0.0.0:${port}`)
  console.log(`Web UI: http://localhost:${port}`)
  console.log(`\nUse token above to authenticate.`)
})

// Start Telegram bot if configured
let telegramBridge: TelegramBridge | null = null
const tgToken = process.env.TG_BOT_TOKEN || getTelegramConfig().botToken
const tgChatId = process.env.TG_CHAT_ID || getTelegramConfig().chatId
if (tgToken && tgChatId) {
  telegramBridge = new TelegramBridge(sessionManager, {
    botToken: tgToken,
    chatId: tgChatId,
    openaiApiKey: process.env.OPENAI_API_KEY,
  })
  telegramBridge.start()
  console.log('Telegram bot connected')
} else {
  console.log('Telegram not configured (set TG_BOT_TOKEN + TG_CHAT_ID env vars, or POST /api/telegram/config)')
}

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...')
  telegramBridge?.stop()
  sessionManager.killAll()
  sessionManager.stop()
  server.stop()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
