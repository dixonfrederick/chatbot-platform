import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { db } from './db.js'

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  }
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      name: user.name,
    },
    config.jwtSecret,
    { expiresIn: '7d' },
  )
}

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' })
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const userId = Number(payload.sub)
    const user = await db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [
      userId,
    ])

    if (!user) {
      return res.status(401).json({ error: 'Invalid session.' })
    }

    req.user = publicUser(user)
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid session.' })
  }
}
