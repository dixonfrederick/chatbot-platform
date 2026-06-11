# Chatbot Platform

Minimal full-stack chatbot platform for the Full Stack Developer assignment.

## Submission Links

- Public repository: https://github.com/dixonfrederick/chatbot-yellowai-dixon
- Hosted demo: https://chatbot-yellowai-dixon.vercel.app

## Features

- JWT authentication with registration and login.
- Per-user agents/projects with isolated data.
- Prompt storage and active prompt association per agent.
- Chat UI backed by the OpenAI Responses API when `OPENAI_API_KEY` is set.
- OpenRouter support with a configured free model.
- Local demo provider when no OpenAI key is configured.
- Drag-and-drop chat attachments with project file history.
- Image and PDF attachment previews in chat.
- Per-agent workflow state with stop support for in-progress responses.
- Responsive desktop and mobile UI with light/dark mode.
- Optional OpenAI Files API sync for uploaded files when OpenAI is enabled.
- SQLite local persistence and Postgres production persistence with automatic schema creation.

## Tech Stack

- React, TypeScript, Vite
- Express
- SQLite via `better-sqlite3` for local development
- Postgres via `pg` for Vercel/Neon production deployments
- JWT and bcrypt password hashing
- OpenAI Node SDK

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Client: `http://127.0.0.1:5173`

API: `http://localhost:4000`

The app runs without an API key by using the local demo provider. To enable OpenAI model calls, set:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-5-mini
```

To use OpenRouter's free model router instead:

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-your-key
OPENROUTER_MODEL=openai/gpt-oss-20b:free
```

## Production Build

```bash
npm run build
npm start
```

After build, Express serves the Vite `dist` folder and the API from the same process.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `4000` | Express server port |
| `JWT_SECRET` | Yes in production | local dev secret | Token signing secret |
| `DB_PATH` | No | `./data/app.db` | SQLite database path |
| `DATABASE_URL` | Yes on Vercel | empty | Postgres connection string |
| `LLM_PROVIDER` | No | auto-detects keys or `demo` | `demo`, `openai`, or `openrouter` |
| `OPENAI_API_KEY` | No | empty | Enables OpenAI Responses and Files APIs |
| `OPENAI_MODEL` | No | `gpt-5-mini` | Model used for chat responses |
| `OPENROUTER_API_KEY` | No | empty | Enables OpenRouter chat completions |
| `OPENROUTER_MODEL` | No | `openai/gpt-oss-20b:free` | OpenRouter model |
| `OPENROUTER_VISION_MODEL` | No | `openrouter/free` | OpenRouter model/router used when image attachments are sent |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Dev CORS origin |

## API Summary

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `POST /api/projects/:projectId/prompts`
- `GET /api/projects/:projectId/messages`
- `POST /api/projects/:projectId/chat`
- `POST /api/projects/:projectId/chat/stop`
- `GET /api/projects/:projectId/files`
- `POST /api/projects/:projectId/files`
- `GET /api/projects/:projectId/files/:fileId/content`

## Deployment Notes

The app is deployable as one Node service on Render, Railway, Fly.io, or Vercel.

Recommended settings:

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Use Postgres/Neon on Vercel via `DATABASE_URL`.
- Set `JWT_SECRET`.
- Set either `OPENAI_API_KEY` or `OPENROUTER_API_KEY` for real LLM responses.

This repo includes `vercel.json` for Vercel, `render.yaml` for Render Blueprint deployment, and a `Dockerfile` for container hosts such as Fly.io.

## Demo Script

1. Register a user.
2. Create an agent and enter a system prompt.
3. Send a chat message.
4. Drag a file into the chat composer and ask about it.
5. Save an updated prompt and send a second chat message.
