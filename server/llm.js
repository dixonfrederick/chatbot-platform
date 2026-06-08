import OpenAI from 'openai'
import { createReadStream } from 'node:fs'
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
          'X-Title': 'Agent Desk',
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

function buildDemoReply({ project, message, files }) {
  const prompt = project.system_prompt
    ? `I am following this agent prompt: "${project.system_prompt.slice(0, 220)}".`
    : 'No custom agent prompt is configured yet.'
  const fileNote =
    files.length > 0
      ? `I can see ${files.length} file record${files.length === 1 ? '' : 's'} attached to this project.`
      : 'No project files have been attached yet.'
  const providerNote =
    requestedProvider === 'openrouter'
      ? 'Set OPENROUTER_API_KEY to route this endpoint through OpenRouter.'
      : 'Set OPENAI_API_KEY to route this endpoint through the OpenAI Responses API.'

  return [
    'Demo provider response.',
    prompt,
    fileNote,
    `You asked: "${message}".`,
    providerNote,
  ].join(' ')
}

export async function createAssistantReply({ project, history, message, files }) {
  if (!openai && !openRouter) {
    return {
      content: buildDemoReply({ project, message, files }),
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
    { role: 'user', content: message },
  ]

  if (openRouter) {
    const messages = [
      ...(project.system_prompt
        ? [{ role: 'system', content: project.system_prompt }]
        : []),
      ...conversation,
    ]

    const response = await openRouter.chat.completions.create({
      messages,
      model: config.openRouterModel,
    })
    const choice = response.choices?.[0]?.message?.content

    return {
      content:
        (typeof choice === 'string' ? choice.trim() : '') ||
        'The model completed the request but did not return text output.',
      provider: 'openrouter',
      model: response.model || config.openRouterModel,
      responseId: response.id || '',
    }
  }

  const input = conversation
  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: project.system_prompt || undefined,
    input,
  })

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
