import OpenAI from 'openai'
import { createReadStream } from 'node:fs'
import { config } from './config.js'

const openai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null

function buildDemoReply({ project, message, files }) {
  const prompt = project.system_prompt
    ? `I am following this agent prompt: "${project.system_prompt.slice(0, 220)}".`
    : 'No custom agent prompt is configured yet.'
  const fileNote =
    files.length > 0
      ? `I can see ${files.length} file record${files.length === 1 ? '' : 's'} attached to this project.`
      : 'No project files have been attached yet.'

  return [
    'Demo provider response.',
    prompt,
    fileNote,
    `You asked: "${message}".`,
    'Set OPENAI_API_KEY to route this endpoint through the OpenAI Responses API.',
  ].join(' ')
}

export async function createAssistantReply({ project, history, message, files }) {
  if (!openai) {
    return {
      content: buildDemoReply({ project, message, files }),
      provider: 'demo',
      model: 'local-demo',
      responseId: '',
    }
  }

  const input = [
    ...history.slice(-12).map((item) => ({
      role: item.role,
      content: item.content,
    })),
    { role: 'user', content: message },
  ]

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
