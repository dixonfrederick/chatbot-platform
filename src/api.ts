import type {
  AuthResponse,
  ChatRun,
  FileRecord,
  Health,
  Message,
  Project,
  ProjectDetail,
  Prompt,
  User,
} from './types'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

type RequestOptions = {
  body?: unknown
  formData?: FormData
  method?: string
  token?: string
}

export class ApiError extends Error {
  detail?: string
  payload?: unknown
  status: number

  constructor(message: string, status: number, detail?: string, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.payload = payload
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`
  }

  let body: BodyInit | undefined

  if (options.formData) {
    body = options.formData
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    body,
    headers,
    method: options.method || 'GET',
  })

  if (response.status === 204) {
    return undefined as T
  }

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      payload.error || 'Request failed.',
      response.status,
      payload.detail,
      payload,
    )
  }

  return payload as T
}

async function requestFile(path: string, token: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))

    throw new ApiError(
      payload.error || 'File request failed.',
      response.status,
      payload.detail,
      payload,
    )
  }

  return response.blob()
}

export const api = {
  health: () => request<Health>('/health'),
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { body, method: 'POST' }),
  register: (body: { email: string; name: string; password: string }) =>
    request<AuthResponse>('/auth/register', { body, method: 'POST' }),
  me: (token: string) => request<{ user: User }>('/auth/me', { token }),
  projects: (token: string) => request<{ projects: Project[] }>('/projects', { token }),
  createProject: (
    token: string,
    body: { description: string; name: string; system_prompt: string },
  ) => request<{ project: Project }>('/projects', { body, method: 'POST', token }),
  projectDetail: (token: string, projectId: number) =>
    request<ProjectDetail>(`/projects/${projectId}`, { token }),
  updateProject: (
    token: string,
    projectId: number,
    body: { description: string; name: string; system_prompt: string },
  ) =>
    request<{ project: Project }>(`/projects/${projectId}`, {
      body,
      method: 'PATCH',
      token,
    }),
  deleteProject: (token: string, projectId: number) =>
    request<void>(`/projects/${projectId}`, { method: 'DELETE', token }),
  savePrompt: (
    token: string,
    projectId: number,
    body: { content: string; title: string },
  ) =>
    request<{ project: Project; prompt: Prompt }>(`/projects/${projectId}/prompts`, {
      body,
      method: 'POST',
      token,
    }),
  sendMessage: (token: string, projectId: number, message: string, files: File[] = []) => {
    if (files.length > 0) {
      const formData = new FormData()
      formData.append('message', message)
      files.forEach((file) => formData.append('files', file))

      return request<{
        files: FileRecord[]
        messages: Message[]
        model: string
        provider: string
        run: ChatRun
      }>(`/projects/${projectId}/chat`, {
        formData,
        method: 'POST',
        token,
      })
    }

    return request<{
      files: FileRecord[]
      messages: Message[]
      model: string
      provider: string
      run: ChatRun
    }>(`/projects/${projectId}/chat`, {
      body: { message },
      method: 'POST',
      token,
    })
  },
  stopChat: (token: string, projectId: number) =>
    request<{ messages: Message[]; run: ChatRun | null }>(`/projects/${projectId}/chat/stop`, {
      method: 'POST',
      token,
    }),
  uploadFile: (token: string, projectId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<{ file: FileRecord }>(`/projects/${projectId}/files`, {
      formData,
      method: 'POST',
      token,
    })
  },
  fileBlob: (token: string, projectId: number, fileId: number) =>
    requestFile(`/projects/${projectId}/files/${fileId}/content`, token),
}
