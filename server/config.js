import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config({ quiet: true })

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(rootDir, 'data')

export const config = {
  rootDir,
  dataDir,
  uploadsDir: path.resolve(dataDir, 'uploads'),
  clientDistDir: path.resolve(rootDir, 'dist'),
  dbPath: path.resolve(process.env.DB_PATH || path.join(dataDir, 'app.db')),
  jwtSecret: process.env.JWT_SECRET || 'local-development-secret-change-me',
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5-mini',
  port: Number(process.env.PORT || 4000),
}

export const isProduction = config.nodeEnv === 'production'
