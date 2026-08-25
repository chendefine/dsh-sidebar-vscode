/**
 * Pure path/URL logic for the VSCode tab: translating the DSH session cwd
 * into the embedded VS Code server's view of the same directory, and building
 * the iframe URL. No DOM, no React — unit-testable in isolation.
 *
 * Deployment assumption (this machine): the VS Code server (`code serve-web`)
 * runs INSIDE the dsh-runtime container itself, so the DSH session and the
 * embedded workbench see the very same filesystem under the very same paths:
 *
 *   DSH session (= VS Code server, one container)
 *   /data/workspace        (==)      /data/workspace
 *   /opt                   (==)      /opt
 *
 * so the built-in default is a pair of identity rules
 * `/data/workspace=/data/workspace;/opt=/opt` — pure pass-through that still
 * whitelists the reachable workspace roots (anything else, e.g. `/tmp`, is
 * unmappable). The sidebar settings row (`pathMap`) can override the rules,
 * e.g. when the workbench runs in a separate container with different mounts.
 *
 * @module dsh-sidebar-vscode/client/paths
 */

/** One parsed mapping rule (source prefix → destination prefix). */
export interface PathMapRule {
  from: string
  to: string
}

/** The built-in default mapping used when the setting is empty/invalid. */
export const DEFAULT_PATH_MAP = '/data/workspace=/data/workspace;/opt=/opt'

/** The built-in default VS Code server base URL (same-origin gateway subpath). */
export const DEFAULT_SERVER_URL = '/vscode'

/** Normalize one directory prefix: trim, ensure a single leading '/', drop trailing '/'. */
function normalizePrefix(raw: string): string {
  let value = raw.trim()
  if (value === '') return ''
  value = value.replace(/\/+/g, '/').replace(/^\/?/, '/')
  while (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value
}

/**
 * Parse the user-facing `pathMap` setting (`src=dst;src2=dst2`). Empty or
 * fully-malformed input falls back to {@link DEFAULT_PATH_MAP}. Malformed
 * single entries are skipped (the rest still apply). Rules are returned
 * longest-source-prefix first (stable among equals) so the most specific
 * rule wins in {@link mapPath}.
 */
export function parsePathMap(spec: string | undefined): readonly PathMapRule[] {
  const text = spec === undefined ? '' : spec.trim()
  const source = text === '' ? DEFAULT_PATH_MAP : text
  const rules: PathMapRule[] = []
  for (const part of source.split(';')) {
    const entry = part.trim()
    if (entry === '') continue
    const eq = entry.indexOf('=')
    if (eq <= 0) continue // no '=' or empty source side — skip
    const from = normalizePrefix(entry.slice(0, eq))
    const to = normalizePrefix(entry.slice(eq + 1))
    if (from === '' || to === '') continue
    rules.push({ from, to })
  }
  if (rules.length === 0) return parsePathMap(DEFAULT_PATH_MAP)
  return [...rules].sort((a, b) => b.from.length - a.from.length)
}

/** Whether `path` is `prefix` itself or a path segment under it. */
function under(path: string, prefix: string): boolean {
  if (prefix === '/') return path.startsWith('/')
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Map one DSH-side absolute path through the rules.
 *
 * Order: (1) the first rule (longest source prefix first) whose `from`
 * contains the path rewrites the prefix; (2) a path already sitting under
 * some rule's DESTINATION prefix passes through unchanged (the cwd was
 * already VS Code-side — prevents double-mapping); (3) otherwise `null`
 * (unmappable — the caller opens the base URL and shows a hint).
 */
export function mapPath(path: string, rules: readonly PathMapRule[]): string | null {
  const clean = path.trim()
  if (clean === '' || !clean.startsWith('/')) return null
  for (const rule of rules) {
    if (!under(clean, rule.from)) continue
    const suffix = rule.from === '/' ? clean : clean.slice(rule.from.length)
    return `${rule.to}${suffix}`
  }
  for (const rule of rules) {
    if (under(clean, rule.to)) return clean
  }
  return null
}

/**
 * The inverse of {@link mapPath}: translate one VS Code-server-side path
 * back into the DSH session's view of the same file (longest destination
 * prefix wins; a path already sitting under a SOURCE prefix is DSH-side
 * already and passes through). Used when a selection reference arrives from
 * the embedded VS Code and must name the file the way the DSH session (and
 * the agent's tools) see it.
 */
export function reverseMapPath(path: string, rules: readonly PathMapRule[]): string | null {
  const clean = path.trim()
  if (clean === '' || !clean.startsWith('/')) return null
  const byDest = [...rules].sort((a, b) => b.to.length - a.to.length)
  for (const rule of byDest) {
    if (!under(clean, rule.to)) continue
    const suffix = rule.to === '/' ? clean : clean.slice(rule.to.length)
    return `${rule.from}${suffix}`
  }
  for (const rule of rules) {
    if (under(clean, rule.from)) return clean
  }
  return null
}

/**
 * Normalize the `serverUrl` setting into a usable base: empty → the
 * same-origin gateway subpath ({@link DEFAULT_SERVER_URL}); trailing slashes
 * dropped; a value with neither a URL scheme nor a leading '/' is treated as
 * a subpath and anchored to the page root.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_SERVER_URL
  const anchored = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith('/') ? value : `/${value}`
  return anchored.replace(/\/+$/, '') === '' ? '/' : anchored.replace(/\/+$/, '')
}

/**
 * Build the iframe target: the (scheme-absolute or same-origin relative)
 * VS Code workbench URL, with `?folder=` naming the mapped workspace
 * (the server opens that folder; `folder === null` opens its default).
 */
export function buildVscodeUrl(base: string, folder: string | null): string {
  const root = `${base}/`
  return folder === null ? root : `${root}?folder=${encodeURIComponent(folder)}`
}
