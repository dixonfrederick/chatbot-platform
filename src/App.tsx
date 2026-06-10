import {
  AlertCircle,
  Bot,
  FileText,
  FolderKanban,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  Paperclip,
  Plus,
  Save,
  Send,
  Settings,
  Square,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { ApiError, api } from './api'
import type { ChatRun, Health, Message, Project, User as AuthUser } from './types'

const TOKEN_KEY = 'chatbot_platform_token'
const THEME_KEY = 'chatbot_platform_theme'

type AuthMode = 'login' | 'register'
type ThemeMode = 'dark' | 'light'

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.detail ? `${error.message} ${error.detail}` : error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong.'
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function resetDocumentScroll() {
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
  window.scrollTo({ left: 0, top: 0 })
}

function runFromProject(project: Project): ChatRun | null {
  if (!project.latest_run_id || !project.latest_run_status) {
    return null
  }

  return {
    assistant_message_id: null,
    completed_at: project.latest_run_completed_at || null,
    created_at: project.latest_run_created_at || project.updated_at,
    error: project.latest_run_error || '',
    id: project.latest_run_id,
    model: '',
    project_id: project.id,
    provider: '',
    response_id: '',
    status: project.latest_run_status,
    updated_at: project.latest_run_updated_at || project.updated_at,
    user_id: project.user_id,
    user_message_id: null,
  }
}

function runsFromProjects(projects: Project[]) {
  return projects.reduce<Record<number, ChatRun | null>>((runs, project) => {
    runs[project.id] = runFromProject(project)
    return runs
  }, {})
}

function AuthScreen({
  authError,
  authForm,
  authMode,
  isSubmitting,
  onChange,
  onModeChange,
  onSubmit,
  onToggleTheme,
  theme,
}: {
  authError: string
  authForm: { email: string; name: string; password: string }
  authMode: AuthMode
  isSubmitting: boolean
  onChange: (field: 'email' | 'name' | 'password', value: string) => void
  onModeChange: (mode: AuthMode) => void
  onSubmit: (event: FormEvent) => void
  onToggleTheme: () => void
  theme: ThemeMode
}) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="icon-button auth-theme-toggle"
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          type="button"
        >
          {theme === 'dark' ? (
            <Sun aria-hidden="true" size={18} />
          ) : (
            <Moon aria-hidden="true" size={18} />
          )}
        </button>
        <div className="brand-mark">
          <Bot aria-hidden="true" size={28} />
        </div>
        <div>
          <p className="eyebrow">Chatbot YellowAI Dixon</p>
          <h1>{authMode === 'login' ? 'Sign in' : 'Create account'}</h1>
        </div>
        <div className="segmented" role="tablist" aria-label="Authentication mode">
          <button
            aria-selected={authMode === 'login'}
            className={authMode === 'login' ? 'active' : ''}
            onClick={() => onModeChange('login')}
            type="button"
          >
            Login
          </button>
          <button
            aria-selected={authMode === 'register'}
            className={authMode === 'register' ? 'active' : ''}
            onClick={() => onModeChange('register')}
            type="button"
          >
            Register
          </button>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          {authMode === 'register' ? (
            <label>
              <span>Name</span>
              <div className="input-shell">
                <User aria-hidden="true" size={18} />
                <input
                  autoComplete="name"
                  onChange={(event) => onChange('name', event.target.value)}
                  required
                  value={authForm.name}
                />
              </div>
            </label>
          ) : null}
          <label>
            <span>Email</span>
            <div className="input-shell">
              <Mail aria-hidden="true" size={18} />
              <input
                autoComplete="email"
                onChange={(event) => onChange('email', event.target.value)}
                required
                type="email"
                value={authForm.email}
              />
            </div>
          </label>
          <label>
            <span>Password</span>
            <div className="input-shell">
              <Lock aria-hidden="true" size={18} />
              <input
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                onChange={(event) => onChange('password', event.target.value)}
                required
                type="password"
                value={authForm.password}
              />
            </div>
          </label>
          {authError ? (
            <div className="notice error">
              <AlertCircle aria-hidden="true" size={18} />
              <span>{authError}</span>
            </div>
          ) : null}
          <button className="primary wide" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 aria-hidden="true" className="spin" size={18} /> : null}
            {authMode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  )
}

function EmptyWorkspace() {
  return (
    <div className="empty-workspace">
      <div className="brand-mark muted">
        <FolderKanban aria-hidden="true" size={28} />
      </div>
      <h2>No agent selected</h2>
      <p>Create an agent from the sidebar to start configuring instructions and chats.</p>
    </div>
  )
}

function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
        }}
        remarkPlugins={[remarkGfm, remarkBreaks]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function RunStatusCard({
  isStopping,
  onStop,
  run,
}: {
  isStopping: boolean
  onStop: () => void
  run: ChatRun
}) {
  if (run.status === 'completed') {
    return null
  }

  if (run.status === 'running') {
    return (
      <article className="message assistant run-status pending">
        <div className="message-meta">
          <span>Agent</span>
          <small>thinking</small>
        </div>
        <div className="run-status-body">
          <Loader2 aria-hidden="true" className="spin" size={18} />
          <span>Working on this request.</span>
          <button className="secondary stop-button" disabled={isStopping} onClick={onStop} type="button">
            {isStopping ? (
              <Loader2 aria-hidden="true" className="spin" size={16} />
            ) : (
              <Square aria-hidden="true" size={15} />
            )}
            Stop
          </button>
        </div>
      </article>
    )
  }

  const isFailed = run.status === 'failed'

  return (
    <article className={`message assistant run-status ${isFailed ? 'failed' : 'stopped'}`}>
      <div className="message-meta">
        <span>Agent</span>
        <small>{isFailed ? 'failed' : 'stopped'}</small>
      </div>
      <div className="run-status-body">
        <AlertCircle aria-hidden="true" size={18} />
        <span>{isFailed ? run.error || 'The workflow failed.' : 'Workflow stopped.'}</span>
      </div>
    </article>
  )
}

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authForm, setAuthForm] = useState({ email: '', name: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [chatFiles, setChatFiles] = useState<File[]>([])
  const [chatInput, setChatInput] = useState('')
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(false)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [isDeletingProject, setIsDeletingProject] = useState(false)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesProjectId, setMessagesProjectId] = useState<number | null>(null)
  const [newProject, setNewProject] = useState({
    description: '',
    name: '',
    system_prompt: '',
  })
  const [promptDraft, setPromptDraft] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [runsByProjectId, setRunsByProjectId] = useState<Record<number, ChatRun | null>>({})
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [settingsDraft, setSettingsDraft] = useState({
    description: '',
    name: '',
  })
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const storedTheme = localStorage.getItem(THEME_KEY)

    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<AuthUser | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [stoppingProjectIds, setStoppingProjectIds] = useState<Set<number>>(() => new Set())
  const chatFileInputRef = useRef<HTMLInputElement | null>(null)
  const selectedProjectIdRef = useRef<number | null>(selectedProjectId)
  const stoppedProjectIdsRef = useRef<Set<number>>(new Set())

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  )
  const selectedProjectRun = selectedProject ? runsByProjectId[selectedProject.id] || null : null
  const selectedProjectIsChatting = selectedProjectRun?.status === 'running'
  const selectedProjectIsStopping = selectedProject
    ? stoppingProjectIds.has(selectedProject.id)
    : false
  const selectedProjectMessages =
    selectedProject && messagesProjectId === selectedProject.id ? messages : []
  const selectedProjectDetailIsLoading =
    selectedProject ? isDetailLoading || messagesProjectId !== selectedProject.id : false

  const setProjectRun = useCallback((projectId: number, run: ChatRun | null) => {
    setRunsByProjectId((current) => ({
      ...current,
      [projectId]: run,
    }))
  }, [])

  const applyProjectDetail = useCallback(
    (projectId: number, detail: Awaited<ReturnType<typeof api.projectDetail>>) => {
      setMessages(detail.messages)
      setMessagesProjectId(projectId)
      setProjectRun(projectId, detail.run)
      setPromptDraft(detail.project.system_prompt)
      setSettingsDraft({
        description: detail.project.description,
        name: detail.project.name,
      })
      setProjects((current) =>
        current.map((project) =>
          project.id === detail.project.id ? { ...project, ...detail.project } : project,
        ),
      )
    },
    [setProjectRun],
  )

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId
  }, [selectedProjectId])

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    resetDocumentScroll()
  }, [])

  useEffect(() => {
    resetDocumentScroll()
  }, [selectedProjectId, token, user?.id])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    if (!token) {
      setUser(null)
      setProjects([])
      setRunsByProjectId({})
      setSelectedProjectId(null)
      return
    }

    let isActive = true

    async function bootstrap() {
      setIsBootstrapping(true)
      setWorkspaceError('')

      try {
        const [profile, projectResult] = await Promise.all([
          api.me(token as string),
          api.projects(token as string),
        ])

        if (!isActive) {
          return
        }

        setUser(profile.user)
        setProjects(projectResult.projects)
        setRunsByProjectId(runsFromProjects(projectResult.projects))
        setSelectedProjectId((current) => {
          if (current && projectResult.projects.some((project) => project.id === current)) {
            return current
          }

          return projectResult.projects[0]?.id || null
        })
      } catch (error) {
        if (!isActive) {
          return
        }

        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setWorkspaceError(getErrorMessage(error))
      } finally {
        if (isActive) {
          setIsBootstrapping(false)
        }
      }
    }

    bootstrap()

    return () => {
      isActive = false
    }
  }, [token])

  useEffect(() => {
    if (!token || !selectedProjectId) {
      setMessages([])
      setMessagesProjectId(null)
      setPromptDraft('')
      setSettingsDraft({ description: '', name: '' })
      return
    }

    let isActive = true
    const projectId = selectedProjectId
    const authToken = token

    async function loadProject() {
      setIsDetailLoading(true)
      setWorkspaceError('')

      try {
        const detail = await api.projectDetail(authToken, projectId)

        if (!isActive) {
          return
        }

        applyProjectDetail(projectId, detail)
      } catch (error) {
        if (isActive) {
          setMessages([])
          setMessagesProjectId(projectId)
          setWorkspaceError(getErrorMessage(error))
        }
      } finally {
        if (isActive) {
          setIsDetailLoading(false)
        }
      }
    }

    loadProject()

    return () => {
      isActive = false
    }
  }, [applyProjectDetail, selectedProjectId, token])

  useEffect(() => {
    if (!token || !selectedProjectId || selectedProjectRun?.status !== 'running') {
      return
    }

    let isActive = true
    const projectId = selectedProjectId
    const authToken = token

    async function pollProject() {
      try {
        const detail = await api.projectDetail(authToken, projectId)

        if (isActive && selectedProjectIdRef.current === projectId) {
          applyProjectDetail(projectId, detail)
        }
      } catch (error) {
        if (isActive && selectedProjectIdRef.current === projectId) {
          setWorkspaceError(getErrorMessage(error))
        }
      }
    }

    const pollId = window.setInterval(pollProject, 2500)

    return () => {
      isActive = false
      window.clearInterval(pollId)
    }
  }, [
    applyProjectDetail,
    selectedProjectId,
    selectedProjectRun?.id,
    selectedProjectRun?.status,
    token,
  ])

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault()
    setAuthError('')
    setIsAuthSubmitting(true)

    try {
      const result =
        authMode === 'login'
          ? await api.login({
              email: authForm.email,
              password: authForm.password,
            })
          : await api.register({
              email: authForm.email,
              name: authForm.name,
              password: authForm.password,
            })

      localStorage.setItem(TOKEN_KEY, result.token)
      setToken(result.token)
      setUser(result.user)
    } catch (error) {
      setAuthError(getErrorMessage(error))
    } finally {
      setIsAuthSubmitting(false)
    }
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()

    if (!token || !newProject.name.trim()) {
      return
    }

    setIsCreatingProject(true)
    setWorkspaceError('')

    try {
      const result = await api.createProject(token, {
        description: newProject.description,
        name: newProject.name,
        system_prompt: newProject.system_prompt,
      })

      setProjects((current) => [result.project, ...current])
      setProjectRun(result.project.id, null)
      setSelectedProjectId(result.project.id)
      setNewProject({ description: '', name: '', system_prompt: '' })
    } catch (error) {
      setWorkspaceError(getErrorMessage(error))
    } finally {
      setIsCreatingProject(false)
    }
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault()

    if (!token || !selectedProject || !settingsDraft.name.trim()) {
      return
    }

    setIsSavingSettings(true)
    setWorkspaceError('')

    try {
      const result = await api.updateProject(token, selectedProject.id, {
        description: settingsDraft.description,
        name: settingsDraft.name,
        system_prompt: promptDraft,
      })

      setProjects((current) =>
        current.map((project) =>
          project.id === result.project.id ? { ...project, ...result.project } : project,
        ),
      )
      setPromptDraft(result.project.system_prompt)
    } catch (error) {
      setWorkspaceError(getErrorMessage(error))
    } finally {
      setIsSavingSettings(false)
    }
  }

  function addChatFiles(fileList: FileList | File[]) {
    const nextFiles = Array.from(fileList).filter((file) => file.size <= 10 * 1024 * 1024)

    if (nextFiles.length === 0) {
      return
    }

    setChatFiles((current) => {
      const merged = [...current, ...nextFiles]
      return merged.slice(0, 5)
    })
  }

  function removeChatFile(index: number) {
    setChatFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index))
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault()

    if (
      !token ||
      !user ||
      !selectedProject ||
      selectedProjectIsChatting ||
      (!chatInput.trim() && chatFiles.length === 0)
    ) {
      return
    }

    const projectId = selectedProject.id
    const outgoing = chatInput.trim()
    const outgoingFiles = chatFiles
    const attachmentLine = outgoingFiles.length
      ? `\n\nAttached: ${outgoingFiles.map((file) => file.name).join(', ')}`
      : ''
    const optimisticMessage: Message = {
      content: `${outgoing || 'Please analyze the attached file.'}${attachmentLine}`,
      created_at: new Date().toISOString(),
      id: -Date.now(),
      model: '',
      project_id: projectId,
      provider: 'user',
      response_id: '',
      role: 'user',
    }
    const optimisticRun: ChatRun = {
      assistant_message_id: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      error: '',
      id: optimisticMessage.id,
      model: '',
      project_id: projectId,
      provider: '',
      response_id: '',
      status: 'running',
      updated_at: new Date().toISOString(),
      user_id: user.id,
      user_message_id: optimisticMessage.id,
    }

    setChatInput('')
    setChatFiles([])
    setMessagesProjectId(projectId)
    setMessages((current) => [...current, optimisticMessage])
    setProjectRun(projectId, optimisticRun)
    setWorkspaceError('')

    try {
      const result = await api.sendMessage(
        token,
        projectId,
        outgoing || 'Please analyze the attached file.',
        outgoingFiles,
      )

      setProjectRun(projectId, result.run)

      if (selectedProjectIdRef.current === projectId) {
        setMessagesProjectId(projectId)
        setMessages((current) => [
          ...current.filter((message) => message.id !== optimisticMessage.id),
          ...result.messages,
        ])
      }
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId
            ? {
                ...project,
                file_count: (project.file_count || 0) + result.files.length,
                message_count: (project.message_count || 0) + result.messages.length,
              }
            : project,
        ),
      )
    } catch (error) {
      const payload = error instanceof ApiError ? (error.payload as { run?: ChatRun }) : null

      if (payload?.run) {
        setProjectRun(projectId, payload.run)
      }

      if (selectedProjectIdRef.current === projectId) {
        const serverRunSettled =
          error instanceof ApiError && (error.status === 409 || error.status === 502)

        if (serverRunSettled || stoppedProjectIdsRef.current.has(projectId)) {
          try {
            const detail = await api.projectDetail(token, projectId)
            applyProjectDetail(projectId, detail)
          } catch {
            setWorkspaceError(getErrorMessage(error))
          }
        } else {
          setProjectRun(projectId, null)
          setMessagesProjectId(projectId)
          setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id))
          setChatFiles(outgoingFiles)
          setWorkspaceError(getErrorMessage(error))
        }
      }
    } finally {
      stoppedProjectIdsRef.current.delete(projectId)
    }
  }

  async function handleStopWorkflow() {
    if (!token || !selectedProject || !selectedProjectIsChatting) {
      return
    }

    const projectId = selectedProject.id
    stoppedProjectIdsRef.current.add(projectId)
    setStoppingProjectIds((current) => new Set(current).add(projectId))
    setWorkspaceError('')

    try {
      const result = await api.stopChat(token, projectId)

      setProjectRun(projectId, result.run)

      if (selectedProjectIdRef.current === projectId) {
        const detail = await api.projectDetail(token, projectId)
        applyProjectDetail(projectId, detail)
      }
    } catch (error) {
      stoppedProjectIdsRef.current.delete(projectId)
      setWorkspaceError(getErrorMessage(error))
    } finally {
      setStoppingProjectIds((current) => {
        const next = new Set(current)
        next.delete(projectId)
        return next
      })
    }
  }

  async function handleDeleteProject() {
    if (!token || !deleteProjectTarget) {
      return
    }

    const projectId = deleteProjectTarget.id
    setIsDeletingProject(true)
    setWorkspaceError('')

    try {
      await api.deleteProject(token, projectId)
      setProjects((current) => {
        const next = current.filter((project) => project.id !== projectId)
        setSelectedProjectId((currentProjectId) =>
          currentProjectId === projectId ? next[0]?.id || null : currentProjectId,
        )
        return next
      })
      setRunsByProjectId((current) => {
        const next = { ...current }
        delete next[projectId]
        return next
      })
      setDeleteProjectTarget(null)
    } catch (error) {
      setWorkspaceError(getErrorMessage(error))
    } finally {
      setIsDeletingProject(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  if (!token || !user) {
    return (
      <AuthScreen
        authError={authError}
        authForm={authForm}
        authMode={authMode}
        isSubmitting={isAuthSubmitting}
        onChange={(field, value) =>
          setAuthForm((current) => ({
            ...current,
            [field]: value,
          }))
        }
        onModeChange={setAuthMode}
        onSubmit={handleAuthSubmit}
        onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        theme={theme}
      />
    )
  }

  return (
    <>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Bot aria-hidden="true" size={24} />
          </div>
          <div>
            <strong>Chatbot YellowAI Dixon</strong>
            <span>{health ? `${health.provider} / ${health.model}` : 'checking provider'}</span>
          </div>
        </div>

        <form className="new-project-form" onSubmit={handleCreateProject}>
          <label>
            <span>New agent</span>
            <input
              onChange={(event) =>
                setNewProject((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Support copilot"
              value={newProject.name}
            />
          </label>
          <label>
            <span>Description</span>
            <input
              onChange={(event) =>
                setNewProject((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Customer support workflow"
              value={newProject.description}
            />
          </label>
          <label>
            <span>Instructions</span>
            <textarea
              onChange={(event) =>
                setNewProject((current) => ({ ...current, system_prompt: event.target.value }))
              }
              placeholder="Set the agent's role, tone, and rules."
              rows={4}
              value={newProject.system_prompt}
            />
          </label>
          <button className="primary wide" disabled={isCreatingProject} type="submit">
            {isCreatingProject ? (
              <Loader2 aria-hidden="true" className="spin" size={18} />
            ) : (
              <Plus aria-hidden="true" size={18} />
            )}
            Create
          </button>
        </form>

        <nav className="project-list" aria-label="Agents">
          {projects.map((project) => {
            const projectRun = runsByProjectId[project.id]
            const projectStatus =
              projectRun?.status === 'running'
                ? 'thinking'
                : projectRun?.status === 'failed'
                  ? 'failed'
                  : projectRun?.status === 'cancelled'
                    ? 'stopped'
                    : `${project.message_count || 0} chats`

            return (
              <button
                className={project.id === selectedProjectId ? 'project-item active' : 'project-item'}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <FolderKanban aria-hidden="true" size={18} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{projectStatus}</small>
                </span>
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              <MessageSquare aria-hidden="true" size={16} />
              Chat workspace
            </p>
            <h1>{selectedProject?.name || 'Agent workspace'}</h1>
            <p>{selectedProject?.description || 'No description set'}</p>
          </div>
          <div className="account-menu">
            <span>{user.name}</span>
            <button
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="icon-button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              type="button"
            >
              {theme === 'dark' ? (
                <Sun aria-hidden="true" size={18} />
              ) : (
                <Moon aria-hidden="true" size={18} />
              )}
            </button>
            <button aria-label="Logout" className="icon-button" onClick={handleLogout} type="button">
              <LogOut aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        {workspaceError ? (
          <div className="notice error workspace-notice">
            <AlertCircle aria-hidden="true" size={18} />
            <span>{workspaceError}</span>
          </div>
        ) : null}

        {isBootstrapping ? (
          <div className="loading-state">
            <Loader2 aria-hidden="true" className="spin" size={24} />
          </div>
        ) : selectedProject ? (
          <section className="chat-panel" aria-label="Chat">
            <div className="message-list">
              {selectedProjectDetailIsLoading ? (
                <div className="loading-state">
                  <Loader2 aria-hidden="true" className="spin" size={24} />
                </div>
              ) : selectedProjectMessages.length === 0 ? (
                <div className="empty-chat">
                  <div className="brand-mark muted">
                    <Bot aria-hidden="true" size={28} />
                  </div>
                  <h2>Start a chat</h2>
                  <p>Messages stay scoped to this agent and account.</p>
                </div>
              ) : (
                selectedProjectMessages.map((message) => (
                  <article className={`message ${message.role}`} key={message.id}>
                    <div className="message-meta">
                      <span>{message.role === 'assistant' ? 'Agent' : 'You'}</span>
                      {message.provider !== 'user' ? <small>{message.model || message.provider}</small> : null}
                    </div>
                    <MessageMarkdown content={message.content} />
                  </article>
                ))
              )}
              {selectedProjectRun && selectedProjectRun.status !== 'completed' ? (
                <RunStatusCard
                  isStopping={selectedProjectIsStopping}
                  onStop={handleStopWorkflow}
                  run={selectedProjectRun}
                />
              ) : null}
            </div>

            <form
              className={isDraggingFiles ? 'chat-composer dragging' : 'chat-composer'}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) {
                  setIsDraggingFiles(false)
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingFiles(true)
              }}
              onDrop={(event) => {
                event.preventDefault()
                setIsDraggingFiles(false)
                addChatFiles(event.dataTransfer.files)
              }}
              onSubmit={handleSendMessage}
            >
              <input
                hidden
                multiple
                onChange={(event) => {
                  if (event.target.files) {
                    addChatFiles(event.target.files)
                  }
                  event.currentTarget.value = ''
                }}
                ref={chatFileInputRef}
                type="file"
              />
              <button
                aria-label="Attach files"
                className="icon-button attach-button"
                onClick={() => chatFileInputRef.current?.click()}
                title="Attach files"
                type="button"
              >
                <Paperclip aria-hidden="true" size={18} />
              </button>
              <div className="composer-main">
                {chatFiles.length > 0 ? (
                  <div className="attachment-chips">
                    {chatFiles.map((file, index) => (
                      <span className="attachment-chip" key={`${file.name}-${file.lastModified}`}>
                        <FileText aria-hidden="true" size={15} />
                        <strong title={file.name}>{file.name}</strong>
                        <small>{formatBytes(file.size)}</small>
                        <button
                          aria-label={`Remove ${file.name}`}
                          onClick={() => removeChatFile(index)}
                          title="Remove"
                          type="button"
                        >
                          <X aria-hidden="true" size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <textarea
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask this agent anything..."
                  rows={2}
                  value={chatInput}
                />
              </div>
              <button
                aria-label="Send message"
                className="primary send-button"
                disabled={selectedProjectIsChatting || (!chatInput.trim() && chatFiles.length === 0)}
                type="submit"
              >
                <Send aria-hidden="true" size={18} />
              </button>
            </form>
          </section>
        ) : (
          <EmptyWorkspace />
        )}
      </main>

      <aside className="inspector">
        {selectedProject ? (
          <>
            <section className="inspector-section">
              <div className="section-title">
                <Settings aria-hidden="true" size={18} />
                <h2>Settings</h2>
              </div>
              <form className="stack" onSubmit={handleSaveSettings}>
                <label>
                  <span>Name</span>
                  <input
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    value={settingsDraft.name}
                  />
                </label>
                <label>
                  <span>Description</span>
                  <textarea
                    onChange={(event) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={3}
                    value={settingsDraft.description}
                  />
                </label>
                <label>
                  <span>Instructions</span>
                  <textarea
                    className="prompt-box"
                    onChange={(event) => setPromptDraft(event.target.value)}
                    placeholder="Set the agent's role, tone, and rules."
                    rows={7}
                    value={promptDraft}
                  />
                </label>
                <div className="button-row">
                  <button className="secondary" disabled={isSavingSettings} type="submit">
                    {isSavingSettings ? (
                      <Loader2 aria-hidden="true" className="spin" size={18} />
                    ) : (
                      <Save aria-hidden="true" size={18} />
                    )}
                    Save
                  </button>
                  <button
                    aria-label="Delete agent"
                    className="danger"
                    onClick={() => setDeleteProjectTarget(selectedProject)}
                    title="Delete agent"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                </div>
              </form>
            </section>
          </>
        ) : (
          <EmptyWorkspace />
        )}
      </aside>
      </div>

      {deleteProjectTarget ? (
        <div
          aria-labelledby="delete-agent-title"
          aria-modal="true"
          className="modal-backdrop"
          role="dialog"
        >
          <section className="modal-panel">
            <div className="modal-icon danger">
              <Trash2 aria-hidden="true" size={22} />
            </div>
            <div className="modal-copy">
              <h2 id="delete-agent-title">Delete agent?</h2>
              <p>
                This will remove "{deleteProjectTarget.name}", its chat history, instructions, and
                attached file records.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={isDeletingProject}
                onClick={() => setDeleteProjectTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="danger filled"
                disabled={isDeletingProject}
                onClick={handleDeleteProject}
                type="button"
              >
                {isDeletingProject ? (
                  <Loader2 aria-hidden="true" className="spin" size={18} />
                ) : (
                  <Trash2 aria-hidden="true" size={18} />
                )}
                Delete
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}

export default App
