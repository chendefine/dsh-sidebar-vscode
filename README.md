# dsh-sidebar-vscode

[中文](./README.zh-CN.md) · [npm](https://www.npmjs.com/package/dsh-sidebar-vscode) · [GitHub](https://github.com/chendefine/dsh-sidebar-vscode)

A [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) sidebar tab for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that embeds the **VS Code web workbench**, and turns editor selections / explorer files into **atomic reference chips** in the conversation composer — expanded by the host half into model context right after the citing message on submit.

![npm](https://img.shields.io/npm/v/dsh-sidebar-vscode) ![license](https://img.shields.io/npm/l/dsh-sidebar-vscode) ![node](https://img.shields.io/node/v/dsh-sidebar-vscode) ![CI](https://img.shields.io/github/actions/workflow/status/chendefine/dsh-sidebar-vscode/ci.yml) ![stars](https://img.shields.io/github/stars/chendefine/dsh-sidebar-vscode)

## Screenshot

![Product usage screenshot](screenshot.png)

```
editor selection                    explorer
  right-click / Ctrl+Alt+C          right-click file / folder
        │                                  │
        └──────────► atomic chip ◄─────────┘
                  @src/main.ts L10-L12   @src/main.ts   @src
        │                                  │
        ▼ on submit                        ▼
<text-selection path line …>    <file-selection path/> / <folder-selection path/>
  (carries the capture snapshot      (path only, no content)
   and freshness flags)
```

- Package: [dsh-sidebar-vscode on npm](https://www.npmjs.com/package/dsh-sidebar-vscode)
- Source: [chendefine/dsh-sidebar-vscode on GitHub](https://github.com/chendefine/dsh-sidebar-vscode)
- Version: 0.1.4
- License: MIT
- Platform: web (the DSH Web GUI)
- Tests: 273 passing (13 spec files)

## Features

**The tab**

- Registers a `VSCode` tab (id `dsh-sidebar-vscode:vscode`) in the better-sidebar sidebar, embedding the `code serve-web` workbench in a same-origin iframe opened at **the current session's workspace** (`<base>/?folder=<mapped path>`); switching tabs never destroys the iframe, so the VS Code session survives.
- The toolbar shows the workspace path with reload / open-in-new-window actions; all chrome follows the DSH appearance (light / dark / system); copy is bilingual (zh/en).

**Reference injection**

- **Selection references**: select code inside the embedded VS Code, right-click *"DSH: Send Selection to Session"* (中文界面：「DSH: 发送选中代码到会话」) or press **Ctrl/Cmd+Alt+C** — the selection lands in the composer at the **current caret** as one **atomic chip** (`@src/main.ts L10-L12`; one backspace deletes it whole; a composer selection is replaced); multi-cursor selections produce one chip each in editor order. On submit the host half expands it at `agent/pre-step` into a standalone context message right after the citing one:

  ```xml
  <!-- User-captured VS Code selection (capture-time snapshot); re-read the
       file before editing. -->
  <text-selection path="src/main.ts" line="L10-L12" lang="typescript">
  const a = 1
  const b = 2
  const c = 3
  </text-selection>
  ```

- **Explorer file/folder references**: right-click files/folders in the explorer (*"DSH: Send File/Folder to Session"*; multi-select aware, the file vs. folder entry is picked by the right-clicked item) — each item lands at the composer's current caret as one atomic chip: `@src/main.ts` for a file, `@src` for a folder. Resource references **carry no content**: on submit they expand into content-less, guidance-free markers — the tag name itself expresses the file/folder kind, and the model reads the bytes only when it needs them:

  ```xml
  <file-selection path="src/main.ts"/>
  <folder-selection path="src"/>
  ```

- **Reference management**: a rail above the composer groups every chip by reference (truncated / folder badges, occurrence counts); its × removes all chips of that reference through one draft write. A chip's serialized form is a self-contained canonical mention — the draft text is the single store of truth; delete it all and nothing is injected, with no leftover state.

- **Fallbacks & recovery**: with a cross-origin `serverUrl` the same-origin bridge is unavailable — the envelope lands on the real clipboard and **pasting it into the composer still recognizes** it as chips, landing them at the paste caret; when the input machine refuses a chip insert (mid-submit transient) the mention degrades to plain text (the host parses it identically, only the chip affordance is lost); **copying a rendered reference and pasting it back** — even as whitespace-mangled sigil text (`@ [ label ]( dsh-vscode: … )`) or a truncation that lost the closing paren — is re-validated canonically and rebuilt as atomic chips at the caret with the surrounding prose kept verbatim (fail-soft, never throws).

- **Default tab**: an optional switch makes **brand-new sessions** open the VSCode tab by default (replacing better-sidebar's hardcoded seeded Files tab); used sessions keep their own layouts, and turning it off only affects future sessions.

- **Chat file-click takeover** (gated by the same switch; research options II + III): clicking **produced-file chips** (the per-turn changed-files row), tool-row path links, or prose file mentions in the conversation no longer opens better-sidebar's built-in Files tab — it focuses this VSCode tab (the panel auto-expands) and opens the file inside the embedded VS Code, with no workbench reload. Two takeover seams: **option II** — register the `conversation.chat.turnTail` slot at priority -2 (before better-sidebar's own -1 entry), claim the produced-files row with the same derivation (reading the engine Turn data's `deliverables` record first, the node replica as fallback), and render its chips as a visual twin whose clicks reroute here; **option III** — wrap `workspaces.openPath` (the client runtime's single funnel for the remaining chat-side opens; ui-conversation's apply.ts is its only production caller). Option III also repairs a headless-container hole: better-sidebar declines its own takeover whenever its built-in Files tab is disabled, letting opens fall through to the Host OS opener (`spawn xdg-open ENOENT`); this wrapper keeps them landing in the VSCode tab regardless of that setting. After the click: the tab's meta carries an `openRequest` → this plugin's host half writes `/tmp/dsh-sidebar-vscode/<slug(workspace)>/cmd.json` → the extension (≥ 0.1.1) polls every 500ms and consumes it via `showTextDocument`; a `cap.json` liveness marker plus a capability probe gate the channel, and any miss degrades to a one-shot URL-`payload` workbench reload. Switch off = the feature is entirely disabled (chat behavior unchanged).

- **Settings "open configuration file" takeover** (option IV, same switch): the settings page's「打开配置文件」button stock-behavior calls `/api/settings.openDocument`, which hands `$DSH_HOME/settings.yaml` to the Host OS opener — dead on headless containers (`xdg-open` missing). With the switch on, this plugin instead resolves the document path through its own fenced node-half route (`POST /sidebar-vscode/api/settings.document` → `prepareDocument()`), then reroutes it through the very same `openRequest` channel as the chat clicks — the file opens inside the embedded VS Code (the absolute path needs no `pathMap` rule since `mapPathForOpen` passes unmatched paths through). A landed reroute also closes the settings dialog itself: its open state is component-local (no service exposes a close), so the close rides the panel's own document-level Escape listener — mounted exactly while the dialog is open — via one synthetic Escape keydown, leaving the workbench in view. Fail-soft: an absent settings provider, an un-reloaded host half, or any transport error falls back to the stock `/api` call (dialog stays open), so the button never breaks.

## Installation

### Prerequisites

- A DSH host (Web GUI) with [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ≥ 0.12 installed (an optional peer: without it tab registration silently skips while the paste fallbacks keep working; the dev baseline is 0.16);
- A `code serve-web` instance reachable from the browser. In the default topology it runs **inside the dsh-runtime container**, reverse-proxied through the gateway's same-origin `/vscode` subpath (see [deployment topology](#deployment-topology-why-the-defaults)) so the browser session carries over and WebSockets work;
- The companion VS Code extension `dsh.selection-reference` installed into that serve-web instance (it provides the context-menu commands and the keybinding; **the chat file-open channel needs ≥ 0.1.1** — see below).

### The plugin itself

**Channel A — the bundle channel (standard, recommended for clean profiles)**

The package ships a `dsh.bundle.patch` (`cordis.patch.yml`: one insert row mounting the host-half entry). From the npm registry (prebuilt — no build permission needed):

```sh
dsh plugin --profile web add dsh-sidebar-vscode
```

From the GitHub repository (source — pnpm runs the `prepare` build; the repo also carries the committed `lib/` artifacts as a fallback):

```sh
dsh plugin --profile web add github:chendefine/dsh-sidebar-vscode
```

Or through the DSH plugin marketplace (设置 → DSH插件市场) — tag the repo with the `dsh-plugin` topic and it is indexed automatically.

After a bundle plugin is added to the profile layer stack, **restart `dsh web`** for it to load; uninstall with `dsh plugin --profile web remove dsh-sidebar-vscode` and restart again.

**Channel B — link + a manual mount row (the hot channel of this deployment, no restart)**

```sh
# 1. Install the plugin as a link: dependency of the web profile
#    (repo checkout path, e.g. /opt/dsh/plugins/dsh-sidebar-vscode; this
#     deployment's profile dir: /data/dsh-home/profiles/web)
pnpm -C <profile-dir> add link:<repo-checkout>

# 2. Append the mount row to the profile's own cordis.patch.yml
#    - insert:
#        - id: dsh-sidebar-vscode
#          name: dsh-sidebar-vscode
```

`watchUserPatches` hot-mounts the node half, the client boot graph recomputes live, and `/plugins/dsh-sidebar-vscode/client.js` is served immediately — a **hard refresh** (Cmd/Ctrl+Shift+R) reveals the new tab.

> ⚠️ **The two channels are mutually exclusive**: the package's bundle row and the profile's manual row share the entry id `dsh-sidebar-vscode` — having both fails at startup with a duplicate entry. Remove the other channel's row (and the link dependency) before switching. The in-package double-mount guard (`disabled: !!js …`) is left commented out by default.

> Note: **client-half** changes apply on a hard refresh; **host-half** changes (`src/index.ts` / `src/mention.ts`) need a `dsh web` restart (or a hot re-mount of the entry through the profile channel) before the new bundle loads.

### The VS Code extension

The send commands and the **chat file-click polling channel** come from the `dsh.selection-reference` extension (sources in `extension/`), which must be installed into the serve-web instance. **The file-open channel needs ≥ 0.1.1** (older versions only have the send commands; open clicks degrade to the URL-payload reload):

```sh
scripts/install-extension.sh                  # package VSIX → install → register manifest → restart → health-check
scripts/install-extension.sh --skip-build     # reuse the built VSIX
scripts/install-extension.sh --vsix <path>    # use a given VSIX
```

The local `code` binary is the standalone CLI (no desktop install), so `code --install-extension` does not work; the script installs via four steps: package with vsce → drop files → register the `extensions.json` manifest → restart serve-web with its exact previous argv. Step-by-step details and troubleshooting: [`scripts/install-extension.md`](scripts/install-extension.md) (中文).

## Usage

### Opening the tab

Pick **VSCode** from the sidebar「+」menu; or turn on the `openAsDefault` setting so brand-new sessions open it by default (a collapsed panel stays collapsed — the tab is simply what the next expansion shows). The toolbar shows the workspace path;「⧉ open in new window」pops a standalone one.

### Sending a selection

1. Select code in the embedded editor (multi-cursor = one chip each);
2. Right-click → *"DSH: Send Selection to Session"*, or press **Ctrl/Cmd+Alt+C**;
3. The atomic chip `@src/main.ts L10-L12` appears in the composer — success is silent (the chip *is* the feedback); only degradations/failures flash an amber notice in the toolbar;
4. Type and submit as usual. The chip is rewritten to the readable `@path L10-L12`, and the `<text-selection>` context is injected right after the message.

Selection reference details:

- **Dedup**: within one step by `(path, start, end)` — sending the same selection twice injects one context; the same range with different content (file changed) keeps the **newest capture**;
- **Freshness**: at submit the disk range is re-read confined to the session cwd and hash-compared — a mismatch marks `stale="true"`; a truncated snapshot instead verifies its kept head/tail halves (truncation alone never marks stale); an unsaved buffer marks `dirty="true"`; the snapshot text is always injected (no filesystem dependency), and the leading comment tells the model to re-read before editing;
- **Truncation**: beyond `maxLines` (default 200) / `maxBytes` (default 20000, guards minified single-line files) the head and tail halves are kept with the middle omitted inline as `... (N lines omitted, L51-L150) ...`, the tag carries `truncated="true"`, and the real line range is preserved;
- The context message source is `{ kind: 'vscode-mention', form: 'notice', version: 1, path, startLine, endLine, language?, contentHash, bytes, truncated, dirty, stale }`.

### Sending files / folders

Select files/folders in the explorer (multi- and mixed-select work), right-click → *Send File/Folder to Session* (the entry sits near "Copy Path"). One chip per item: `@src/main.ts` (file icon) or `@src` (folder icon); the kind comes from the extension's `workspace.fs.stat` (symlinks classify by target). On submit each expands to `<file-selection path/>` / `<folder-selection path/>` with source `{ kind: 'vscode-resource', form: 'notice', version: 1, path, type }`. Resource references do **no freshness check and ignore the truncation caps**; within one step they dedupe by `(path, kind)`, and a selection reference and a resource reference on the same path stay independent.

### Managing references

- The rail above the composer lists every VS Code reference (truncated `…` badge, folder icon, ×N count); a tag's **×** removes all chips of that reference at once;
- One backspace deletes a whole chip; once no mention of a reference remains in the draft, submit injects nothing for it;
- Copying a (rendered) chip and pasting it back rebuilds atomic chips.

### Settings

Settings live under "side card → VSCode → 功能设置" (the tab card's gear popup); all five rows render through this plugin's own panel and persist in better-sidebar's `pluginSettings['dsh-sidebar-vscode:vscode']` — **not** in cordis.patch.yml:

| Key | Default | Description |
|---|---|---|
| `openAsDefault` | `false` | Brand-new sessions open this tab by default (replacing the seeded Files tab); used sessions keep their layouts. The switch also gates the chat file-click takeover and the settings「打开配置文件」takeover |
| `serverUrl` | `/vscode` | Server base URL: same-origin gateway subpath, or a full address (e.g. `http://127.0.0.1:8000/vscode` to bypass the gateway locally; keep the `/vscode` base path) |
| `pathMap` | `/data/workspace=/data/workspace;/opt=/opt` | DSH prefix → VS Code container prefix as `src=dst` pairs joined by `;`; longest source prefix wins; a path already under a destination passes through unchanged. Rules are prefix rewriters, **not a whitelist**: chat-side file opens of absolute paths no rule matches pass through as-is (VS Code itself reports a genuinely missing file); only an unmappable session cwd opens the default view with a notice |
| `maxLines` | `200` (range 1–2000) | Max rendered code lines per reference; overflow keeps head+tail halves and marks the omitted middle inline |
| `maxBytes` | `20000` (range 1000–200000) | UTF-8 byte cap per reference (guards minified single-line files) |

(Selection injection itself is always on — no switch.) Number rows enforce their range as you type (red field + inline hint; out-of-range edits snap to the nearest bound on commit); text rows stack description-over-input.

### Troubleshooting

| Symptom | Fix |
|---|---|
| The tab stays blank / the loading hint never clears | Check `serverUrl` reachability; diagnose via "open in new window"; with a cross-origin URL the bridge is off by design (paste fallback still works) |
| "The current workspace path cannot be mapped…" notice | The session cwd is outside the `pathMap` roots (e.g. `/tmp`); add a rule in the settings |
| No DSH command in the context menu / palette | Extension not installed, serve-web not restarted (the manifest is scanned at startup only), or the workspace is untrusted (restricted mode) — see the FAQ in `scripts/install-extension.md` |
| No chip after sending; a code snippet appears on the clipboard | Landing failed and the readable fallback reached the clipboard (no composer / cross-origin); paste it into the composer to recover chips |
| "Injected as a text reference…" notice | The composer was mid-submit so the chip degraded to a plain-text mention — submitting works the same |

## Architecture

### The two halves

A DSH plugin has a host (node) half and a browser half; this plugin's split:

```
┌─ host half (node) ─────────────────────────────────────────────┐
│ src/index.ts    agent/created → mount agent/pre-step per agent │
│ src/mention.ts  the boundary core: parse/rewrite, dedup,       │
│                 freshness, context injection                   │
└────────────────────────────────────────────────────────────────┘
┌─ browser half (web) ───────────────────────────────────────────┐
│ src/client/index.tsx        register tab + dock + @ source     │
│ src/client/VscodeView.tsx   cwd → path mapping → iframe+bridge │
│ src/client/references.ts    payload→chips, insert, rail, paste │
│ src/client/composer.tsx     the dock: reference rail + pastes  │
│ … (full listing under Repository layout below)                 │
└────────────────────────────────────────────────────────────────┘
```

- The **host half** owns the model-facing seam: per live agent it listens at `agent/pre-step`, parses canonical mentions in the claimed user messages (markdown and bare URIs, both schemes, strict canonical validation), rewrites them to readable labels (`freezeMessage` keeps message ids), dedupes by reference identity, and injects each context (`createUserMessage`) right after the first message citing it. The filesystem is consulted only for freshness marks — snapshot content rides inside the mention, so injection never depends on disk state;
- The **browser half** owns all UI: the tab, chips, the rail, the settings panel, dictionaries; without better-sidebar, tab registration silently skips.

### The four-stage chain

Both reference kinds share one chain:

1. **VS Code extension** (`extension/`): the selection command packs `{ path, relative?, language?, dirty?, spans[] }`; the resource commands `workspace.fs.stat` each URI and pack `{ kind: 'resource', resources: [{ path, relative?, type }] }` (no content), handed to `vscode.env.clipboard.writeText` inside the envelope `@@DSH_REF::<base64url(json)>::\n<readable fallback>`;
2. **Clipboard signal bridge** (`src/client/clipboardBridge.ts`): same-origin iframe privilege — the parent page patches `navigator.clipboard.writeText` on the workbench window, intercepting the extension host's clipboard chain (ext host → MainThreadClipboard → BrowserClipboardService → the late-bound `navigator.clipboard.writeText`); a successful landing never touches the real clipboard, a failed one writes the readable fallback for manual paste; on cross-origin URLs the bridge no-ops;
3. **Composer chips** (`src/client/references.ts` + `composer.tsx`): the payload is reverse-mapped through `pathMap` back into DSH space (relativized under cwd), truncated (head+tail halves), hashed via `crypto.subtle` into the sha-256 prefix, and formatted as the canonical mention, then landed as an atomic occurrence chip through the `conversation.input` service's `insertReference` — at the composer's **current caret**: the displayed composer's live textarea selection whenever it belongs to the addressed session (a selected range is replaced, a batch splices in order, and the caret is restored just past the last chip); when no caret is addressable (session mismatch, no live composer) the landing keeps the historical end-of-draft zero-width span CAS; this plugin registers the `@` trigger source `vscode-reference` (candidates always empty — it exists purely so submit serialization routes through its codec); the `conversation.input.dock` component renders the rail and intercepts pastes at the document capture phase (envelopes go to the injection lander at the paste caret; recovered mention copies land as chips — `preventDefault` alone does not stop the composer's React onPaste, so `stopPropagation` rides along);
4. **Host boundary** (`src/mention.ts`): after the strict parse, one fail-soft recovery scan catches whitespace-mangled copies; closing-tag collisions are salted with the content hash so the body cannot forge a terminator.

### The mention codec

- Canonical form: `@[<escaped label>](dsh-vscode:<base64url(json)>)` (selections) / `dsh-vscode-res:` (resources); the payload is self-contained (path / lines / snapshot / hash / flags), so the draft text is the single store; the two scheme prefixes are mutually exclusive — neither can over-match the other;
- Decoding must re-encode to the identical URI (the canonical discipline shared with `dsh-session:` references): an explicit markdown mention with a malformed URI fails loudly; bare text counts as a reference only when a base64url shape follows the scheme, and it must still pass canonical validation;
- The recovery layer (`scanRecoveredMentions`) recognizes whitespace-drifted copies and truncations that lost the closing paren; projections are rebuilt only from payloads that fully validate — a copied label is never trusted (it is display residue);
- The shared pure module `src/mentionCodec.ts` has no Node builtins and no `@deepseek-ai/*` value imports, so both the host and browser bundles reuse it verbatim (it passes the client purity gate).

### Truncation & freshness

- At capture (`truncateSnapshot`): LF-normalize → line cap (whole head/tail half-lines) → byte cap (head shrunk from its end, tail from its start, multi-byte safe); the payload records `headLen` / `omitLines` / `omitBytes` and the host renders the inline omission marker, which the counters exclude;
- At submit (`freshnessOf`): the disk range is re-read confined to the session cwd (escapes / files over 8 MiB / read failures all yield `unknown`), hash-compared into `fresh` / `stale`; a truncated snapshot verifies that the disk range starts with the kept head, ends with the kept tail, and holds at least one char between them (edits inside the omitted middle are undetectable; truncation alone never marks stale).

### The default-tab swap

better-sidebar hardcodes the fresh-session seed (upstream `makeDefaultState('editor-home')` — a path-less Files editor tab) — there is no "default tab" preference. This plugin implements the companion approach the upstream service suggests (`src/client/defaultTab.ts`, no upstream changes): it watches the sidebar store, and while the switch is on and the active session still carries its **pristine seed** (single pane, at most the one path-less Files tab, no minted counters, no expansions, no bottom tabs, no floats), it `openTab({ type })`s the VSCode tab and `closeTab`s the seed — a replacement, not an addition; a type-only open never expands a collapsed panel. The swap runs once per session (a `localStorage` marker — without it, closing the tab would let the next store notification re-open it forever); a disabled tab type or a refused open never costs the sidebar its seed.

### Deployment topology (why the defaults)

The VS Code server (`code serve-web`) runs **inside the dsh-runtime container**:

```
code serve-web --host 0.0.0.0 --port 8000 --server-base-path /vscode \
  --server-data-dir /data/workspace/.vscode --without-connection-token \
  --default-folder /data/workspace

nginx: location /vscode/ → 127.0.0.1:8000 (with WebSocket upgrade)
      the gateway merely proxies user → instance; /vscode is no special
      case, so adding/removing users needs zero gateway sync
```

The DSH session and the embedded workbench see **the same filesystem under the same paths**, so the default map is the identity pair `/data/workspace=/data/workspace;/opt=/opt` — pure pass-through signposts. The rules are prefix rewriters, not a whitelist: chat-side **file opens** that match no rule pass through at their original path (any readable file opens in the same-container deployment; existence is the open channel's call), and only an unmappable session **cwd** shows the notice and opens the default view (e.g. a `/tmp` session — add a rule if you want it mapped). Move the workbench to another container/mount and rewrite the prefixes via `pathMap`.

### Repository layout

```
src/index.ts                  # host-half entry: agent/created → pre-step boundary (inject: agents)
src/mention.ts                # host-half core: parse/rewrite/dedup/freshness/<text-selection> etc. (36 tests)
src/mentionCodec.ts           # shared pure logic: canonical URI codecs (2 schemes)/truncation/hashing (42 tests)
src/client/index.tsx          # browser-half entry: tab + dock + @ source + dicts (ctx.effect, HMR-safe)
src/client/VscodeView.tsx     # tab component: cwd → path mapping → iframe + toolbar/notices + bridge
src/client/clipboardBridge.ts # same-origin iframe navigator.clipboard.writeText signal patch (8 tests)
src/client/composer.tsx       # dock component: reference rail (self-adopted styles) + paste fallbacks
src/client/references.ts      # payload→chips (selection/resources)/insert at the caret/rail projection/paste recovery (45 tests)
src/client/selection.ts       # clipboard envelope codecs (selection + resource payloads) (14 tests)
src/client/paths.ts           # pathMap parse/map/reverse-map, URL building (20 tests)
src/client/settings.ts        # pluginSettings reads + capture-cap contract (defaults/bounds/commit) (14 tests)
src/client/settingsRows.tsx   # settings panel: switch row + stacked text rows + cap rows (self-adopted styles)
src/client/settingsTakeover.ts # settings「open configuration file」takeover: wraps settings.openDocument + dialog close behind the same switch (7 tests)
src/client/defaultTab.ts      # "open VSCode by default": pristine-seed detection + swap rails + watcher (22 tests)
src/client/i18n.ts            # locale service wiring + t()
src/client/locales.ts         # zh/en dictionaries
src/client/icons.tsx          # VS Code mark + chip file/folder/close icons (currentColor SVG)
extension/                    # the VS Code extension dsh.selection-reference (commands + menus + keybinding + nls + the file-open polling channel)
 ├ extension.js / harness.js / package.json / package.nls*.json / .vscodeignore / vsix/*.vsix
scripts/install-extension.sh  # one-command extension install (vsce package → files → manifest → restart → health)
scripts/install-extension.md  # step-by-step install doc + troubleshooting (Chinese)
README.md / README.zh-CN.md   # this doc (English) / the Chinese doc
screenshot.png                # product usage screenshot (see [Screenshot](#screenshot))
tests/*.spec.ts               # vitest specs — 269 tests / 13 files (per-file counts noted above)
cordis.patch.yml              # the bundle channel's host-half insert row (mount declaration)
dsh.plugin.json               # plugin manifest (metadata)
tsdown.config.ts              # dual-bundle build (host ESM + client ModuleLoader format + purity gate)
vitest.config.ts              # test-time dsh-llm alias (harness checkout preferred, installed package fallback)
lib/                          # build outputs (committed: the link: deployment serves lib/client.js directly)
.github/workflows/ci.yml      # CI: typecheck / test / build / package verification on Node 22 & 24
```

Build outputs: the host half is a plain ESM bundle (`@deepseek-ai/dsh-llm` stays external, resolved by the DSH host loader); the browser half is a `window.__ModuleLoader__.load({ id, factory })` registration bundle (the official external client-plugin delivery format) with React / cordis external and a **purity gate** that rejects Node builtins and `@deepseek-ai/*` value imports.

## Development

### Build & test

```sh
git clone https://github.com/chendefine/dsh-sidebar-vscode && cd dsh-sidebar-vscode
pnpm build        # tsc declarations + tsdown dual bundle → lib/
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (269 tests)
```

Rebuild, then hard-refresh the browser (the link: dependency plus content-rev query params bust caches); host-half changes need a `dsh web` restart.

### Environment notes

- **pnpm ≥ 11**: pnpm-specific settings are read **only** from `pnpm-workspace.yaml` (same-named `.npmrc` keys are silently ignored). This repo pins `autoInstallPeers: false` (internal `@deepseek-ai/*` packages are not on the public registry) and `verifyDepsBeforeRun: false` (node_modules + lockfile are a frozen baseline; skip the pre-run check) there, plus `allowBuilds.node-pty: false` (types-only dependency; its native build never runs);
- **Type & runtime mapping**: the `@deepseek-ai/*` build-time packages (`dsh-llm`, `dsh-agent`, and `dsh-llm`'s runtime peers) are devDependencies resolved from the npm registry, so plain clones and CI work out of the box; tsconfig `paths` and the vitest alias prefer a sibling harness checkout (`/app/dsh`) when one exists — its built artifacts are fresher than the published rc's — and fall back to the installed packages otherwise;
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs typecheck / test / build / package-content verification on Node 22 and 24 — the matrix mirrors DSH's own support range (`^22.19.0 || >=24.0.0`, which the published `engines` field matches);
- **devDependencies baseline**: `dsh-better-sidebar@^0.16` and the `@deepseek-ai/*` devDependencies exist for types, tests, and dev-time alignment only — at runtime they are all optional peers resolved by the DSH host;
- **Extension manual harness**: `node extension/harness.js extension/extension.js` (stubs the injected `vscode` module, runs all three commands, prints each envelope + decoded payload).

### Publishing

The npm package is `dsh-sidebar-vscode` (repo: `chendefine/dsh-sidebar-vscode`):

```sh
# 1. bump package.json version (and extension/package.json when extension/ changed)
# 2. build + test, then publish (prepublishOnly re-runs the build)
pnpm test && pnpm publish --access public
# 3. tag & push the release
git tag v<version> && git push origin main --tags
```

`extension/` (the VS Code extension) rides along in the npm tarball but is never loaded by DSH itself — it installs into a serve-web instance via `scripts/install-extension.sh` (see [Installation](#installation)). After changing it, bump `extension/package.json`'s version and re-run the script so the committed VSIX stays in sync.

### Known limits

- With a cross-origin `serverUrl` the same-origin clipboard bridge is unavailable (browser same-origin policy) — only the paste fallback remains;
- Selection injection is always on; there is no switch;
- Host-half changes take effect only after a `dsh web` restart;
- tsdown emits deprecation warnings for `external` / `noExternal` (output is correct; migration to `deps.*` is future work).

## License

MIT (see [LICENSE](LICENSE)).
