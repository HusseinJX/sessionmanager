# Planner Backlog API

All requests require a **Bearer token** in the `Authorization` header. The token is the one configured when starting the server (`SM_TOKEN` / `--token`).

## Base URL

```
https://<your-server-host>:<port>
```

## Authentication

```
Authorization: Bearer <your-token>
```

---

## 1. List projects (to get project IDs)

```bash
curl -s https://HOST:PORT/api/projects \
  -H "Authorization: Bearer TOKEN" | jq '.[].id'
```

---

## 2. Add a task to a project's backlog

```
POST /api/projects/:projectId/tasks
Content-Type: application/json
```

**Body:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | **yes** | — | Task title |
| `description` | string | no | `""` | Task details |
| `status` | string | no | `"backlog"` | One of: `backlog`, `todo`, `in-progress`, `done` |

**Example:**

```bash
curl -X POST https://HOST:PORT/api/projects/MY_PROJECT_ID/tasks \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login timeout bug", "description": "Users report 30s hangs", "status": "backlog"}'
```

**Response (201):**

```json
{
  "id": "a1b2c3d4-...",
  "title": "Fix login timeout bug",
  "description": "Users report 30s hangs",
  "status": "backlog",
  "order": 5,
  "createdAt": 1743292800000
}
```

---

## 3. List tasks for a project

```bash
curl https://HOST:PORT/api/projects/MY_PROJECT_ID/tasks \
  -H "Authorization: Bearer TOKEN"
```

---

## 4. Update a task

```
PUT /api/projects/:projectId/tasks/:taskId
```

You can update any field: `title`, `description`, `status`, `order`, `assignedSessionId`, `command`, `cwd`, `completedAt`.

```bash
curl -X PUT https://HOST:PORT/api/projects/PID/tasks/TID \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "todo"}'
```

---

## 5. Delete a task

```bash
curl -X DELETE https://HOST:PORT/api/projects/PID/tasks/TID \
  -H "Authorization: Bearer TOKEN"
```

---

## Quick integration example (add from any tool)

```bash
#!/bin/bash
SM_HOST="https://your-server:8443"
SM_TOKEN="your-token"
PROJECT_ID="your-project-id"

add_to_backlog() {
  curl -s -X POST "$SM_HOST/api/projects/$PROJECT_ID/tasks" \
    -H "Authorization: Bearer $SM_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\": \"$1\", \"description\": \"${2:-}\", \"status\": \"backlog\"}"
}

# Usage:
add_to_backlog "Deploy new auth service" "Needs staging validation first"
```

The task will appear in the **Backlog** column of the planner board immediately.
