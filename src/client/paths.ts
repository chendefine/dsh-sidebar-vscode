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
 * The `pathMap` setting is therefore OPTIONAL and OFF by default: an unset
 * (or fully malformed) mapping yields NO rules, and every absolute path then
 * passes through unchanged — the workbench simply opens the raw session
 * directory. Configure rules only when the workbench runs elsewhere (split
 * container / different mounts): each rule rewrites one DSH-side source
 * prefix into the VS Code-side destination prefix (`src=dst`, `;`-joined,
 * longest source prefix wins). Even then, a path no rule matches still passes
 * through — the rules are PREFIX REWRITERS, never a whitelist: only empty or
 * non-absolute input is rejected ({@link mapPath} /
 * {@link reverseMapPath}). The `pathMap` key is settings-document-only
 * (no settings-panel row — see settingsRows.tsx); empty/unset is the
 * same-container default.
 *
 * @module dsh-sidebar-vscode/client/paths
 */

/** One parsed mapping rule (source prefix → destination prefix). */
export interface PathMapRule {
  from: string
  to: string
}

/**
 * The default `serverUrl`: the full address of a locally started
 * `code serve-web` without a token or base path (the CLI's own defaults).
 * An unset setting means exactly this URL — pushed to the host's built-in
 * proxy as the upstream, with the direct cross-origin iframe as fallback.
 */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000'

/**
 * The browser-facing mount of the host half's built-in reverse proxy.
 * Must stay in sync with `PROXY_MOUNT` in `src/vscodeProxy.ts` (duplicated
 * here because the client bundle must not import the node-http module).
 */
export const PROXY_MOUNT = '/sidebar/vscode'

/** Whether a raw `serverUrl` value is a full URL (vs a same-origin subpath). */
export function isFullServerUrl(raw: string | undefined): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test((raw ?? '').trim())
}

/** Normalize one directory prefix: trim, ensure a single leading '/', drop trailing '/'. */
function normalizePrefix(raw: string): string {
  let value = raw.trim()
  if (value === '') return ''
  value = value.replace(/\/+/g, '/').replace(/^\/?/, '/')
  while (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value
}

/**
 * Parse the user-facing `pathMap` setting (`src=dst;src2=dst2`). Empty,
 * unset, or fully-malformed input yields NO rules — pass-through mode (the
 * raw paths reach the workbench unchanged). Malformed single entries are
 * skipped (the rest still apply). Rules are returned longest-source-prefix
 * first (stable among equals) so the most specific rule wins in
 * {@link mapPath}.
 */
export function parsePathMap(spec: string | undefined): readonly PathMapRule[] {
  const text = spec === undefined ? '' : spec.trim()
  const rules: PathMapRule[] = []
  for (const part of text.split(';')) {
    const entry = part.trim()
    if (entry === '') continue
    const eq = entry.indexOf('=')
    if (eq <= 0) continue // no '=' or empty source side — skip
    const from = normalizePrefix(entry.slice(0, eq))
    const to = normalizePrefix(entry.slice(eq + 1))
    if (from === '' || to === '') continue
    rules.push({ from, to })
  }
  return [...rules].sort((a, b) => b.from.length - a.from.length)
}

/** Whether `path` is `prefix` itself or a path segment under it. */
function under(path: string, prefix: string): boolean {
  if (prefix === '/') return path.startsWith('/')
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Join a rule-side prefix with the mapped remainder. The suffix keeps its
 * leading '/', so a ROOT prefix contributes nothing — naive concatenation
 * (`'/' + '/x'`) would yield a double-slash path VS Code cannot open and
 * the open-channel slug cannot address. An empty or root-only suffix
 * (the mapped path IS the prefix itself) collapses to the other side's
 * prefix, or '/' when both are root — never to ''.
 */
function joinPrefix(prefix: string, suffix: string): string {
  const base = prefix === '/' ? '' : prefix
  if (suffix === '' || suffix === '/') return base === '' ? '/' : base
  return base + suffix
}

/**
 * Map one DSH-side absolute path through the rules.
 *
 * Order: (1) the first rule (longest source prefix first) whose `from`
 * contains the path rewrites the prefix; (2) a path already sitting under
 * some rule's DESTINATION prefix passes through unchanged (the cwd was
 * already VS Code-side — prevents double-mapping); (3) no rule matched →
 * pass-through: the path itself, unchanged (same-container deployment —
 * the workbench sees the very same directory). `null` only for empty or
 * non-absolute input.
 */
export function mapPath(path: string, rules: readonly PathMapRule[]): string | null {
  const clean = path.trim()
  if (clean === '' || !clean.startsWith('/')) return null
  for (const rule of rules) {
    if (!under(clean, rule.from)) continue
    const suffix = rule.from === '/' ? clean : clean.slice(rule.from.length)
    return joinPrefix(rule.to, suffix)
  }
  for (const rule of rules) {
    if (under(clean, rule.to)) return clean
  }
  return clean
}

/**
 * Map one DSH-side path for a FILE OPEN: identical to {@link mapPath}.
 *
 * Kept as a named alias so file-open call sites read differently from the
 * workspace-folder call site: both now behave the same (rewrite when a rule
 * matches, pass through unchanged when none does, `null` only for empty or
 * non-absolute input — the open channels all address POSIX absolute paths).
 */
export function mapPathForOpen(path: string, rules: readonly PathMapRule[]): string | null {
  return mapPath(path, rules)
}

/**
 * The inverse of {@link mapPath}: translate one VS Code-server-side path
 * back into the DSH session's view of the same file (longest destination
 * prefix wins; a path already sitting under a SOURCE prefix is DSH-side
 * already and passes through). Used when a selection reference arrives from
 * the embedded VS Code and must name the file the way the DSH session (and
 * the agent's tools) see it.
 *
 * Mirror of {@link mapPath}'s contract: with no rule matching, the path
 * passes through unchanged (same-container deployment — VS Code-side and
 * DSH-side paths are one and the same); `null` only for empty or
 * non-absolute input.
 */
export function reverseMapPath(path: string, rules: readonly PathMapRule[]): string | null {
  const clean = path.trim()
  if (clean === '' || !clean.startsWith('/')) return null
  const byDest = [...rules].sort((a, b) => b.to.length - a.to.length)
  for (const rule of byDest) {
    if (!under(clean, rule.to)) continue
    const suffix = rule.to === '/' ? clean : clean.slice(rule.to.length)
    return joinPrefix(rule.from, suffix)
  }
  for (const rule of rules) {
    if (under(clean, rule.from)) return clean
  }
  return clean
}

/**
 * Normalize the `serverUrl` setting into a usable base: empty → the
 * full-URL default ({@link DEFAULT_SERVER_URL}); trailing slashes dropped
 * (a slash-only value anchors to the page root as `''`, so
 * {@link buildVscodeUrl} renders `/?…` — a literal `'/'` base would render
 * the protocol-relative `//?…`, which no URL parser accepts); a value with
 * neither a URL scheme nor a leading '/' is treated as a subpath and
 * anchored to the page root.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_SERVER_URL
  const anchored = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith('/') ? value : `/${value}`
  const stripped = anchored.replace(/\/+$/, '')
  return stripped === '' ? '' : stripped
}

/**
 * One file the degraded channel asks the workbench to open through VS Code
 * web's native `payload` query parameter (see {@link buildVscodeUrl}).
 */
export interface VscodeOpenFile {
  /** The VS Code-server-side absolute path to open. */
  file: string
  /** The host the browser reaches the VS Code server through (`host[:port]`). */
  authority: string
  /** Optional 1-based line to place the cursor on. */
  line?: number
  /** Optional 1-based column to place the cursor on (requires `line`). */
  column?: number
}

/**
 * Build the iframe target: the (scheme-absolute or same-origin relative)
 * VS Code workbench URL, with `?folder=` naming the mapped workspace
 * (the server opens that folder; `folder === null` opens its default).
 *
 * `open` (the degraded no-extension channel) rides VS Code web's native
 * `payload` query parameter — the same mechanism vscode.dev uses (per the
 * code-server FAQ: payload is upstream VS Code web behavior, no
 * server-specific config needed) — as a URL-encoded `[key, value]` pair
 * array: `gotoLineMode` makes a trailing `:line[:column]` suffix a cursor
 * position, and `openFile` takes a
 * `vscode-remote://<authority><absolute path>` URI where `<authority>` is
 * the host the browser reaches the server through. The payload is consumed
 * once at workbench startup, so this channel costs a full iframe reload —
 * the extension command channel is the primary path and this is its
 * fallback.
 */
export function buildVscodeUrl(base: string, folder: string | null, open?: VscodeOpenFile): string {
  const root = `${base}/`
  if (open === undefined) {
    return folder === null ? root : `${root}?folder=${encodeURIComponent(folder)}`
  }
  const suffix = open.line !== undefined
    ? `:${open.line}${open.column !== undefined ? `:${open.column}` : ''}`
    : ''
  const target = `vscode-remote://${open.authority}${open.file}${suffix}`
  const payload = JSON.stringify([
    ['gotoLineMode', 'true'],
    ['openFile', target],
  ])
  const query = folder !== null ? `folder=${encodeURIComponent(folder)}&` : ''
  return `${root}?${query}payload=${encodeURIComponent(payload)}`
}
