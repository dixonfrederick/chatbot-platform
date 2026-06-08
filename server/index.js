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

function getProjectForUser(projectId, userId) {
  return db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId)
}

function projectSummaryRows(userId) {
  return db
    .prepare(
      `
        SELECT
          p.*,
          (SELECT COUNT(*) FROM messages m WHERE m.project_id = p.id) AS message_count,
          (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count,
          (SELECT COUNT(*) FROM prompts pr WHERE pr.project_id = p.id) AS prompt_count
        FROM projects p
        WHERE p.user_id = ?
        ORDER BY p.updated_at DESC, p.id DESC
      `,
    )
    .all(userId)
}

function getMessages(projectId, userId) {
  return db
    .prepare(
      `
        SELECT id, project_id, role, content, provider, model, response_id, created_at
        FROM messages
        WHERE project_id = ? AND user_id = ?
        ORDER BY id ASC
      `,
    )
    .all(projectId, userId)
}

function getFiles(projectId, userId) {
  return db
    .prepare(
      `
        SELECT id, project_id, original_name, mime_type, size, openai_file_id, upload_error, created_at
        FROM files
        WHERE project_id = ? AND user_id = ?
        ORDER BY id DESC
      `,
    )
    .all(projectId, userId)
}

function getPrompts(projectId, userId) {
  return db
    .prepare(
      `
        SELECT id, project_id, title, content, created_at
        FROM prompts
        WHERE project_id = ? AND user_id = ?
        ORDER BY id DESC
      `,
    )
    .all(projectId, userId)
}

function deleteUploadedFile(file) {
  if (file?.path) {
    fs.rm(file.path, { force: true }, () => {})
  }
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
    const name = cleanString(req.body.name)
    const email = cleanString(req.body.email).toLowerCase()
    const password = cleanString(req.body.password)

    if (!name || !isEmail(email) || password.length < 8) {
      return res.status(400).json({
        error: 'Name, a valid email, and a password of at least 8 characters are required.',
      })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name, email, passwordHash)
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)

    return res.status(201).json({
      token: signToken(user),
      user: publicUser(user),
    })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'An account already exists for that email.' })
    }
    return next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = cleanString(req.body.email).toLowerCase()
    const password = cleanString(req.body.password)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)

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

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: projectSummaryRows(req.user.id) })
})

app.post('/api/projects', requireAuth, (req, res) => {
  const name = cleanString(req.body.name)
  const description = cleanString(req.body.description)
  const systemPrompt = cleanString(req.body.system_prompt)

  if (!name) {
    return res.status(400).json({ error: 'Project name is required.' })
  }

  const result = db
    .prepare(
      `
        INSERT INTO projects (user_id, name, description, system_prompt)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(req.user.id, name, description, systemPrompt)

  if (systemPrompt) {
    db.prepare(
      `
        INSERT INTO prompts (project_id, user_id, title, content)
        VALUES (?, ?, ?, ?)
      `,
    ).run(result.lastInsertRowid, req.user.id, 'Initial prompt', systemPrompt)
  }

  const project = getProjectForUser(result.lastInsertRowid, req.user.id)
  return res.status(201).json({ project })
})

app.get('/api/projects/:projectId', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  return res.json({
    project,
    prompts: getPrompts(projectId, req.user.id),
    files: getFiles(projectId, req.user.id),
    messages: getMessages(projectId, req.user.id),
  })
})

app.patch('/api/projects/:projectId', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const current = getProjectForUser(projectId, req.user.id)

  if (!current) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  const name = cleanString(req.body.name || current.name)
  const description =
    typeof req.body.description === 'string' ? req.body.description.trim() : current.description
  const systemPrompt =
    typeof req.body.system_prompt === 'string'
      ? req.body.system_prompt.trim()
      : current.system_prompt

  if (!name) {
    return res.status(400).json({ error: 'Project name is required.' })
  }

  db.prepare(
    `
      UPDATE projects
      SET name = ?, description = ?, system_prompt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
  ).run(name, description, systemPrompt, projectId, req.user.id)

  return res.json({ project: getProjectForUser(projectId, req.user.id) })
})

app.delete('/api/projects/:projectId', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(projectId, req.user.id)
  return res.status(204).send()
})

app.post('/api/projects/:projectId/prompts', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)
  const title = cleanString(req.body.title) || 'Prompt'
  const content = cleanString(req.body.content)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  if (!content) {
    return res.status(400).json({ error: 'Prompt content is required.' })
  }

  const result = db
    .prepare(
      `
        INSERT INTO prompts (project_id, user_id, title, content)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(projectId, req.user.id, title, content)

  db.prepare(
    `
      UPDATE projects
      SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
  ).run(content, projectId, req.user.id)

  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(result.lastInsertRowid)

  return res.status(201).json({
    prompt,
    project: getProjectForUser(projectId, req.user.id),
  })
})

app.get('/api/projects/:projectId/messages', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  return res.json({ messages: getMessages(projectId, req.user.id) })
})

app.post('/api/projects/:projectId/chat', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId)
    const project = getProjectForUser(projectId, req.user.id)
    const message = cleanString(req.body.message)

    if (!project) {
      return res.status(404).json({ error: 'Project not found.' })
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required.' })
    }

    const history = getMessages(projectId, req.user.id)
    const files = getFiles(projectId, req.user.id)
    const userResult = db
      .prepare(
        `
          INSERT INTO messages (project_id, user_id, role, content, provider)
          VALUES (?, ?, 'user', ?, 'user')
        `,
      )
      .run(projectId, req.user.id, message)

    const reply = await createAssistantReply({ project, history, message, files })
    const assistantResult = db
      .prepare(
        `
          INSERT INTO messages (project_id, user_id, role, content, provider, model, response_id)
          VALUES (?, ?, 'assistant', ?, ?, ?, ?)
        `,
      )
      .run(projectId, req.user.id, reply.content, reply.provider, reply.model, reply.responseId)

    db.prepare(
      `
        UPDATE projects
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `,
    ).run(projectId, req.user.id)

    return res.status(201).json({
      messages: [
        db.prepare('SELECT * FROM messages WHERE id = ?').get(userResult.lastInsertRowid),
        db.prepare('SELECT * FROM messages WHERE id = ?').get(assistantResult.lastInsertRowid),
      ],
      provider: reply.provider,
      model: reply.model,
    })
  } catch (error) {
    if (getLlmStatus().provider !== 'demo') {
      return res.status(502).json({
        error: 'The LLM provider could not complete the request.',
        detail: error.message,
      })
    }
    return next(error)
  }
})

app.get('/api/projects/:projectId/files', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)

  if (!project) {
    return res.status(404).json({ error: 'Project not found.' })
  }

  return res.json({ files: getFiles(projectId, req.user.id) })
})

app.post('/api/projects/:projectId/files', requireAuth, upload.single('file'), async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = getProjectForUser(projectId, req.user.id)

  if (!project) {
    deleteUploadedFile(req.file)
    return res.status(404).json({ error: 'Project not found.' })
  }

  if (!req.file) {
    return res.status(400).json({ error: 'File is required.' })
  }

  let openaiFileId = ''
  let uploadError = ''

  try {
    openaiFileId = (await uploadFileToOpenAI(req.file.path)) || ''
  } catch (error) {
    uploadError = error.message || 'OpenAI upload failed.'
  }

  const result = db
    .prepare(
      `
        INSERT INTO files (
          project_id,
          user_id,
          original_name,
          stored_name,
          mime_type,
          size,
          openai_file_id,
          upload_error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      projectId,
      req.user.id,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      openaiFileId,
      uploadError,
    )

  db.prepare(
    `
      UPDATE projects
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
  ).run(projectId, req.user.id)

  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid)
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

app.listen(config.port, () => {
  console.log(`Chatbot platform API listening on http://localhost:${config.port}`)
})

export default app
