export type User = {
  id: number
  name: string
  email: string
  created_at: string
}

export type Project = {
  id: number
  user_id: number
  name: string
  description: string
  system_prompt: string
  created_at: string
  updated_at: string
  message_count?: number
  file_count?: number
  prompt_count?: number
}

export type Message = {
  id: number
  project_id: number
  role: 'user' | 'assistant'
  content: string
  provider: string
  model: string
  response_id: string
  created_at: string
}

export type Prompt = {
  id: number
  project_id: number
  title: string
  content: string
  created_at: string
}

export type FileRecord = {
  id: number
  project_id: number
  original_name: string
  mime_type: string
  size: number
  openai_file_id: string
  upload_error: string
  created_at: string
}

export type AuthResponse = {
  token: string
  user: User
}

export type ProjectDetail = {
  project: Project
  prompts: Prompt[]
  files: FileRecord[]
  messages: Message[]
}

export type Health = {
  ok: boolean
  provider: 'openai' | 'openrouter' | 'demo'
  model: string
}
