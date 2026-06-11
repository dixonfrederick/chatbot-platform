import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import helmet from 'helmet'
import multer from 'multer'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config, isProduction } from './config.js'
import { db } from './db.js'
import { publicUser, requireAuth, signToken } from './auth.js'
import { createAssistantReply, getLlmStatus, uploadFileToOpenAI } from './llm.js'

const app = express()
const activeRunControllers = new Map()
const STALE_RUN_AFTER_MS = 15 * 60 * 1000

app.disable('x-powered-by')
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
)

if (!isProduction || process.env.CLIENT_ORIGIN) {
  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    }),
  )
}

app.use(express.json({ limit: '1mb' }))

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadsDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname)
      callback(null, `${Date.now()}-${randomUUID()}${extension}`)
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function requestBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {}
}

function numberFromCount(value) {
  const count = Number(value)
  return Number.isFinite(count) ? count : 0
}

function normalizeProjectSummary(project) {
  return {
    ...project,
    file_count: numberFromCount(project.file_count),
    message_count: numberFromCount(project.message_count),
    prompt_count: numberFromCount(project.prompt_count),
  }
}

async function getProjectForUser(projectId, userId) {
  return db.get('SELECT * FROM projects WHERE id = ? AND user_id = ?', [projectId, userId])
}

function sqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

async function markStaleRunsFailed(userId) {
  await db.run(
    `
      UPDATE chat_runs
      SET
        status = 'failed',
        error = 'The workflow stopped reporting before it finished.',
        updated_at = CURRENT_TIMESTAMP,
        completed_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND status = 'running' AND updated_at < ?
    `,
    [userId, sqlTimestamp(new Date(Date.now() - STALE_RUN_AFTER_MS))],
  )
}

async function projectSummaryRows(userId) {
  await markStaleRunsFailed(userId)

  const projects = await db.all(
    `
        SELECT
          p.*,
          (SELECT COUNT(*) FROM messages m WHERE m.project_id = p.id) AS message_count,
          (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count,
          (SELECT COUNT(*) FROM prompts pr WHERE pr.project_id = p.id) AS prompt_count,
          (
            SELECT r.id
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_id,
          (
            SELECT r.status
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_status,
          (
            SELECT r.error
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_error,
          (
            SELECT r.created_at
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_created_at,
          (
            SELECT r.updated_at
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_updated_at,
          (
            SELECT r.completed_at
            FROM chat_runs r
            WHERE r.project_id = p.id AND r.user_id = p.user_id
            ORDER BY r.id DESC
            LIMIT 1
          ) AS latest_run_completed_at
        FROM projects p
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC, p.id DESC
      `,
    [userId],
  )

  return projects.map(normalizeProjectSummary)
}

async function getMessages(projectId, userId) {
  const messages = await db.all(
    `
        SELECT id, project_id, role, content, provider, model, response_id, created_at
        FROM messages
        WHERE project_id = ? AND user_id = ?
        ORDER BY id ASC
      `,
    [projectId, userId],
  )

  return hydrateMessages(projectId, userId, messages)
}

function attachmentNamesFromContent(content) {
  const match = String(content || '').match(/\n{2,}Attached:\s*(.+)$/)

  if (!match) {
    return []
  }

  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

async function hydrateMessages(projectId, userId, messages) {
  if (messages.length === 0) {
    return []
  }

  const files = await getFiles(projectId, userId, { order: 'ASC' })
  const filesByMessageId = new Map()
  const unlinkedFiles = []

  for (const file of files) {
    if (file.message_id) {
      const messageId = Number(file.message_id)
      filesByMessageId.set(messageId, [...(filesByMessageId.get(messageId) || []), file])
    } else {
      unlinkedFiles.push(file)
    }
  }

  const legacyFileIds = new Set()

  return messages.map((message) => {
    const attachments = [...(filesByMessageId.get(Number(message.id)) || [])]
    const legacyNames = attachmentNamesFromContent(message.content)

    for (const fileName of legacyNames) {
      const legacyFile = unlinkedFiles.find(
        (file) => !legacyFileIds.has(file.id) && file.original_name === fileName,
      )

      if (legacyFile) {
        legacyFileIds.add(legacyFile.id)
        attachments.push(legacyFile)
      }
    }

    return {
      ...message,
      attachments,
    }
  })
}

async function getLatestRun(projectId, userId) {
  return db.get(
    `
      SELECT
        id,
        project_id,
        user_id,
        user_message_id,
        assistant_message_id,
        status,
        error,
        provider,
        model,
        response_id,
        created_at,
        updated_at,
        completed_at
      FROM chat_runs
      WHERE project_id = ? AND user_id = ?
      ORDER BY id DESC
    `,
    [projectId, userId],
  )
}

async function getRunById(runId, userId) {
  return db.get(
    `
      SELECT
        id,
        project_id,
        user_id,
        user_message_id,
        assistant_message_id,
        status,
        error,
        provider,
        model,
        response_id,
        created_at,
        updated_at,
        completed_at
      FROM chat_runs
      WHERE id = ? AND user_id = ?
    `,
    [runId, userId],
  )
}

async function getRunningRun(projectId, userId) {
  return db.get(
    `
      SELECT
        id,
        project_id,
        user_id,
        user_message_id,
        assistant_message_id,
        status,
        error,
        provider,
        model,
        response_id,
        created_at,
        updated_at,
        completed_at
      FROM chat_runs
      WHERE project_id = ? AND user_id = ? AND status = 'running'
      ORDER BY id DESC
    `,
    [projectId, userId],
  )
}

async function markRun(runId, userId, status, fields = {}) {
  const completedAtSql = status === 'running' ? 'NULL' : 'CURRENT_TIMESTAMP'

  await db.run(
    `
      UPDATE chat_runs
      SET
        status = ?,
        error = ?,
        provider = ?,
        model = ?,
        response_id = ?,
        assistant_message_id = ?,
        updated_at = CURRENT_TIMESTAMP,
        completed_at = ${completedAtSql}
      WHERE id = ? AND user_id = ?
    `,
    [
      status,
      fields.error || '',
      fields.provider || '',
      fields.model || '',
      fields.responseId || '',
      fields.assistantMessageId || null,
      runId,
      userId,
    ],
  )

  return getRunById(runId, userId)
}

async function stopRunningRun(projectId, userId) {
  const run = await getRunningRun(projectId, userId)

  if (!run) {
    return null
  }

  const stoppedRun = await markRun(run.id, userId, 'cancelled', {
    error: 'Stopped by user.',
  })

  activeRunControllers.get(Number(run.id))?.abort()

  return stoppedRun
}

function isAbortError(error) {
  const message = String(error?.message || '').toLowerCase()
  return error?.name === 'AbortError' || error?.name === 'APIUserAbortError' || message.includes('aborted')
}

function providerStatusFromError(error) {
  const status = Number(error?.providerStatus || error?.status || error?.response?.status || error?.code)
  return Number.isFinite(status) ? status : 0
}

function providerDetailFromError(error) {
  const detail =
    error?.providerDetail ||
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    ''

  return typeof detail === 'string' ? detail.replace(/\s+/g, ' ').trim() : JSON.stringify(detail)
}

function chatFailureResponse(error) {
  const status = providerStatusFromError(error)
  const detail = providerDetailFromError(error)
  const lowerDetail = detail.toLowerCase()

  if (status === 429 || lowerDetail.includes('429') || lowerDetail.includes('rate limit')) {
    return {
      detail: '',
      error:
        'The model provider is rate limited right now. I retried the request a few times, but it is still busy. Please wait a moment and send again.',
      statusCode: 429,
    }
  }

  if (lowerDetail.includes('no endpoints found') && lowerDetail.includes('image input')) {
    return {
      detail:
        'The current OpenRouter model does not expose a working vision endpoint for this request.',
      error:
        'This model cannot read image attachments right now. Switch to a vision-capable model or send the image content as text.',
      statusCode: 502,
    }
  }

  if (status >= 500 || status === 408 || status === 409 || status === 425) {
    return {
      detail: '',
      error:
        'The model provider is temporarily unavailable. I retried the request, but it still failed. Please try again in a moment.',
      statusCode: 502,
    }
  }

  return {
    detail: detail ? `Provider message: ${detail.slice(0, 280)}` : '',
    error: 'The model provider rejected this request.',
    statusCode: 502,
  }
}

async function getFiles(projectId, userId, options = {}) {
  const order = options.order === 'ASC' ? 'ASC' : 'DESC'

  return db.all(
    `
        SELECT id, project_id, message_id, original_name, mime_type, size, openai_file_id, upload_error, created_at
        FROM files
        WHERE project_id = ? AND user_id = ?
        ORDER BY id ${order}
      `,
    [projectId, userId],
  )
}

async function getPrompts(projectId, userId) {
  return db.all(
    `
        SELECT id, project_id, title, content, created_at
        FROM prompts
        WHERE project_id = ? AND user_id = ?
        ORDER BY id DESC
      `,
    [projectId, userId],
  )
}

function deleteUploadedFile(file) {
  if (file?.path) {
    fs.rm(file.path, { force: true }, () => {})
  }
}

async function persistUploadedFile(projectId, userId, file, messageId = null) {
  let openaiFileId = ''
  let uploadError = ''

  try {
    openaiFileId = (await uploadFileToOpenAI(file.path)) || ''
  } catch (error) {
    uploadError = error.message || 'OpenAI upload failed.'
  }

  const result = await db.run(
    `
        INSERT INTO files (
          project_id,
          user_id,
          message_id,
          original_name,
          stored_name,
          mime_type,
          size,
          openai_file_id,
          upload_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    [
      projectId,
      userId,
      messageId,
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
      openaiFileId,
      uploadError,
    ],
  )

  return db.get(
    `
      SELECT id, project_id, message_id, original_name, mime_type, size, openai_file_id, upload_error, created_at
      FROM files
      WHERE id = ?
    `,
    [result.lastInsertRowid],
  )
}

app.get('/api/health', (_req, res) => {
  const llmStatus = getLlmStatus()

  res.json({
    ok: true,
    provider: llmStatus.provider,
    model: llmStatus.model,
  })
})

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const body = requestBody(req)
    const name = cleanString(body.name)
    const email = cleanString(body.email).toLowerCase()
    const password = cleanString(body.password)

    if (!name || !isEmail(email) || password.length < 8) {
      return res.status(400).json({
        error: 'Name, a valid email, and a password of at least 8 characters are required.',
      })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const result = await db.run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [
      name,
      email,
      passwordHash,
    ])
    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid])

    return res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
    })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
      return res.status(409).json({ error: 'An account already exists for that email.' })
    }
    return next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const body = requestBody(req)
    const email = cleanString(body.email).toLowerCase()
    const password = cleanString(body.password)
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email])

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    return res.json({
      token: signToken(user),
      user: publicUser(user),
    })
  } catch (error) {
    return next(error)
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

app.get('/api/projects', requireAuth, async (req, res) => {
  res.json({ projects: await projectSummaryRows(req.user.id) })
})

app.post('/api/projects', requireAuth, async (req, res) => {
  const body = requestBody(req)
  const name = cleanString(body.name)
  const description = cleanString(body.description)
  const systemPrompt = cleanString(body.system_prompt)

  if (!name) {
    return res.status(400).json({ error: 'Project name is required.' })
  }

  const result = await db.run(
    `
        INSERT INTO projects (user_id, name, description, system_prompt)
        VALUES (?, ?, ?, ?)
      `,
    [req.user.id, name, description, systemPrompt],
  )

  if (systemPrompt) {
    await db.run(
      `
        INSERT INTO prompts (project_id, user_id, title, content)
        VALUES (?, ?, ?, ?)
      `,
      [result.lastInsertRowid, req.user.id, 'Initial prompt', systemPrompt],
    )
  }

  const project = await getProjectForUser(result.lastInsertRowid, req.user.id)
  return res.status(201).json({ project })
})

app.get('/api/projects/:projectId', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  await markStaleRunsFailed(req.user.id)

  return res.json({
    project,
    prompts: await getPrompts(projectId, req.user.id),
    files: await getFiles(projectId, req.user.id),
    messages: await getMessages(projectId, req.user.id),
    run: await getLatestRun(projectId, req.user.id),
  })
})

app.patch('/api/projects/:projectId', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const current = await getProjectForUser(projectId, req.user.id)
  const body = requestBody(req)

  if (!current) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  const name = cleanString(body.name || current.name)
  const description =
    typeof body.description === 'string' ? body.description.trim() : current.description
  const systemPrompt =
    typeof body.system_prompt === 'string'
      ? body.system_prompt.trim()
      : current.system_prompt

  if (!name) {
    return res.status(400).json({ error: 'Project name is required.' })
  }

  await db.run(
    `
      UPDATE projects
      SET name = ?, description = ?, system_prompt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [name, description, systemPrompt, projectId, req.user.id],
  )

  return res.json({ project: await getProjectForUser(projectId, req.user.id) })
})

app.delete('/api/projects/:projectId', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  await db.run('DELETE FROM projects WHERE id = ? AND user_id = ?', [projectId, req.user.id])
  return res.status(204).send()
})

app.post('/api/projects/:projectId/prompts', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)
  const body = requestBody(req)
  const title = cleanString(body.title) || 'Prompt'
  const content = cleanString(body.content)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  if (!content) {
    return res.status(400).json({ error: 'Prompt content is required.' })
  }

  const result = await db.run(
    `
        INSERT INTO prompts (project_id, user_id, title, content)
        VALUES (?, ?, ?, ?)
      `,
    [projectId, req.user.id, title, content],
  )

  await db.run(
    `
      UPDATE projects
      SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [content, projectId, req.user.id],
  )

  const prompt = await db.get('SELECT * FROM prompts WHERE id = ?', [result.lastInsertRowid])

  return res.status(201).json({
    prompt,
    project: await getProjectForUser(projectId, req.user.id),
  })
})

app.get('/api/projects/:projectId/messages', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  return res.json({ messages: await getMessages(projectId, req.user.id) })
})

app.post('/api/projects/:projectId/chat/stop', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  const run = await stopRunningRun(projectId, req.user.id)

  return res.json({
    run,
    messages: await getMessages(projectId, req.user.id),
  })
})

app.post('/api/projects/:projectId/chat', requireAuth, upload.array('files', 5), async (req, res, next) => {
  const uploadedFiles = Array.isArray(req.files) ? req.files : []
  let projectId
  let runId
  let userMessage = null
  let savedFiles = []

  try {
    projectId = Number(req.params.projectId)
    const project = await getProjectForUser(projectId, req.user.id)
    const body = requestBody(req)
    const message =
      cleanString(body.message) ||
      (uploadedFiles.length > 0 ? 'Please analyze the attached file.' : '')

    if (!project) {
      uploadedFiles.forEach(deleteUploadedFile)
      return res.status(404).json({ error: 'Project not found.' })
    }

    if (!message) {
      uploadedFiles.forEach(deleteUploadedFile)
      return res.status(400).json({ error: 'Message is required.' })
    }

    const runningRun = await getRunningRun(projectId, req.user.id)

    if (runningRun) {
      uploadedFiles.forEach(deleteUploadedFile)
      return res.status(409).json({
        error: 'This agent is already thinking.',
        run: runningRun,
      })
    }

    const runResult = await db.run(
      `
        INSERT INTO chat_runs (project_id, user_id, status)
        VALUES (?, ?, 'running')
      `,
      [projectId, req.user.id],
    )
    runId = runResult.lastInsertRowid

    const controller = new AbortController()
    activeRunControllers.set(Number(runId), controller)

    const history = await getMessages(projectId, req.user.id)
    const files = await getFiles(projectId, req.user.id)
    const userResult = await db.run(
      `
        INSERT INTO messages (project_id, user_id, role, content, provider)
        VALUES (?, ?, 'user', ?, 'user')
      `,
      [projectId, req.user.id, message],
    )

    await db.run(
      `
        UPDATE chat_runs
        SET user_message_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [userResult.lastInsertRowid, runId, req.user.id],
    )
    savedFiles = []

    for (const file of uploadedFiles) {
      savedFiles.push(await persistUploadedFile(projectId, req.user.id, file, userResult.lastInsertRowid))
    }

    userMessage = {
      ...(await db.get('SELECT * FROM messages WHERE id = ?', [userResult.lastInsertRowid])),
      attachments: savedFiles,
    }

    const reply = await createAssistantReply({
      attachments: uploadedFiles,
      files: [...files, ...savedFiles],
      history,
      message,
      project,
      signal: controller.signal,
    })
    const currentRun = await getRunById(runId, req.user.id)

    if (currentRun?.status === 'cancelled') {
      return res.status(409).json({
        error: 'Workflow stopped.',
        files: savedFiles,
        messages: userMessage ? [userMessage] : [],
        run: currentRun,
      })
    }

    const assistantResult = await db.run(
      `
        INSERT INTO messages (project_id, user_id, role, content, provider, model, response_id)
        VALUES (?, ?, 'assistant', ?, ?, ?, ?)
      `,
      [projectId, req.user.id, reply.content, reply.provider, reply.model, reply.responseId],
    )
    const assistantMessage = await db.get('SELECT * FROM messages WHERE id = ?', [
      assistantResult.lastInsertRowid,
    ])

    const completedRun = await markRun(runId, req.user.id, 'completed', {
      assistantMessageId: assistantResult.lastInsertRowid,
      model: reply.model,
      provider: reply.provider,
      responseId: reply.responseId,
    })

    await db.run(
      `
        UPDATE projects
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
      [projectId, req.user.id],
    )

    return res.status(201).json({
      messages: [userMessage, assistantMessage].filter(Boolean),
      files: savedFiles,
      provider: reply.provider,
      model: reply.model,
      run: completedRun,
    })
  } catch (error) {
    if (runId) {
      const cancelledRun = await getRunById(runId, req.user.id)

      if (cancelledRun?.status === 'cancelled' || isAbortError(error)) {
        const run =
          cancelledRun?.status === 'cancelled'
            ? cancelledRun
            : await markRun(runId, req.user.id, 'cancelled', {
                error: 'Stopped by user.',
              })

        return res.status(409).json({
          error: 'Workflow stopped.',
          files: savedFiles,
          messages: userMessage ? [userMessage] : [],
          run,
        })
      }

      const failure = chatFailureResponse(error)
      const run = await markRun(runId, req.user.id, 'failed', {
        error: failure.error,
      })

      if (projectId) {
        await db.run(
          `
            UPDATE projects
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
          `,
          [projectId, req.user.id],
        )
      }

      return res.status(failure.statusCode).json({
        error: failure.error,
        detail: failure.detail,
        files: savedFiles,
        messages: userMessage ? [userMessage] : [],
        run,
      })
    }

    if (getLlmStatus().provider !== 'demo') {
      const failure = chatFailureResponse(error)
      return res.status(failure.statusCode).json({
        error: failure.error,
        detail: failure.detail,
      })
    }
    return next(error)
  } finally {
    if (runId) {
      activeRunControllers.delete(Number(runId))
    }
  }
})

app.get('/api/projects/:projectId/files', requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  return res.json({ files: await getFiles(projectId, req.user.id) })
})

app.get('/api/projects/:projectId/files/:fileId/content', requireAuth, async (req, res, next) => {
  const projectId = Number(req.params.projectId)
  const fileId = Number(req.params.fileId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  const file = await db.get(
    `
      SELECT id, project_id, user_id, original_name, stored_name, mime_type, size
      FROM files
      WHERE id = ? AND project_id = ? AND user_id = ?
    `,
    [fileId, projectId, req.user.id],
  )

  if (!file) {
    return res.status(404).json({ error: 'File not found.' })
  }

  const uploadsRoot = path.resolve(config.uploadsDir)
  const filePath = path.resolve(config.uploadsDir, file.stored_name)

  if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) {
    return res.status(404).json({ error: 'File not found.' })
  }

  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream')
  res.setHeader('Content-Length', String(file.size || 0))
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${String(file.original_name).replaceAll('"', '')}"`,
  )

  return res.sendFile(filePath, (error) => {
    if (error && !res.headersSent) {
      next(error)
    }
  })
})

app.post('/api/projects/:projectId/files', requireAuth, upload.single('file'), async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await getProjectForUser(projectId, req.user.id)

  if (!project) {
    deleteUploadedFile(req.file)
    return res.status(404).json({ error: 'Project not found.' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'File is required.' })
  }

  const file = await persistUploadedFile(projectId, req.user.id, req.file)

  await db.run(
    `
      UPDATE projects
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    [projectId, req.user.id],
  )

  return res.status(201).json({ file })
})

if (fs.existsSync(config.clientDistDir)) {
  app.use(express.static(config.clientDistDir))
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(config.clientDistDir, 'index.html'))
  })
}

app.use((error, _req, res, _next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File size limit is 10 MB.' })
  }

  console.error(error)
  return res.status(500).json({ error: 'Unexpected server error.' })
})

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`Chatbot platform API listening on http://localhost:${config.port}`)
  })
}

export default app
