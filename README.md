# dsh-sidebar-vscode

[中文](./README.zh-CN.md) · [npm](https://www.npmjs.com/package/dsh-sidebar-vscode) · [GitHub](https://github.com/chendefine/dsh-sidebar-vscode)

An **official right-Sidebar tab type** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) that embeds the **VS Code web workbench** (`ctx.sidebarRightTabs` + the `sidebar.right.pane.tab` seat of `@deepseek-ai/dsh-client-ui-sidebar-right`), and turns editor selections / explorer files into **atomic reference chips** in the conversation composer — expanded by the host half into model context right after the citing message on submit. Its user-facing settings live in the official plugin-config card: 设置 → 插件 → 插件配置 → **VSCode 侧边栏**.

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
- Version: 0.3.1
- License: MIT
- Platform: web (the DSH Web GUI)
- Tests: 477 passing (24 spec files)

## Features

**The tab**

- Registers the official right-Sidebar **page tab type** `vscode` (two stages: the static definition into `ctx.sidebarRightTabs` — guide-page entry box included — and the body into the keyed `sidebar.right.pane.tab` seat), embedding the `code serve-web` workbench in a same-origin iframe opened at **the current session's workspace** (`<base>/?folder=<mapped path>`). Note the official pane renders only the ACTIVE tab's body: switching to a sibling tab in the same pane unmounts the workbench (a reload the boot gate + editor-ledger reconcile handle; a floated panel stays mounted), and switching back remounts it through the same robust path.
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

- **The `openAsDefault` switch** gates the three file-open takeovers below (the better-sidebar-era "swap the fresh session's seeded Files tab" behavior is gone with that system — the official sidebar seeds the guide page, keeps layout in memory only, and its `openTab` always expands the column, so the guide-page entry box is the discovery path for new sessions).

- **Right-sidebar expand-button takeover** (gated by the same switch): the conversation header's expand control while the column is collapsed (the official `ExpandButton`, the one node carrying `data-sidebar-right-expand`) stock-expands to whatever tab was last active — on a fresh surface that is the seeded guide (with several registered guide entries the official seed rule always resolves to the guide). With the switch on, this plugin captures that button's clicks at the document's CAPTURE phase and re-issues them as `openTab('vscode')`: the session's ONE workbench page tab is revealed or created and the column expands in the same step (the open's own expansion subsumes the `setExpanded(true)` the button would have run; the click is consumed — `stopPropagation` + `preventDefault` — only after the open succeeded, and a failure lets the stock expand proceed). The button acts on the per-session store directly with no public service seam, so the DOM capture is the one stable interception point; the switch is read per click, and off restores the official behavior completely.

- **Chat file-click takeover** (gated by the same switch): clicking **produced-file chips** (the per-turn changed-files row), tool-row path links, or prose file mentions in the conversation opens the file inside the embedded VS Code instead of the stock viewer — the official runtime routes every one of those opens through the `ctx.sidebarRight.openResource` public funnel (ui-chat's injected `openFile`, the deliverables row's chips, prose file links), and this plugin wraps that ONE seam on the controller instance (an own-property shadow over the prototype method; restored only-while-ours on dispose). The wrapper parses the `dsh-resource://file/session/<id>/<rel>` / `…/absolute/<path>` address, resolves the session workspace root, and translates the open into `openTab('vscode', { params: { path, line? } })` — the column expands and the ONE workbench tab is revealed, the file landing inside it through `tab.navigation` (a monotonic `revision` with the params: the one-shot command vehicle). **File-type blocklist (`openBlocklist`)**: a file whose extension is on the list (by default pdf/docx/xlsx/pptx/png/jpeg/jpg; editable in the settings card) is NOT taken over — the call falls through UNTOUCHED to the stock routing, where the official registry's viewers claim it (today the builtin text preview; any future viewer plugin registers its own type). Declines behave identically: switch off, a non-file address, an unparseable one, or an unknown session root all fall through, and the settings are read per click. After the claim: the body's navigation consumer → the extension spool (`/tmp/dsh-sidebar-vscode/<slug(workspace)>/cmd.json`, polled every 500ms, `showTextDocument`) — a `cap.json` liveness marker plus a capability probe gate the channel, and any miss degrades to a one-shot URL-`payload` workbench reload. **Boot-tagged delivery (extension ≥ 0.1.3)**: the command is deferred until this boot's nonce is parked and tagged with it (`cmd.json {boot}`); only the extension host that activated with the same nonce consumes a tagged command (a lingering previous host must not eat it into its dying window). Switch off = the feature is entirely disabled (chat behavior unchanged).

- **Settings "open configuration file" takeover** (same switch): the settings page's「打开配置文件」button stock-behavior hands `$DSH_HOME/settings.yaml` to the Host OS opener — dead on headless containers (`xdg-open` missing); on the current runtime the click drives the `remote.settings.openSettingsDocument` Host Remote (SettingsDocumentStore.open is its only production caller; the wrapper redefines the namespace method's getter-only own property, installed through a nested optional inject that parks until the `remote.settings` service exists), and on pre-gateway runtimes the legacy `/api/settings.openDocument` member — exactly one of the two ever intercepts. With the switch on, this plugin instead resolves the document path through its own fenced node-half route (`POST /sidebar-vscode/api/settings.document` → `prepareDocument()`), then reroutes it as `openTab('vscode', { params: { path } })` — the same navigation channel as the chat clicks; the file opens inside the embedded VS Code (the absolute path needs no `pathMap` rule since `mapPathForOpen` passes unmatched paths through). A landed reroute also closes the settings dialog itself: its open state is component-local (no service exposes a close), so the close rides the panel's own document-level Escape listener — mounted exactly while the dialog is open — via one synthetic Escape keydown, leaving the workbench in view. Fail-soft: an absent settings provider, an un-reloaded host half, or any transport error falls back to the stock open (dialog stays open), so the button never breaks.

## Installation

### Prerequisites

- A DSH host (Web GUI) whose web app carries the official right Sidebar (`@deepseek-ai/dsh-client-ui-sidebar-right`; the `sidebarRightTabs` / `sidebarRight` / `settingsScope` services exist from 0.1.5-alpha.1 — the session header's「展开侧栏」button is the visible tell). Without it the client fiber parks silently and nothing registers;
- A `code serve-web` instance reachable from the browser — pick a wiring shape:
  1. **Built-in proxy (the default; the choice for gateway-less deployments: Windows, LAN `dsh web`)** — an EMPTY `serverUrl` defaults to `http://127.0.0.1:8000` (a bare local `code serve-web` — the CLI's own defaults), or paste any full address it prints (base path and `?tkn=` token included). The address is pushed via `/sidebar-vscode/api/proxy.config` and mounted as the **same-origin `/sidebar/vscode/`** on the very port `dsh web` listens on (transparent HTTP forwarding, WebSocket upgrade pipe, token auto-append) — zero nginx, zero start flags:
     ```sh
     code serve-web            # zero-config: port 8000, root path
     ```
     Routing self-corrects to the `serverBasePath` baked in the index HTML, so `--server-base-path` is optional (non-mount bases get an identity mirror; root upstreams a `<quality>-<commit>` shim). When the host cannot reach the address yet, the tab falls back to the direct iframe with a notice and switches to the mount automatically once the proxy serves. Tip: run serve-web with `--server-base-path /sidebar/vscode` to gather every request under the single mount prefix (identity mount, no mirror/shim). Pre-configure without settings via `DSH_SIDEBAR_VSCODE_UPSTREAM` (full URLs; default `http://127.0.0.1:8000`; `off` disables). If `/sidebar/vscode` is owned by another plugin the feature backs off with a warning;
  2. **Gateway same-origin subpath (the reference topology)** — serve-web runs inside the dsh-runtime container behind the gateway's `/vscode` reverse proxy (see [deployment topology](#deployment-topology-why-the-defaults)); same-host deployments may leave `serverUrl` empty (the built-in proxy takes over). Only when serve-web is NOT reachable from the DSH host (a split gateway) configure it explicitly (`serverUrl` = `/vscode`, or the env var pointing at the real address);
  3. **Cross-origin direct URL (automatic fallback shape)** — appears only when the host half cannot proxy: the clipboard signal bridge is off (paste fallback keeps working), selections degrade to copy → paste;
- The companion VS Code extension `dsh.selection-reference` installed into that serve-web instance (it provides the context-menu commands and the keybinding; **the chat file-open channel needs ≥ 0.1.2** — see below).

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

The send commands and the **chat file-click polling channel** come from the `dsh.selection-reference` extension (sources in `extension/` — decomposed into `extension.js` + `lib/{protocol,fsutil,envelope,channel,boot}.js` along the same seams as the host/client halves), which must be installed into the serve-web instance. **The file-open channel needs ≥ 0.1.2** (0.1.1 replays consumed commands on every workbench reboot — see the replay guards below; its capability marker fails the version probe, so open clicks safely degrade to the URL-payload reload):

```sh
scripts/install-extension.sh                  # package VSIX → install → register manifest → restart → health-check
scripts/install-extension.sh --skip-build     # reuse the built VSIX
scripts/install-extension.sh --vsix <path>    # use a given VSIX
```

The local `code` binary is the standalone CLI (no desktop install), so `code --install-extension` does not work; the script installs via four steps: package with vsce → drop files → register the `extensions.json` manifest → restart serve-web with its exact previous argv. Step-by-step details and troubleshooting: [`scripts/install-extension.md`](scripts/install-extension.md) (中文).

**Replay guards (≥ 0.1.2)** — closing the sidebar's VSCode tab tears the workbench iframe out of the DOM and reopening it boots a fresh extension host; a spool command that survives consumption re-opens its file on every such reboot (the "closed file reopens on next VS Code start" bug). Three independent guards: the extension **deletes `cmd.json`** the moment it acts on it (or skips it as garbage/TTL-expired — commands older than 10 minutes are never opened), a consumed-nonce **watermark persists in `last.json`** for delete-failed corners, and the **versioned `cap.json` marker (`{v:2,at}`)** makes the client's capability probe refuse the replaying 0.1.1 outright.

**Clean embedded boots: ledger + reconcile + hidden reveal (≥ 0.1.2)** — the iframe teardown also skips VS Code's unload lifecycle, so its editor-state restore can replay a file the user closed seconds before closing the tab (VS Code flushes workspace editor state only periodically). The model restores exactly what was open at teardown and shows nothing in between:

- **Editor ledger (`editors.json`)** — the extension records the window's open file-tabs (order + active editor) into the spool synchronously on every tab change, so the teardown race cannot lose it; whatever is on disk at the next activation is the previous session's final state.
- **Boot reconcile** — at activation the extension waits for VS Code's own restore to settle, then makes the window match the ledger: restored tabs the ledger does not list (files closed before the teardown) are closed — dirty tabs survive, data wins —, ledger files the restore lost are reopened, and the active editor is restored. A boot with **no ledger** (first ever boot in a workspace, or a degraded URL-payload open) keeps VS Code's own behavior untouched.
- **Hidden reveal (`boot.begin` / `boot.status`)** — before mounting the iframe the tab parks a boot nonce (`bootreq.json`); the extension echoes it in its post-reconcile `boot.json` receipt, and the client keeps the frame at opacity 0 behind the loading overlay until the echo lands. The first *visible* frame already shows the reconciled editor area — nothing ever visibly opens just to be closed again. The reveal is a **race**, not a single wait: the receipt poll runs concurrently with the **DOM-quiet watcher** (same-origin peek at the workbench's editor tab strip) and whichever settles first wins — a reloaded frame's extension host may never re-activate (its receipt then never lands), and a workbench that has painted is proof enough that the staging is done. Quiet alone is not that proof, though: during a ghost boot the strip is *quiet-but-wrong* for the whole reconcile settle window (quietness is the precondition of the close that follows it, never evidence the close happened), so the racer is **ledger-aware** — `boot.begin` answers with the parked boot ledger's desired open-editor set, and the quiet reveal (plus the expired 4s poll budget) additionally requires the sampled strip to match it as a basename multiset (the tab DOM exposes no full paths); a matched receipt still reveals unconditionally, an absent ledger (first-ever boot / older host half) gates on quiet alone, and a strip the ledger mismatches keeps the frame hidden until the reconcile's close lands or the watcher's own 8s ceiling fires. Revealing early has a second hazard the handshake alone cannot see: a file the user opens in the reveal-vs-reconcile window postdates the ledger the reconcile diffs against and would be closed as a ghost — so the first user gesture inside the revealed frame stamps `interact.json` (nonce-scoped, route `boot.interact`), and both the reconcile's close loop and the ghost passes stand down for a boot whose user is already interacting (the receipt reports the deferrals; a stale stamp never disarms a later boot). Fail-soft everywhere: on an older host half (boot routes not reloaded yet) the DOM-quiet watcher alone decides, and a cross-origin direct iframe boots ungated with stock behavior.
- **Cross-tab boot lock** — two same-origin DSH pages booting the workbench concurrently race to *create* VS Code's IndexedDB storage (`vscode-web-db`), and one of them can then hang for minutes inside its own boot (measured: a 294s database open; two fresh profiles stalled until the *other* tab closed). Before a frame may mount, the tab therefore holds the Web Lock `dsh-sidebar-vscode:workbench-boot` and releases it once the workbench has painted (the race is over by then); a contended wait past half a second is named in the loading overlay. Fail-open by design: no Web Locks API, a wedged holder (60s wait cap), or an unreadable frame (30s hold cap) all proceed rather than block.
- **Ledger ownership fence + boot rotation (extension ≥ 0.1.3)** — serve-web also keeps extension hosts alive for a while after their renderer went away, and such a lingering host keeps its armed ledger handlers: it writes **its own (invisible) window's** tab set into the shared `editors.json`, and the reconcile's reopen loop re-opens ledger files into that window, whose tab events then re-write the ledger again — poisoning it with files the visible workbench never showed, which every later boot faithfully restores (closed files coming "back"). The ledger is now *owned by the boot*: every ledger write, the reconcile itself, and the ghost passes re-check that the parked boot nonce is still the one the host activated with. The client rotates that nonce whenever the frame **reloads in place** (the pane DOM is detached on a panel collapse or a workspace switch and re-inserted later, which the browser treats as a reload — a fresh renderer whose host would otherwise activate against the previous boot's nonce) and as the tab unmounts, retiring every host that still holds the old nonce.
- **Late-ghost passes (extension ≥ 0.1.3)** — VS Code's own restore can still be landing tabs *after* the reconcile's settle budget ran out (a slow first boot of a heavy workspace), and those late arrivals are exactly the closed-file ghosts nobody else will close. A few close-only diff passes run after the arming, spaced across the restore tail: each closes **background** tabs the boot ledger does not list, sparing dirty tabs and the ACTIVE editor (seconds after a remount the only deliberate opens are user ones, and a user open becomes the active editor). No pass ever opens anything.

## Usage

### Opening the tab

Expand the right sidebar and pick the **VSCode 工作台 / VSCode workbench** entry box on the guide ("开始") page — it opens in the guide tab's place. The layout is in-memory: a page refresh folds every session back to its collapsed default. The toolbar shows the workspace path;「⧉ open in new window」pops a standalone one.

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

Settings live in the official plugin-config card — **设置 → 插件 → 插件配置 → VSCode 侧边栏** (Settings → Plugins → Plugin Config → VSCode Sidebar): the Host half registers the `vscode-sidebar` settings namespace (`ctx.settings.installSection`), the browser half registers the `settings.plugin.item` card keyed by it, and every row commits through `ctx.settingsScope` (`set`/`unset`; the card header's "Reset to defaults" clears the user layer so each field re-inherits the composition base). **Not** in cordis.patch.yml (`pathMap` below is served by the same namespace but deliberately has no card row):

| Key | Default | Description |
|---|---|---|
| `openAsDefault` | `false` | Gates the three file-open takeovers (chat file clicks, the settings「打开配置文件」button, and the right-sidebar expand button). Off restores the official stock behavior everywhere |
| `openBlocklist` | (unset = `pdf, docx, xlsx, pptx, png, jpeg, jpg`) | "File types never opened in VS Code": an array of extensions rendered as a tag editor (tags carry a × remove button; a free-form input adds entries on Enter/comma, with a dropdown suggesting common binary types). A chat click on a matching file is NOT taken over — it falls through to the stock routing, where the official sidebar's viewers claim it (the builtin text preview today; future viewer plugins register their own official tab types). **Unset = the seven defaults; an emptied list stores `[]`, letting VS Code open everything** (distinct meanings). Matching is case-insensitive, by "base name ends with `.<ext>`" (`a.notpdf` does not match `pdf`; entries may contain inner dots, e.g. `tar.gz`; extension-less files never match); settings are read per click, so edits apply immediately. The settings「打开配置文件」takeover is deliberately **not** affected |
| `serverUrl` | (empty = `http://127.0.0.1:8000`) | The full address `code serve-web` prints (base path and `?tkn=` token included); empty = the default `http://127.0.0.1:8000` (a bare local server). Whenever the proxy is reachable the workbench opens at the same-origin `/sidebar/vscode/`; a host-unreachable full URL falls back to a direct connection (same-origin bridge degrades); an explicit relative subpath (e.g. `/vscode`) is used with gateway semantics when the proxy is off |
| `pathMap` | (empty = no mapping) | Document-only — no card row (rare, split-container deployments). DSH prefix → VS Code container prefix as `src=dst` pairs joined by `;`; longest source prefix wins; a path already under a destination passes through unchanged. When empty, **no mapping is applied at all** — the session cwd and clicked files open at their raw absolute paths (the same-container default). Rules are prefix rewriters, **not a whitelist**: absolute paths no rule matches pass through as-is (VS Code itself reports a genuinely missing file) |
| `maxLines` | `200` (range 1–2000) | Max rendered code lines per reference; overflow keeps head+tail halves and marks the omitted middle inline |
| `maxBytes` | `20000` (range 1000–200000) | UTF-8 byte cap per reference (guards minified single-line files) |

(Selection injection itself is always on — no switch.) Number rows enforce their range as you type (red field + inline hint; out-of-range edits snap to the nearest bound on commit); text rows stack description-over-input; the `openBlocklist` row is tags + an inline input (junk flags a red hint, duplicate adds are silent no-ops). A read-only scope (memory-mode remote browser) disables every control and shows the effective values.
### Troubleshooting

| Symptom | Fix |
|---|---|
| The tab stays blank / the loading hint never clears | Check `serverUrl` reachability; diagnose via "open in new window"; with a cross-origin URL the bridge is off by design (paste fallback still works). On the built-in proxy, confirm serve-web answers at the configured upstream (default `http://127.0.0.1:8000`; any base path works) |
| A file matching `openBlocklist` opens in the stock viewer instead of VS Code | A blocklist hit falls through to the official routing — the builtin text preview (or a future viewer plugin's type) claims it, never the Host OS opener. Remove the extension from the list if you want VS Code to open that type |
| "Workspace path is not absolute…" notice | Fires only when the session cwd is not an absolute path (the workbench then opened its default view); healthy deployments never trigger it — no mapping needed |
| No DSH command in the context menu / palette | Extension not installed, serve-web not restarted (the manifest is scanned at startup only), or the workspace is untrusted (restricted mode) — see the FAQ in `scripts/install-extension.md` |
| No chip after sending; a code snippet appears on the clipboard | Landing failed and the readable fallback reached the clipboard (no composer / cross-origin); paste it into the composer to recover chips |
| "Injected as a text reference…" notice | The composer was mid-submit so the chip degraded to a plain-text mention — submitting works the same |
| Caret vanishes from the composer ~1s after creating a session, or focus jumps into the sidebar's open file after switching back from another workspace's session (older-version symptoms) | The booted workbench focuses itself (Getting Started page on render, a restored editor on workspace restore): a boot behind a **collapsed** panel stole the caret invisibly, and the re-insertion reload a workspace switch-back triggers landed focus in the restored file right after the composer was autofocused. Current versions guard it generically — the first load is deferred until the tab has been seen, and every boot of the frame gets a focus fence that bounces uninvited grabs back unless the user actually clicks into the workbench (see "Focus guards" below); the first workbench load on expansion arrives slightly later by design |

## Architecture

### The two halves

A DSH plugin has a host (node) half and a browser half; this plugin's split:

```
┌─ shared protocol plane ────────────────────────────────────────┐
│ src/shared/protocol.ts  every constant that crosses a process   │
│                         boundary, single-sourced once — the      │
│                         extension's CJS mirror is lockstep-      │
│                         pinned by tests/protocolLockstep.spec   │
└────────────────────────────────────────────────────────────────┘
┌─ host half (node) ─────────────────────────────────────────────┐
│ src/index.ts    agent/created → mount agent/pre-step per agent │
│ src/mention.ts  the boundary core: parse/rewrite, dedup,       │
│                 freshness, context injection                   │
└────────────────────────────────────────────────────────────────┘
┌─ browser half (web) ───────────────────────────────────────────┐
│ src/client/index.tsx        register tab + dock + @ source     │
│ src/client/VscodeView.tsx   the view: wires the controllers     │
│ src/client/*Controller.ts   boot gate / focus fence / base /    │
│                             open requests / opener (unit-tested)│
│ src/client/references.ts    payload→chips, insert, rail, paste │
│ src/client/composer.tsx     the dock: reference rail + pastes  │
│ … (full listing under Repository layout below)                 │
└────────────────────────────────────────────────────────────────┘
```

- The **host half** owns the model-facing seam: per live agent it listens at `agent/pre-step`, parses canonical mentions in the claimed user messages (markdown and bare URIs, both schemes, strict canonical validation), rewrites them to readable labels (`freezeMessage` keeps message ids), dedupes by reference identity, and injects each context (`createUserMessage`) right after the first message citing it. The filesystem is consulted only for freshness marks — snapshot content rides inside the mention, so injection never depends on disk state;
- The **browser half** owns all UI: the official `vscode` tab type + body, chips, the rail, the settings card, the takeovers, dictionaries; without the official right-Sidebar services the client fiber parks and nothing registers.

### The four-stage chain

Both reference kinds share one chain:

1. **VS Code extension** (`extension/`): the selection command packs `{ path, relative?, language?, dirty?, spans[] }`; the resource commands `workspace.fs.stat` each URI and pack `{ kind: 'resource', resources: [{ path, relative?, type }] }` (no content), handed to `vscode.env.clipboard.writeText` inside the envelope `@@DSH_REF::<base64url(json)>::\n<readable fallback>`;
2. **Clipboard signal bridge** (`src/client/clipboardBridge.ts`): same-origin iframe privilege — the parent page patches `navigator.clipboard.writeText` on the workbench window, intercepting the extension host's clipboard chain (ext host → MainThreadClipboard → BrowserClipboardService → the late-bound `navigator.clipboard.writeText`); a successful landing never touches the real clipboard, a failed one writes the readable fallback for manual paste; on cross-origin URLs the bridge no-ops;
3. **Composer chips** (`src/client/references.ts` + `composer.tsx`): the payload is reverse-mapped through `pathMap` back into DSH space (relativized under cwd), truncated (head+tail halves), hashed via `crypto.subtle` into the sha-256 prefix, and formatted as the canonical mention, then landed as an atomic occurrence chip through the `conversation.input` service's `insertReference` — at the composer's **current caret**: the addressed session's live editor selection via the input resolver's keyboard face (`caretSpan()` — the Lexical-era composer's own projection), falling back to the displayed composer's DOM selection mapped through the detect projection (`composerDom.ts` — chips count as one atomic char), whenever the surface belongs to the addressed session (a selected range is replaced, a batch splices in order); when no caret is addressable (session mismatch, no live composer) the landing keeps the historical end-of-draft zero-width span CAS. Spans are detect-projection offsets on Lexical hosts (DSH ≥ 0.1.2-alpha.2, where the draft is the clipboard projection and each chip expands to its full `clipboardText` there but to a single `￼` in span coordinates) and draft offsets on the older textarea-era machine — one structural probe (`editor` on the input facade) picks the plane; the plain-text degradation rides the scoped `'slash/input-insert-text'` event so every other chip in the draft survives the landing; this plugin registers the `@` trigger source `vscode-reference` (candidates always empty — it exists purely so submit serialization routes through its codec); the `conversation.input.dock` component renders the rail (its close button removes one reference's chips through the scoped `'slash/input-consume-token'` event — chip-preserving on Lexical hosts, where a whole-draft `setDraft` write would flatten every remaining chip to raw mention text) and intercepts pastes at the document capture phase, addressing both the contenteditable composer and the old textarea (envelopes go to the injection lander at the paste caret; recovered mention copies land as chips — `preventDefault` alone does not stop the composer's own paste handling, so `stopPropagation` rides along);
4. **Host boundary** (`src/mention.ts`): after the strict parse, one fail-soft recovery scan catches whitespace-mangled copies; closing-tag collisions are salted with the content hash so the body cannot forge a terminator.

### The mention codec

- Canonical form: `@[<escaped label>](dsh-vscode:<base64url(json)>)` (selections) / `dsh-vscode-res:` (resources); the payload is self-contained (path / lines / snapshot / hash / flags), so the draft text is the single store; the two scheme prefixes are mutually exclusive — neither can over-match the other;
- Decoding must re-encode to the identical URI (the canonical discipline shared with `dsh-session:` references): an explicit markdown mention with a malformed URI fails loudly; bare text counts as a reference only when a base64url shape follows the scheme, and it must still pass canonical validation;
- The recovery layer (`scanRecoveredMentions`) recognizes whitespace-drifted copies and truncations that lost the closing paren; projections are rebuilt only from payloads that fully validate — a copied label is never trusted (it is display residue);
- The shared pure module `src/mentionCodec.ts` has no Node builtins and no `@deepseek-ai/*` value imports, so both the host and browser bundles reuse it verbatim (it passes the client purity gate).

### Truncation & freshness

- At capture (`truncateSnapshot`): LF-normalize → line cap (whole head/tail half-lines) → byte cap (head shrunk from its end, tail from its start, multi-byte safe); the payload records `headLen` / `omitLines` / `omitBytes` and the host renders the inline omission marker, which the counters exclude;
- At submit (`freshnessOf`): the disk range is re-read confined to the session cwd (escapes / files over 8 MiB / read failures all yield `unknown`), hash-compared into `fresh` / `stale`; a truncated snapshot verifies that the disk range starts with the kept head, ends with the kept tail, and holds at least one char between them (edits inside the omitted middle are undetectable; truncation alone never marks stale).

### The open navigation (the one-shot open command)

The official sidebar delivers an open to a tab's body as `tab.navigation` — `{ address, params, revision }`, the revision incrementing on every navigation — which IS the one-shot command vehicle the better-sidebar era had to build by hand (`openRequest` meta + wall-clock nonces + persisted-meta hygiene). `src/client/openRequests.ts` keeps only the discipline that still matters: revision 0 (a seeded guide, an undo-restored record) is nobody's click; a PAGE-LEVEL watermark (`${sessionId}:${tabId}` → the highest executed revision) lets a remount skip the navigation it already executed while the mount-batch click still runs; and while the frame's boot gate is unsettled a fresh navigation defers (its open command must carry the boot nonce). The navigation consumer mints the extension command nonce at execution time and hands the open to the two-channel opener (`workbenchLink.ts`).
#### Focus guards (the workbench must earn focus)

When the VS Code workbench boots it programmatically focuses its own content — the Getting Started page calls `focus()` on itself when it renders, and a restored workspace focuses the editor it restored — roughly 0.5–4s after the iframe loads, with zero user interaction. Whenever that boot lands at a moment the user did not aim at the workbench, the grab rips the caret out from under them: a new conversation's default tab behind a collapsed panel loses the caret invisibly (two blinks), and switching back to a session in another workspace re-boots the workbench (the pane survives at the React level, but its iframe is torn out of the document on the way out and re-inserted on the way back, which the browser reloads) and lands focus in the restored file right after the composer was autofocused. `src/client/VscodeView.tsx` guards with two mechanisms:

- **Deferred first load**: the iframe is held back until this tab has been **visible at least once** (the official docked-body visibility: active tab AND expanded panel; a float is always visible). A takeover open landing this tab while the panel is collapsed waits for its audience — a hidden boot buys nothing the user can see and only invites the grab; deferring it moves any boot-time focus event to the first real reveal, where the user is looking AT the workbench. Note the official pane renders only the active tab's body, so switching to a sibling tab unmounts the frame and switching back re-boots it through this same guarded path (a floated panel stays mounted).
- **Focus fence** (`src/client/focusGuard.ts`): a focus entry into the frame is handed straight back to the element that last held focus outside it — budgeted per sliding window (default 5 restores per 10s) so a re-grabbing workbench cannot livelock the focus chain — in exactly two armed situations:
  - **Hidden** (`visible === false`, explicit only): the frame cannot receive user clicks, so every entry is a steal. A collapsed panel or a non-current tab cannot legitimize a grab.
  - **Boot**: for a window (default 6s) after EVERY load of the frame, because every load is a workbench boot and every boot self-focuses — page reloads and the workspace switch-back re-insertion included. Entries bounce UNLESS the user gestured inside the frame (same-origin `pointerdown`/`keydown` trackers, re-attached on every load — clicking into a freshly booted workbench works immediately) or a parent Tab keypress handed focus over. The one sanctioned boot is the deferred first load above: the user revealed the tab to release it, so its focus grab is welcome. A cross-origin frame (the direct-iframe fallback) cannot report in-frame gestures, so the boot fence stands down rather than bounce real clicks.
  - Detection rides `focusout`, not `focusin` (a crossing INTO the iframe fires focusout in the parent but never focusin — the focusin lands inside the frame's own document).

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

Deployments without a gateway tier (Windows, a bare LAN `dsh web`) need no self-managed nginx
either: the plugin's host half registers the equivalent reverse proxy on the port `dsh web` itself
listens on (`src/vscodeProxy.ts`, mounted at `/sidebar/vscode`). HTTP prefix routes forward
transparently and keep the browser's `Host` (serve-web bakes `remoteAuthority` pointing at the DSH
port, so every workbench URL stays same-origin); the WebSocket upgrade registers at the exact path
`<upstream-base-path>/<quality>-<commit>` — the only path the browser socket factory ever connects
to (serve-web's `handleUpgrade` ignores the path). The routing base follows the `serverBasePath`
baked in the index HTML, not the probe URL: non-mount bases get an identity mirror at their own
path, root upstreams a discovered `<quality>-<commit>` shim. The index probe follows up to three
redirects and adopts the final origin, so an upstream behind a redirecting reverse proxy (e.g. an
enforced http→https hop) still discovers — and forwards — correctly. The upstream comes from a
full-URL `serverUrl` (pushed via `proxy.config`) or `DSH_SIDEBAR_VSCODE_UPSTREAM` (default
`http://127.0.0.1:8000`, `off` to disable).

The DSH session and the embedded workbench see **the same filesystem under the same paths**, so `pathMap` **defaults to empty = no mapping**: the session cwd and chat-clicked files are handed to the workbench at their raw absolute paths, untouched (the previous default was the identity pair `/data/workspace=/data/workspace;/opt=/opt`, which covered only those two roots and flagged everything else as unmappable). The rules are prefix rewriters, not a whitelist: even with rules configured, unmatched paths pass through unchanged (existence is the open channel's call), and no blocking notice ever appears. Move the workbench to another container/mount and configure real prefix rewrites via `pathMap` (in the settings document — it has no panel row).

### Repository layout

The codebase is layered by domain — a **shared protocol plane** every runtime sources its cross-process constants from, a host half of services, a browser half of controllers + views, and a decomposed extension — so a change to any contract lands in exactly one place:

```
src/shared/protocol.ts         # THE protocol plane: every constant that crosses a process boundary (envelope marker, proxy mount, spool file names, capability versions, TTLs, the workspace slug) — pure, host+client import it verbatim
src/index.ts                   # host-half entry: agent/created → pre-step boundary + fenced /sidebar-vscode/api routes behind one METHOD TABLE + the `vscode-sidebar` settings section (inject: agents, webServer, webRuntime; nested settings)
src/settingsSection.ts         # the `vscode-sidebar` settings section: schema + installSection (5 tests)
src/shared/settings.ts         # the settings model shared by both halves: namespace, types, composition base
src/vscodeProxy.ts             # host half: same-origin /sidebar/vscode reverse proxy (HTTP + WS pipe + path/token rewrite + configure channel + trust fence) (41 tests)
src/mention.ts                 # host-half core: parse/rewrite/dedup/freshness/<text-selection> etc. (38 tests)
src/mentionCodec.ts            # shared pure logic: canonical URI codecs (2 schemes)/truncation/hashing (42 tests)
src/openChannel.ts             # host half: /tmp command-channel spool — all persistence through one SpoolStore (atomic writes, fail-soft reads) (13 tests)
src/trust-fence.ts             # host half: browser-trust fence for this plugin's routes (loopback/trustedHosts + same-origin markers)
src/client/index.tsx           # browser-half entry: a thin composition root (tab + dock + @ source + takeovers) over the modules below
src/client/VscodeView.tsx      # the tab VIEW: wires the five lifecycle controllers together and renders (toolbar/notices/surface)
src/client/bootGate.ts         # BootGateController: nonce park → receipt × DOM-quiet reveal race → in-place-reload rotation; + the DOM-quiet watcher (13+5 tests)
src/client/bootLock.ts         # WorkbenchBootLock: cross-tab Web Lock serializing first paints (the vscode-web-db creation race) + acquireWebLock (11 tests)
src/client/focusFence.ts       # FocusFenceController: per-load gesture trackers + document listeners around focusGuard's pure rules
src/client/focusGuard.ts       # the pure fence decision + sliding-window restore budget (7 tests)
src/client/workbenchBase.ts    # WorkbenchBaseController + useWorkbenchBase: mount-vs-direct resolution, upstream push/reset, graduation poll (6 tests)
src/client/openRequests.ts     # OpenRequestConsumer: one-shot navigation discipline — revision-0 standdown, page watermark, gate deferral (10 tests)
src/client/workbenchLink.ts    # createWorkbenchOpener: extension spool first (boot-tagged from cap v4), URL-payload reload degraded (8 tests)
src/client/clipboardBridge.ts  # same-origin iframe navigator.clipboard.writeText signal patch (10 tests; no-ops on the cross-origin SecurityError throw)
src/client/composer.tsx        # dock component: reference rail + paste fallbacks (styles via styles.ts)
src/client/composerDom.ts      # detect-projection walk over the Lexical composer DOM (DOM selection ⇄ detect offsets) (11 tests)
src/client/references.ts       # payload→chips (selection/resources)/insert at the caret/rail projection/paste recovery (69 tests)
src/client/referencePipeline.ts # the lander/options handle table the plugin body, the tab, and the dock share
src/client/selection.ts        # clipboard envelope codecs (selection + resource payloads) (16 tests)
src/client/paths.ts            # pathMap parse/map/reverse-map, URL building (34 tests)
src/client/settings.ts         # `vscode-sidebar` settings reads (scope snapshot + base fallback) + capture-cap contract (defaults/bounds/commit) (18 tests)
src/client/settingsCard.tsx    # the official plugin-config card (settings.plugin.item): card shell + reset-to-defaults + switch row + blocklist tag row + text rows + cap rows (styles via styles.ts)
src/client/settingsTakeover.ts # settings「打开配置文件」takeover: one shared decision core behind both era wrappers + dialog close (17 tests)
src/client/openIntercept.ts    # the official openResource takeover: the local file-address parser + wrapSidebarRightOpenResource (gate / blocklist fall-through / params translation) (22 tests)
src/client/takeovers.ts        # the takeover family's installation: one gate wired to two seams (the openResource funnel + both settings funnels)
src/client/openBlocklist.ts    # "never open in VS Code" extension list: defaults / normalization / base-name suffix matching (24 tests)
src/client/openChannelApi.ts   # client half of the open channel: fenced /sidebar-vscode/api probes and commands (11 tests)
src/client/definition.ts       # the official tab type definition: kind/id/params faces + the guide-page entry box
src/client/styles.ts           # the stylesheet registry: every injected CSS block + one idempotent adopter
src/client/i18n.ts             # locale service wiring + t()
src/client/locales.ts          # zh/en dictionaries
src/client/icons.tsx           # VS Code mark + chip file/folder/close icons (currentColor SVG)
extension/                     # the VS Code extension dsh.selection-reference, decomposed along the same seams:
  ├ extension.js               #   the ~90-line activation root (commands → ledger read → reconcile → arm → poll → ghost passes)
  ├ lib/protocol.js            #   the shared protocol plane's CJS mirror — lockstep-pinned against src/shared/protocol.ts by tests/protocolLockstep.spec.ts
  ├ lib/fsutil.js              #   atomic marker write + spool directory
  ├ lib/envelope.js            #   the three send commands + the clipboard envelope they ride
  ├ lib/channel.js             #   the spool poll: capability marker + one-shot command consumption (TTL/nonce/boot-tag guards)
  ├ lib/boot.js                #   the editor ledger + boot reconcile + late-ghost passes + the nonce fence that owns them
  ├ harness.js / package.json / package.nls*.json / .vscodeignore / vsix/*.vsix
scripts/install-extension.sh   # one-command extension install (vsce package → files → manifest → restart → health)
scripts/install-extension.md   # step-by-step install doc + troubleshooting (Chinese)
README.md / README.zh-CN.md    # this doc (English) / the Chinese doc
screenshot.png                 # product usage screenshot (see [Screenshot](#screenshot))
tests/*.spec.ts                # vitest specs — 511 tests / 24 files (per-module counts noted above)
cordis.patch.yml               # the bundle channel's host-half insert row (mount declaration)
tsdown.config.ts               # dual-bundle build (host ESM + client ModuleLoader format + purity gate)
vitest.config.ts               # test-time dsh-llm alias (harness checkout preferred, installed package fallback)
lib/                           # build outputs (committed: the link: deployment serves lib/client.js directly)
.github/workflows/ci.yml       # CI: typecheck / test / build / package verification on Node 22 & 24
```

Build outputs: the host half is a plain ESM bundle (`@deepseek-ai/dsh-llm` stays external, resolved by the DSH host loader); the browser half is a `window.__ModuleLoader__.load({ id, factory })` registration bundle (the official external client-plugin delivery format) with React / cordis external and a **purity gate** that rejects Node builtins and `@deepseek-ai/*` value imports.

## Development

### Build & test

```sh
git clone https://github.com/chendefine/dsh-sidebar-vscode && cd dsh-sidebar-vscode
pnpm build        # tsc declarations + tsdown dual bundle → lib/
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run (511 tests)
```

Rebuild, then hard-refresh the browser (the link: dependency plus content-rev query params bust caches); host-half changes need a `dsh web` restart.

### Environment notes

- **pnpm ≥ 11**: pnpm-specific settings are read **only** from `pnpm-workspace.yaml` (same-named `.npmrc` keys are silently ignored). This repo pins `autoInstallPeers: false` (internal `@deepseek-ai/*` packages are not on the public registry) and `verifyDepsBeforeRun: false` (node_modules + lockfile are a frozen baseline; skip the pre-run check) there, (this plugin carries no native-build dependencies);
- **Type & runtime mapping**: the `@deepseek-ai/*` build-time packages (`dsh-llm`, `dsh-agent`, and `dsh-llm`'s runtime peers) are devDependencies resolved from the npm registry, so plain clones and CI work out of the box; tsconfig `paths` and the vitest alias prefer a sibling harness checkout (`/app/dsh`) when one exists — its built artifacts are fresher than the published rc's — and fall back to the installed packages otherwise;
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs typecheck / test / build / package-content verification on Node 22 and 24 — the matrix mirrors DSH's own support range (`^22.19.0 || >=24.0.0`, which the published `engines` field matches);
- **devDependencies baseline**: the `@deepseek-ai/*` devDependencies (plus `@deepseek-ai/schemastery` for the host-side settings schema) exist for types, tests, and dev-time alignment only — at runtime they are all optional peers resolved by the DSH host;
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

- In the direct-connection fallback (host cannot proxy) the same-origin clipboard bridge is unavailable (browser same-origin policy) — only the paste fallback remains; when it is merely boot timing (serve-web becoming ready after `dsh web`), the client polls `proxy.status`'s `serving` every 5s and switches back to the mount automatically — no manual refresh needed;
- The built-in proxy targets a single upstream (the last-pushed `serverUrl` wins — multiple sessions pushing different addresses share one globally); upstreams must be directly reachable over http(s) (self-signed TLS needs system trust; embedded credentials in the URL are unsupported); the proxy does no auth stripping — tokens are appended as-is. The mount inherits the dsh web port's exposure: every client that can reach the port may use the proxied workbench (the `?tkn=` token gates the upstream, not the mount — the proxy appends it transparently), so keep the port behind the same trust boundary as the GUI itself (loopback / trusted gateway);
- Selection injection is always on; there is no switch;
- Host-half changes take effect only after a `dsh web` restart;
- tsdown emits deprecation warnings for `external` / `noExternal` (output is correct; migration to `deps.*` is future work).

## License

MIT (see [LICENSE](LICENSE)).
