import { SessionManager } from './session-manager'
import { HttpApiServer } from './http-server'
import { getProjects, getServerToken, getServerPort } from './store'

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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nShutting down...')
  sessionManager.killAll()
  sessionManager.stop()
  server.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  sessionManager.killAll()
  sessionManager.stop()
  server.stop()
  process.exit(0)
})
