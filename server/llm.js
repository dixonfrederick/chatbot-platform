import OpenAI from 'openai'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { config } from './config.js'

const requestedProvider =
  config.llmProvider ||
  (config.openRouterApiKey ? 'openrouter' : config.openaiApiKey ? 'openai' : 'demo')

const openai =
  requestedProvider === 'openai' && config.openaiApiKey
    ? new OpenAI({ apiKey: config.openaiApiKey })
    : null

const openRouter =
  requestedProvider === 'openrouter' && config.openRouterApiKey
    ? new OpenAI({
        apiKey: config.openRouterApiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'http://localhost:4000',
          'X-Title': 'Chatbot YellowAI Dixon',
        },
      })
    : null

export function getLlmStatus() {
  if (openRouter) {
    return {
      model: config.openRouterModel,
      provider: 'openrouter',
    }
  }

  if (openai) {
    return {
      model: config.openaiModel,
      provider: 'openai',
    }
  }

  return {
    model: 'local-demo',
    provider: 'demo',
  }
}

const readableTextMimes = new Set([
  'application/json',
  'application/ld+json',
  'application/rtf',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
])

function isReadableTextFile(file) {
  return file.mimetype?.startsWith('text/') || readableTextMimes.has(file.mimetype)
}

function isImageFile(file) {
  return ['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
}

function isPdfFile(file) {
  return file.mimetype === 'application/pdf'
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))]
}

function isImageEndpointError(error) {
  const message = String(error?.message || '').toLowerCase()

  return (
    Number(error?.status || error?.code) === 404 &&
    message.includes('no endpoints found') &&
    message.includes('image input')
  )
}

async function readTextAttachment(file) {
  if (!isReadableTextFile(file)) {
    return ''
  }

  const text = await readFile(file.path, 'utf8')
  return text.slice(0, 12000)
}

async function buildTextAttachmentContext(attachments) {
  const blocks = []

  for (const file of attachments) {
    const text = await readTextAttachment(file)

    if (text) {
      blocks.push(`File: ${file.originalname}\n${text}`)
    } else if (!isImageFile(file) && !isPdfFile(file)) {
      blocks.push(`File: ${file.originalname}\nThis file type was attached but could not be read as text.`)
    }
  }

  return blocks.length ? `\n\nAttached file context:\n${blocks.join('\n\n---\n\n')}` : ''
}

async function readAttachmentDataUrl(file) {
  const base64 = (await readFile(file.path)).toString('base64')
  return `data:${file.mimetype};base64,${base64}`
}

async function buildOpenRouterUserContent(message, attachments) {
  const textContext = await buildTextAttachmentContext(attachments)
  const content = [
    {
      type: 'text',
      text: `${message}${textContext}`,
    },
  ]

  for (const file of attachments) {
    if (!isImageFile(file) && !isPdfFile(file)) {
      continue
    }

    const dataUrl = await readAttachmentDataUrl(file)

    if (isImageFile(file)) {
      content.push({
        type: 'image_url',
        image_url: {
          url: dataUrl,
        },
      })
    }

    if (isPdfFile(file)) {
      content.push({
        type: 'file',
        file: {
          filename: file.originalname,
          file_data: dataUrl,
        },
      })
    }
  }

  return content
}

async function buildOpenAiUserContent(message, attachments, textContext) {
  const content = [
    {
      type: 'input_text',
      text: `${message}${textContext}`,
    },
  ]

  for (const file of attachments) {
    if (!isImageFile(file)) {
      continue
    }

    content.push({
      type: 'input_image',
      image_url: await readAttachmentDataUrl(file),
    })
  }

  return content
}

function buildDemoReply({ project, message, files, attachments }) {
  const prompt = project.system_prompt
    ? `I am following this agent prompt: "${project.system_prompt.slice(0, 220)}".`
    : 'No custom agent prompt is configured yet.'
  const attachmentNote =
    attachments.length > 0
      ? `This message included ${attachments.length} file attachment${attachments.length === 1 ? '' : 's'}: ${attachments.map((file) => file.originalname).join(', ')}.`
      : files.length > 0
        ? `This project has ${files.length} prior file record${files.length === 1 ? '' : 's'}.`
        : 'No files have been attached yet.'
  const providerNote =
    requestedProvider === 'openrouter'
      ? 'Set OPENROUTER_API_KEY to route this endpoint through OpenRouter.'
      : 'Set OPENAI_API_KEY to route this endpoint through the OpenAI Responses API.'

  return [
    'Demo provider response.',
    prompt,
    attachmentNote,
    `You asked: "${message}".`,
    providerNote,
  ].join(' ')
}

export async function createAssistantReply({
  project,
  history,
  message,
  files,
  attachments = [],
  signal,
}) {
  if (!openai && !openRouter) {
    return {
      content: buildDemoReply({ project, message, files, attachments }),
      provider: 'demo',
      model: 'local-demo',
      responseId: '',
    }
  }

  const conversation = [
    ...history.slice(-12).map((item) => ({
      role: item.role,
      content: item.content,
    })),
  ]

  if (openRouter) {
    const hasImageAttachment = attachments.some(isImageFile)
    const openRouterModels = hasImageAttachment
      ? uniqueValues([
          config.openRouterVisionModel,
          'nvidia/nemotron-nano-12b-v2-vl:free',
          'nex-agi/nex-n2-pro:free',
        ])
      : [config.openRouterModel]
    const userContent =
      attachments.length > 0 ? await buildOpenRouterUserContent(message, attachments) : message
    const messages = [
      ...(project.system_prompt
        ? [{ role: 'system', content: project.system_prompt }]
        : []),
      ...conversation,
      { role: 'user', content: userContent },
    ]

    let lastImageError = null

    for (const openRouterModel of openRouterModels) {
      const payload = {
        messages,
        model: openRouterModel,
      }

      if (attachments.some(isPdfFile)) {
        payload.plugins = [
          {
            id: 'file-parser',
            pdf: {
              engine: 'cloudflare-ai',
            },
          },
        ]
      }

      try {
        const response = await openRouter.chat.completions.create(payload, { signal })
        const choice = response.choices?.[0]?.message?.content

        return {
          content:
            (typeof choice === 'string' ? choice.trim() : '') ||
            'The model completed the request but did not return text output.',
          provider: 'openrouter',
          model: response.model || openRouterModel,
          responseId: response.id || '',
        }
      } catch (error) {
        if (!hasImageAttachment || !isImageEndpointError(error)) {
          throw error
        }

        lastImageError = error
      }
    }

    if (lastImageError) {
      throw lastImageError
    }
  }

  const hasImageAttachment = attachments.some(isImageFile)
  const textContext = await buildTextAttachmentContext(attachments)
  const userContent = hasImageAttachment
    ? await buildOpenAiUserContent(message, attachments, textContext)
    : `${message}${textContext}`
  const input = [...conversation, { role: 'user', content: userContent }]
  const response = await openai.responses.create(
    {
      model: config.openaiModel,
      instructions: project.system_prompt || undefined,
      input,
    },
    { signal },
  )

  return {
    content:
      response.output_text?.trim() ||
      'The model completed the request but did not return text output.',
    provider: 'openai',
    model: config.openaiModel,
    responseId: response.id || '',
  }
}

export async function uploadFileToOpenAI(filePath) {
  if (!openai) {
    return null
  }

  const uploaded = await openai.files.create({
    file: createReadStream(filePath),
    purpose: 'assistants',
  })

  return uploaded.id
}
