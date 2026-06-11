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
  latest_run_id?: number | null
  latest_run_status?: ChatRunStatus | null
  latest_run_error?: string | null
  latest_run_created_at?: string | null
  latest_run_updated_at?: string | null
  latest_run_completed_at?: string | null
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
  attachments?: FileRecord[]
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
  message_id: number | null
  original_name: string
  mime_type: string
  size: number
  openai_file_id: string
  upload_error: string
  created_at: string
  preview_url?: string
}

export type ChatRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type ChatRun = {
  id: number
  project_id: number
  user_id: number
  user_message_id: number | null
  assistant_message_id: number | null
  status: ChatRunStatus
  error: string
  provider: string
  model: string
  response_id: string
  created_at: string
  updated_at: string
  completed_at: string | null
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
  run: ChatRun | null
}

export type Health = {
  ok: boolean
  provider: 'openai' | 'openrouter' | 'demo'
  model: string
}
