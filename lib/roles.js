// Central role definitions — single source of truth for the whole portal.
// Roles are areas of access, not a pure hierarchy: pre-contract and
// post-contract see DIFFERENT areas; management sees almost everything;
// admin sees everything.

export const ROLES = ['pre-contract', 'post-contract', 'management', 'admin']

export const ROLE_LABEL = {
  'pre-contract': 'Standard — Pre-Contract',
  'post-contract': 'Standard — Post-Contract',
  'management': 'Management',
  'admin': 'Admin',
  // legacy fallback (old 'standard' users are treated as post-contract)
  'standard': 'Standard — Post-Contract',
}

// Normalise a stored role (handles legacy 'standard').
export function normRole(role) {
  if (role === 'standard') return 'post-contract'
  return role || 'post-contract'
}

// Which roles may access each AREA.
export const AREA_ACCESS = {
  'pre-contract':   ['pre-contract', 'management', 'admin'],
  'commercial':     ['post-contract', 'management', 'admin'],
  'operations':     ['post-contract', 'management', 'admin'],
  'lessons-learnt': ['pre-contract', 'post-contract', 'management', 'admin'],
  'hr':             ['pre-contract', 'post-contract', 'management', 'admin'],
  'management':     ['management', 'admin'],
  'admin':          ['admin'],
  'business-financials': ['admin'],
}

export function canAccessArea(role, area) {
  const r = normRole(role)
  const allowed = AREA_ACCESS[area]
  if (!allowed) return true            // unlisted areas: any logged-in user
  return allowed.includes(r)
}

export function hasRole(role, allowedRoles) {
  return allowedRoles.map(normRole).includes(normRole(role))
}
