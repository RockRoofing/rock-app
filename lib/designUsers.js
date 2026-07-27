import { get, set } from './db'
import { hashPassword, verifyPassword } from './portalAuth'

// External customer/design-team users. Kept in a SEPARATE store from internal portal
// users so they can never inherit internal roles or areas. They:
//   - log in with email + password (portal-managed, same login page)
//   - are scoped to SPECIFIC projects only (never "all" - now or in future)
//   - have a restricted role: view / comment / approve / download only
//
// Record shape:
//   { id, name, firstName, lastName, email, company, phone,
//     projects: ['J203', ...]   // list of project numbers - NEVER empty-means-all
//     active, passwordHash, mustResetPassword, createdAt }
const KEY = 'design:external-users'

export async function getExternalUsers() {
  return (await get(KEY)) || []
}
export async function saveExternalUsers(users) {
  await set(KEY, users)
}

// Strip sensitive fields before sending to the client.
export function stripExternal(u) {
  if (!u) return u
  const { passwordHash, ...rest } = u
  return { ...rest, external: true, role: 'external' }
}

// Normalise a projects list: array of non-empty strings, de-duped. Crucially there is
// NO "all" value - external users are always explicitly scoped to named projects.
export function normProjects(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const p of list) {
    const v = String(p == null ? '' : p).trim()
    if (!v) continue
    // Defensive: reject any attempt to grant blanket access.
    if (v.toLowerCase() === 'all' || v === '*') continue
    if (seen.has(v)) continue
    seen.add(v); out.push(v)
  }
  return out
}

export async function findExternalByEmail(email) {
  const e = String(email || '').toLowerCase().trim()
  const users = await getExternalUsers()
  return users.find(u => (u.email || '').toLowerCase() === e && u.active !== false) || null
}

export function verifyExternalPassword(user, password) {
  return !!user && verifyPassword(password, user.passwordHash)
}

export { hashPassword }

// Can this external user access this project? Only if it's explicitly in their list.
export function externalCanAccessProject(user, projectNo) {
  if (!user || !Array.isArray(user.projects)) return false
  const p = String(projectNo == null ? '' : projectNo).trim()
  return user.projects.map(String).includes(p)
}
