# Architecture

Agent Desk is a single deployable Node application. During development, Vite serves the React client and proxies `/api` to Express. In production, Express serves both the built static client and the JSON API.

## Components

- React client: Auth flow, project list, prompt editor, drag-and-drop chat attachments, and chat workspace.
- Express API: Request validation, JWT authentication, project ownership checks, chat orchestration, and file upload handling.
- SQLite database: Users, projects, prompts, messages, and uploaded file metadata.
- OpenAI adapter: Uses the Responses API for chat and the Files API for upload sync when `LLM_PROVIDER=openai`.
- OpenRouter adapter: Uses OpenRouter's OpenAI-compatible chat completions endpoint, including text, image, and PDF chat attachments when `LLM_PROVIDER=openrouter`.
- Demo adapter: Keeps the app usable without provider credentials.

## Data Model

- `users`: account identity and password hash.
- `projects`: user-owned agents with description and active `system_prompt`.
- `prompts`: prompt history associated with a project.
- `messages`: project chat history with provider/model metadata.
- `files`: metadata for files attached through chat or direct upload, plus optional `openai_file_id`.

Every project query is scoped by `user_id`, so users cannot access each other's projects, prompts, messages, or files.

## Security

- Passwords are hashed with bcrypt.
- JWTs expire after 7 days.
- Protected routes require `Authorization: Bearer <token>`.
- Project routes verify both project id and authenticated user id.
- Helmet removes common unsafe defaults.
- Uploads are capped at 10 MB.
- Secrets are read from environment variables and excluded from Git.

## Extensibility

The LLM provider is isolated in `server/llm.js`, so additional providers, analytics, retrieval, or tracing can be added without changing route ownership checks or UI state shape. SQLite can be replaced by Postgres by keeping the same route contracts and data model.

## Reliability And Performance

- SQLite WAL mode supports concurrent reads and a simple single-process deployment.
- Chat history sent to the model is capped to the latest messages to control latency.
- Provider errors return a structured `502` response.
- The client keeps local loading and error states for auth, project loading, chat, prompt saves, and file upload.
