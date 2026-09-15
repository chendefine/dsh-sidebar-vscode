window.__ModuleLoader__.load({
	id: "dsh-sidebar-vscode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/settings.ts
		/**
		* The `vscode-sidebar` settings model, shared by both plugin halves.
		*
		* The settings live in the OFFICIAL user-settings document under one
		* namespace (`vscode-sidebar`), not in any sidebar plugin's private blob:
		* the Host half registers the section (`src/settingsSection.ts`) so the
		* settings serve it, and the「设置 → 插件 → 插件配置」tab pairs that
		* namespace with this plugin's browser-registered card
		* (`settings.plugin.item`, keyed by the same string).
		*
		* This module is the ONE source of truth both halves compile against —
		* the Host half's schema defaults and the browser half's
		* settings-not-ready-yet fallbacks must never disagree:
		*
		* - `openAsDefault` gates the three file-open takeovers (chat-originated
		*   opens through `ctx.sidebarRight.openResource`, the collapsed column's
		*   expand button, and the settings page's「打开配置文件」button). The
		*   better-sidebar-era meaning — swapping a fresh session's seeded Files
		*   tab — is gone with that system (the official sidebar seeds the guide
		*   page and keeps layout in memory only); the switch keeps its takeover
		*   roles.
		* - `openBlocklist` carries the unset-versus-empty rule through the
		*   settings document's own layering: the composition base IS the
		*   default list, an explicit `[]` is the stored decision "block
		*   nothing".
		*
		* @module dsh-sidebar-vscode/shared/settings
		*/
		/** The settings namespace this plugin owns (lowercase, per the Host pattern). */
		const VSCODE_SIDEBAR_SETTINGS_NAMESPACE = "vscode-sidebar";
		/** The out-of-the-box blocklist: common binary/Office/image types. */
		const DEFAULT_OPEN_BLOCKLIST = [
			"pdf",
			"docx",
			"xlsx",
			"pptx",
			"png",
			"jpeg",
			"jpg"
		];
		const MAX_LINES_MAX = 2e3;
		/** Default / bounds of the `maxBytes` cap (rendered reference UTF-8 bytes). */
		const MAX_BYTES_DEFAULT = 2e4;
		const MAX_BYTES_MIN = 1e3;
		const MAX_BYTES_MAX = 2e5;
		/**
		* The composition base: what every unset field resolves to. The Host half
		* registers this as the section's `base` layer, and the browser half uses
		* it verbatim whenever the settings scope has not answered yet (or this
		* deployment serves no settings provider at all).
		*/
		const VSCODE_SIDEBAR_SETTINGS_BASE = Object.freeze({
			openAsDefault: false,
			openBlocklist: [...DEFAULT_OPEN_BLOCKLIST],
			serverUrl: "",
			pathMap: "",
			maxLines: 200,
			maxBytes: MAX_BYTES_DEFAULT
		});
		//#endregion
		//#region src/client/settings.ts
		/**
		* The `vscode-sidebar` settings read side: one typed window over the
		* official settings scope, plus the numeric capture-cap contract the
		* settings card and the reference pipeline share.
		*
		* The settings live in the Host-served user-settings document (namespace
		* `vscode-sidebar`; the Host half registers it — `src/settingsSection.ts`)
		* and reach the browser through `ctx.settingsScope.bind`. The card
		* (`settingsCard.tsx`) edits them there; the tab body and the takeover
		* gates read them per render / per call, so edits apply to the very next
		* interaction with no re-wiring.
		*
		* Fail-soft by construction: a scope that has not answered yet (or a
		* deployment serving no settings provider) reads as the composition base
		* — the same values the Host would resolve for an all-unset section — so
		* every consumer keeps working with the code defaults.
		*
		* Also owns the numeric capture-cap contract (`maxLines` / `maxBytes`):
		* the defaults and bounds live in `src/shared/settings.ts` (one source
		* shared with the Host schema), and the pure display/commit helpers here
		* serve the card and the read side alike.
		*
		* @module dsh-sidebar-vscode/client/settings
		*/
		/** The cap rows, in card order. */
		const CAP_SPECS = [{
			key: "maxLines",
			def: 200,
			min: 1,
			max: MAX_LINES_MAX
		}, {
			key: "maxBytes",
			def: MAX_BYTES_DEFAULT,
			min: MAX_BYTES_MIN,
			max: MAX_BYTES_MAX
		}];
		/** Clamp one candidate cap onto the integer lattice inside [min, max]. */
		function clampCap(value, min, max) {
			return Math.min(max, Math.max(min, Math.round(value)));
		}
		/**
		* The value a cap field displays at rest: the stored number when one is
		* set (displayed as-is, so a stale out-of-range store shows up as invalid
		* instead of masquerading as a bound value), otherwise the code default —
		* an unset field is pre-filled with the default, never left empty.
		*/
		function displayCap(raw, def) {
			return typeof raw === "number" && Number.isFinite(raw) ? raw : def;
		}
		/**
		* Resolve one cap commit from the field's raw text against the value the
		* row currently shows. Returns the number to persist (already clamped to
		* the declared bounds — an out-of-range edit snaps to the nearest bound,
		* visibly, at commit time), or null when nothing must be written: empty
		* or unparsable input reverts to the displayed value, and an edit that
		* lands on that same value is a no-op (merely focusing and blurring an
		* untouched field never writes anything).
		*/
		function commitCap(raw, effective, min, max) {
			if (raw.trim() === "") return null;
			const parsed = Number(raw);
			if (!Number.isFinite(parsed)) return null;
			const clamped = clampCap(parsed, min, max);
			return clamped === effective ? null : clamped;
		}
		/**
		* The effective settings: the scope's accepted section once ready, else
		* the composition base (the code defaults — a not-yet-answered or absent
		* provider must degrade, never break).
		*/
		function readSettings(scope) {
			const value = scope?.getSnapshot().value;
			if (value === void 0 || typeof value !== "object") return VSCODE_SIDEBAR_SETTINGS_BASE;
			return value;
		}
		/**
		* Whether the file-open takeovers may act right now: the
		* `openAsDefault` switch resolved from the live scope.
		*/
		function takeoverSwitchOn(scope) {
			return readSettings(scope).openAsDefault === true;
		}
		/**
		* The capture caps as the reference pipeline consumes them: the resolved
		* numeric fields, defensively re-defaulted (a wire section that slipped a
		* non-number past the schema still reads as the code default, never NaN).
		*/
		function readSettingCaps(values) {
			return {
				maxLines: typeof values.maxLines === "number" && Number.isFinite(values.maxLines) && values.maxLines > 0 ? Math.floor(values.maxLines) : 200,
				maxBytes: typeof values.maxBytes === "number" && Number.isFinite(values.maxBytes) && values.maxBytes > 0 ? Math.floor(values.maxBytes) : MAX_BYTES_DEFAULT
			};
		}
		/**
		* One field's user-override state (the card's reset affordance): `true`
		* while the raw user layer carries the field, `false` while it reverts to
		* the composition base.
		*/
		function readUserLayer(scope) {
			const raw = (scope?.getSnapshot())?.user;
			if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
			return raw;
		}
		/** The subscribe/read pair `useSyncExternalStore` needs over one scope. */
		function subscribeOf(scope) {
			return (listener) => scope.subscribe(listener);
		}
		/** The loading-scope snapshot stand-in (base fallback, not writable). */
		const LOADING_SNAPSHOT = {
			status: "loading",
			value: void 0,
			writable: false
		};
		/**
		* React binding over one settings scope's RAW snapshot: re-renders on
		* every snapshot replacement. A scope that is absent (tests, a runtime
		* without the settings service) reads as eternally loading.
		* @param scope - the bound settings scope (stable identity assumed).
		* @returns the scope's current snapshot.
		*/
		function useSettingsSnapshot(scope) {
			return (0, react.useSyncExternalStore)(scope === void 0 ? () => () => {} : subscribeOf(scope), () => scope?.getSnapshot() ?? LOADING_SNAPSHOT, () => scope?.getSnapshot() ?? LOADING_SNAPSHOT);
		}
		/**
		* React binding over one settings scope's VALUES: the accepted section
		* once ready, else the composition base (the code defaults — a
		* not-yet-answered or absent provider must degrade, never break).
		* @param scope - the bound settings scope (stable identity assumed).
		* @returns the effective settings for the current snapshot.
		*/
		function useSettings(scope) {
			return useSettingsSnapshot(scope).value ?? VSCODE_SIDEBAR_SETTINGS_BASE;
		}
		/**
		* The subpath the host half's reverse proxy owns on the DSH web port —
		* the browser-facing mount every same-origin workbench URL flows through
		* (host: `src/vscodeProxy.ts`; client: `src/client/paths.ts`).
		*/
		const PROXY_MOUNT = "/sidebar/vscode";
		//#endregion
		//#region src/client/paths.ts
		/**
		* The default `serverUrl`: the full address of a locally started
		* `code serve-web` without a token or base path (the CLI's own defaults).
		* An unset setting means exactly this URL — pushed to the host's built-in
		* proxy as the upstream, with the direct cross-origin iframe as fallback.
		*/
		const DEFAULT_SERVER_URL = "http://127.0.0.1:8000";
		/** Whether a raw `serverUrl` value is a full URL (vs a same-origin subpath). */
		function isFullServerUrl(raw) {
			return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test((raw ?? "").trim());
		}
		/** Normalize one directory prefix: trim, ensure a single leading '/', drop trailing '/'. */
		function normalizePrefix(raw) {
			let value = raw.trim();
			if (value === "") return "";
			value = value.replace(/\/+/g, "/").replace(/^\/?/, "/");
			while (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
			return value;
		}
		/**
		* Parse the user-facing `pathMap` setting (`src=dst;src2=dst2`). Empty,
		* unset, or fully-malformed input yields NO rules — pass-through mode (the
		* raw paths reach the workbench unchanged). Malformed single entries are
		* skipped (the rest still apply). Rules are returned longest-source-prefix
		* first (stable among equals) so the most specific rule wins in
		* {@link mapPath}.
		*/
		function parsePathMap(spec) {
			const text = spec === void 0 ? "" : spec.trim();
			const rules = [];
			for (const part of text.split(";")) {
				const entry = part.trim();
				if (entry === "") continue;
				const eq = entry.indexOf("=");
				if (eq <= 0) continue;
				const from = normalizePrefix(entry.slice(0, eq));
				const to = normalizePrefix(entry.slice(eq + 1));
				if (from === "" || to === "") continue;
				rules.push({
					from,
					to
				});
			}
			return [...rules].sort((a, b) => b.from.length - a.from.length);
		}
		/** Whether `path` is `prefix` itself or a path segment under it. */
		function under(path, prefix) {
			if (prefix === "/") return path.startsWith("/");
			return path === prefix || path.startsWith(`${prefix}/`);
		}
		/**
		* Join a rule-side prefix with the mapped remainder. The suffix keeps its
		* leading '/', so a ROOT prefix contributes nothing — naive concatenation
		* (`'/' + '/x'`) would yield a double-slash path VS Code cannot open and
		* the open-channel slug cannot address. An empty or root-only suffix
		* (the mapped path IS the prefix itself) collapses to the other side's
		* prefix, or '/' when both are root — never to ''.
		*/
		function joinPrefix(prefix, suffix) {
			const base = prefix === "/" ? "" : prefix;
			if (suffix === "" || suffix === "/") return base === "" ? "/" : base;
			return base + suffix;
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
		function mapPath(path, rules) {
			const clean = path.trim();
			if (clean === "" || !clean.startsWith("/")) return null;
			for (const rule of rules) {
				if (!under(clean, rule.from)) continue;
				const suffix = rule.from === "/" ? clean : clean.slice(rule.from.length);
				return joinPrefix(rule.to, suffix);
			}
			for (const rule of rules) if (under(clean, rule.to)) return clean;
			return clean;
		}
		/**
		* Map one DSH-side path for a FILE OPEN: identical to {@link mapPath}.
		*
		* Kept as a named alias so file-open call sites read differently from the
		* workspace-folder call site: both now behave the same (rewrite when a rule
		* matches, pass through unchanged when none does, `null` only for empty or
		* non-absolute input — the open channels all address POSIX absolute paths).
		*/
		function mapPathForOpen(path, rules) {
			return mapPath(path, rules);
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
		function reverseMapPath(path, rules) {
			const clean = path.trim();
			if (clean === "" || !clean.startsWith("/")) return null;
			const byDest = [...rules].sort((a, b) => b.to.length - a.to.length);
			for (const rule of byDest) {
				if (!under(clean, rule.to)) continue;
				const suffix = rule.to === "/" ? clean : clean.slice(rule.to.length);
				return joinPrefix(rule.from, suffix);
			}
			for (const rule of rules) if (under(clean, rule.from)) return clean;
			return clean;
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
		function normalizeBaseUrl(raw) {
			const value = (raw ?? "").trim();
			if (value === "") return DEFAULT_SERVER_URL;
			const stripped = (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith("/") ? value : `/${value}`).replace(/\/+$/, "");
			return stripped === "" ? "" : stripped;
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
		function buildVscodeUrl(base, folder, open) {
			const root = `${base}/`;
			if (open === void 0) return folder === null ? root : `${root}?folder=${encodeURIComponent(folder)}`;
			const suffix = open.line !== void 0 ? `:${open.line}${open.column !== void 0 ? `:${open.column}` : ""}` : "";
			const target = `vscode-remote://${open.authority}${open.file}${suffix}`;
			const payload = JSON.stringify([["gotoLineMode", "true"], ["openFile", target]]);
			return `${root}?${folder !== null ? `folder=${encodeURIComponent(folder)}&` : ""}payload=${encodeURIComponent(payload)}`;
		}
		//#endregion
		//#region src/client/selection.ts
		/** Whether one decoded payload is an explorer resource list (else an editor selection). */
		function isResourceList(payload) {
			return "kind" in payload && payload.kind === "resource";
		}
		/** Whether the value is a well-formed SelectionPayload. */
		function isSelectionPayload(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			if (typeof candidate.path !== "string" || candidate.path === "") return false;
			if (candidate.relative !== void 0 && typeof candidate.relative !== "string") return false;
			if (candidate.language !== void 0 && typeof candidate.language !== "string") return false;
			if (candidate.dirty !== void 0 && typeof candidate.dirty !== "boolean") return false;
			if (!Array.isArray(candidate.spans) || candidate.spans.length === 0) return false;
			return candidate.spans.every((span) => {
				if (typeof span !== "object" || span === null) return false;
				const s = span;
				return typeof s.startLine === "number" && typeof s.endLine === "number" && typeof s.text === "string" && Number.isFinite(s.startLine) && Number.isFinite(s.endLine) && Number.isInteger(s.startLine) && Number.isInteger(s.endLine) && s.startLine >= 1 && s.endLine >= s.startLine;
			});
		}
		/** Whether the value is a well-formed ResourceListPayload. */
		function isResourceListPayload(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			if (candidate.kind !== "resource") return false;
			if (!Array.isArray(candidate.resources) || candidate.resources.length === 0) return false;
			return candidate.resources.every((item) => {
				if (typeof item !== "object" || item === null) return false;
				const r = item;
				return typeof r.path === "string" && r.path !== "" && (r.relative === void 0 || typeof r.relative === "string") && (r.type === "file" || r.type === "folder");
			});
		}
		/** Whether the value is any well-formed envelope payload. */
		function isClipboardPayload(value) {
			if (typeof value === "object" && value !== null && "kind" in value) return isResourceListPayload(value);
			return isSelectionPayload(value);
		}
		/** base64url → UTF-8 string (browser-safe, no Buffer). */
		function decodeBase64Url$1(value) {
			const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
			const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
			const binary = atob(padded);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		}
		/**
		* Parse one clipboard string into a {@link ClipboardPayload}.
		* Returns null for anything that is not our envelope.
		*/
		function parseClipboardEnvelope(text) {
			if (!text.startsWith("@@DSH_REF::")) return null;
			const close = text.indexOf("::", 11);
			if (close < 0) return null;
			const encoded = text.slice(11, close);
			if (encoded === "") return null;
			let parsed;
			try {
				parsed = JSON.parse(decodeBase64Url$1(encoded));
			} catch {
				return null;
			}
			return isClipboardPayload(parsed) ? parsed : null;
		}
		/**
		* The human-readable part of an envelope: everything after the marker line.
		* Falls back to the full string when it is not an envelope.
		*/
		function envelopeReadablePart(text) {
			if (!text.startsWith("@@DSH_REF::")) return text;
			const close = text.indexOf("::", 11);
			if (close < 0) return text;
			return text.slice(close + 2).replace(/^\r?\n/, "");
		}
		//#endregion
		//#region src/client/clipboardBridge.ts
		/**
		* The clipboard signal bridge: turns the embedded VS Code workbench's
		* clipboard writes into a structured channel back into DSH.
		*
		* Why this works: the VSCode tab's iframe loads the VS Code server from the
		* same origin as the DSH page (the plugin's built-in reverse proxy mount
		* `/sidebar/vscode` by default, or a gateway subpath), so this plugin —
		* running in the top window — has full same-origin access to the iframe's
		* window. And the extension-host clipboard chain is
		*
		*   vscode.env.clipboard.writeText(text)        [node ext host, container]
		*     → MainThreadClipboard.$writeText          [renderer, workbench window]
		*     → BrowserClipboardService.writeText
		*     → await navigator.clipboard.writeText(t)  [late-bound property lookup]
		*
		* so replacing `writeText` on the workbench window's
		* `navigator.clipboard` intercepts every extension-originated text write.
		* Writes NOT carrying our envelope marker pass through untouched.
		*
		* When the write IS an envelope (`@@DSH_REF::<base64url>::…`, see
		* selection.ts): the payload is decoded and handed to the callback, whose
		* return value reports whether it reached the composer. On delivery the
		* write is swallowed whole — the user's clipboard keeps whatever it held
		* (sending a selection must not clobber it). Only when delivery fails does
		* the human-readable remainder land on the real clipboard as a
		* manual-paste fallback (best effort — clipboard writes need transient
		* user activation and may reject; nothing depends on it).
		*
		* Cross-origin editor URLs (the `serverUrl` setting pointing at another
		* origin) cannot be bridged — reading `navigator` off a cross-origin
		* window proxy throws SecurityError, which the install call catches and
		* turns into a no-op disposer, leaving the composer-side paste fallback
		* as the only path.
		*
		* @module dsh-sidebar-vscode/client/clipboardBridge
		*/
		/**
		* Patch `navigator.clipboard.writeText` inside the iframe's workbench
		* window so envelope-carrying writes signal this plugin.
		*
		* @param iframe - the VSCode tab's iframe element (already loaded).
		* @param onPayload - receives every decoded payload (selection or resource);
		* a `true` result swallows the write (clipboard preserved), a `false`
		* result / throw / rejection writes the readable fallback instead.
		* @returns the disposer (restores the original method; safe to call twice).
		*/
		function installClipboardBridge(iframe, onPayload) {
			let win = null;
			try {
				win = iframe.contentWindow;
			} catch {
				return () => {};
			}
			let clip;
			try {
				clip = win?.navigator?.clipboard;
			} catch {
				return () => {};
			}
			if (win === null || clip === void 0 || typeof clip.writeText !== "function") return () => {};
			let disposed = false;
			const target = clip;
			const hadOwn = Object.prototype.hasOwnProperty.call(target, "writeText");
			const previous = target.writeText;
			const original = clip.writeText.bind(clip);
			const patched = (text, ...rest) => {
				if (disposed || typeof text !== "string") return original(text, ...rest);
				const payload = parseClipboardEnvelope(text);
				if (payload === null) return original(text, ...rest);
				let delivered = false;
				try {
					delivered = onPayload(payload);
				} catch (error) {
					console.error("[dsh-sidebar-vscode] selection payload handler failed:", error);
				}
				return Promise.resolve(delivered).catch((error) => {
					console.error("[dsh-sidebar-vscode] selection payload handler rejected:", error);
					return false;
				}).then((ok) => {
					if (ok) return;
					const readable = envelopeReadablePart(text);
					if (readable.trim() === "") return;
					return original(readable).then(() => {}, () => {});
				});
			};
			try {
				target.writeText = patched;
			} catch {
				return () => {};
			}
			return () => {
				if (disposed) return;
				disposed = true;
				try {
					if (hadOwn && previous !== void 0) target.writeText = previous;
					else delete target.writeText;
				} catch {}
			};
		}
		//#endregion
		//#region \0@oxc-project+runtime@0.146.0/helpers/esm/typeof.js
		function _typeof(o) {
			"@babel/helpers - typeof";
			return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
				return typeof o;
			} : function(o) {
				return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
			}, _typeof(o);
		}
		//#endregion
		//#region \0@oxc-project+runtime@0.146.0/helpers/esm/toPrimitive.js
		function toPrimitive(t, r) {
			if ("object" != _typeof(t) || !t) return t;
			var e = t[Symbol.toPrimitive];
			if (void 0 !== e) {
				var i = e.call(t, r || "default");
				if ("object" != _typeof(i)) return i;
				throw new TypeError("@@toPrimitive must return a primitive value.");
			}
			return ("string" === r ? String : Number)(t);
		}
		//#endregion
		//#region \0@oxc-project+runtime@0.146.0/helpers/esm/toPropertyKey.js
		function toPropertyKey(t) {
			var i = toPrimitive(t, "string");
			return "symbol" == _typeof(i) ? i : i + "";
		}
		//#endregion
		//#region \0@oxc-project+runtime@0.146.0/helpers/esm/defineProperty.js
		function _defineProperty(e, r, t) {
			return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
				value: t,
				enumerable: !0,
				configurable: !0,
				writable: !0
			}) : e[r] = t, e;
		}
		//#endregion
		//#region src/client/bootGate.ts
		/** The defaults the VSCode tab uses. */
		const BOOT_QUIET_TIMING = {
			minElapsedMs: 800,
			quietMs: 1200,
			timeoutMs: 8e3,
			intervalMs: 250
		};
		/**
		* Watch `inputs.sample()` until the workbench's editor strip is rendered
		* AND has been quiet for `timing.quietMs` (with `minElapsedMs` elapsed),
		* the frame turns out to be cross-origin, or the timeout hits — then call
		* `onReveal()` exactly once. Returns a stop function (idempotent).
		*/
		function watchBootQuiet(inputs, onReveal, timing = BOOT_QUIET_TIMING, schedule = (cb, ms) => {
			window.setTimeout(cb, ms);
		}, now = Date.now) {
			let stopped = false;
			let revealed = false;
			let lastSignature = null;
			let lastChangeAt = now();
			const startedAt = lastChangeAt;
			const reveal = () => {
				if (stopped || revealed) return;
				revealed = true;
				onReveal();
			};
			const tick = () => {
				if (stopped || revealed) return;
				const at = now();
				if (at - startedAt >= timing.timeoutMs) {
					reveal();
					return;
				}
				const signature = inputs.sample();
				if (signature === null) {
					reveal();
					return;
				}
				if (signature !== lastSignature) {
					lastSignature = signature;
					lastChangeAt = at;
				}
				const quiet = at - lastChangeAt >= timing.quietMs;
				const rendered = lastSignature !== null && lastSignature !== "";
				const settledOk = inputs.settled === void 0 || inputs.settled();
				if (rendered && quiet && settledOk && at - startedAt >= timing.minElapsedMs) {
					reveal();
					return;
				}
				schedule(tick, timing.intervalMs);
			};
			schedule(tick, timing.intervalMs);
			return () => {
				stopped = true;
			};
		}
		/** The final path segment of one editor id (the strip exposes basenames). */
		function basenameOf(path) {
			const at = path.lastIndexOf("/");
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		* Whether a sampled editor strip matches the boot ledger's desired
		* open-editor set, as a multiset of BASE names: the VS Code tab DOM
		* exposes only `data-resource-name` (no full paths), so the comparison
		* is exact on count and names. A mismatch is always decisive (the strip
		* is not what the reconcile will settle at); a match is decisive unless
		* two distinct files share one basename — a collision the receipt and
		* the bounded timeout still cover.
		*/
		function sameEditorSet(strip, ledger) {
			if (strip.length !== ledger.length) return false;
			const left = strip.map(basenameOf).sort();
			const right = ledger.map(basenameOf).sort();
			return left.every((name, at) => name === right[at]);
		}
		/**
		* The boot gate controller: one instance per mounted VscodeView, driven
		* through three entry points —
		*
		* - {@link BootGateController.begin} whenever the frame's load key changes
		*   (first mount, target change, manual reload): parks a fresh nonce
		*   BEFORE the frame may mount ('pending' keeps it unmounted; 'off' skips
		*   gating when no workspace is known);
		* - {@link BootGateController.frameLoaded} on every iframe load event: the
		*   FIRST load starts the reveal watch against the parked nonce; every
		*   subsequent load of the same frame is an in-place RELOAD (the pane DOM
		*   was detached on a panel collapse or workspace switch and re-inserted,
		*   which the browser treats as a reload) and ROTATES the nonce first —
		*   retiring every lingering extension host still bound to the old boot;
		* - {@link BootGateController.fence} when the frame goes away (unmount /
		*   key change): rotates the parked nonce once more so a lingering host
		*   stops writing the shared editor ledger from its invisible window.
		*
		* The reveal paths: the 'hidden' phase runs a RACE between the receipt
		* poll (every {@link BOOT_POLL_INTERVAL_MS}, budgeted by
		* {@link BOOT_REVEAL_TIMEOUT_MS}) and the DOM-quiet watcher
		* ({@link watchBootQuiet}) — whichever settles first reveals, because a
		* reloaded frame's extension host may never re-activate and its receipt
		* then never lands, while the rendered editor strip is proof enough that
		* the staging the gate exists for is done. The 'dom' phase (no exact
		* handshake available) watches the editor strip alone; anything else
		* reveals immediately.
		*/
		var BootGateController = class {
			constructor(deps) {
				this.deps = deps;
				_defineProperty(this, "status", {
					key: "",
					phase: "pending",
					nonce: "",
					workspace: "",
					ledger: null,
					revealed: false
				});
				_defineProperty(this, "listeners", /* @__PURE__ */ new Set());
				_defineProperty(this, "revealStop", null);
				_defineProperty(this, "loadCount", 0);
				_defineProperty(this, "disposed", false);
			}
			/** The current state (a fresh object per transition; identity-stable between). */
			getSnapshot() {
				return this.status;
			}
			/** Subscribe to state transitions; returns the unsubscriber. */
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			emit() {
				for (const listener of this.listeners) listener();
			}
			patch(next) {
				this.status = {
					...this.status,
					...next
				};
				this.emit();
			}
			/**
			* The nonce an open command may be tagged with: only a 'hidden' phase
			* nonce is live for THIS boot (the extension consumes a tagged command
			* solely on the host that activated with it — see the open channel).
			*/
			taggableNonce() {
				return this.status.phase === "hidden" ? this.status.nonce : void 0;
			}
			/** Whether the gate has settled enough to run deferred open requests. */
			settled() {
				return this.status.phase !== "pending" && this.status.phase !== "rotating";
			}
			/**
			* A new frame load begins for `key` (the previous frame, if any, went
			* away): park a fresh boot nonce BEFORE the frame may mount. A missing
			* workspace skips gating ('off' — stock behavior); a failed park falls
			* back to the DOM-quiet watcher ('dom').
			*/
			begin(key) {
				if (this.disposed) return;
				this.revealStop?.();
				this.revealStop = null;
				this.loadCount = 0;
				this.status = {
					key,
					phase: "pending",
					nonce: "",
					workspace: "",
					ledger: null,
					revealed: false
				};
				this.emit();
				const workspace = this.deps.workspace();
				if (workspace === null) {
					this.patch({ phase: "off" });
					return;
				}
				const nonce = this.deps.mintNonce();
				(async () => {
					const outcome = await this.deps.beginBoot(workspace, nonce);
					if (this.disposed || this.status.key !== key) return;
					this.patch(outcome.began ? {
						phase: "hidden",
						nonce,
						workspace,
						ledger: outcome.editors
					} : {
						phase: "dom",
						nonce: "",
						workspace: "",
						ledger: null
					});
				})();
			}
			/**
			* The frame fired a load event for the CURRENT key: the first load
			* starts the reveal watch; a subsequent load of the same frame is an
			* in-place reload and rotates the nonce first (fresh renderer whose
			* extension host activates against a bootreq that still names the
			* PREVIOUS boot — whose hosts may be lingering).
			*/
			frameLoaded() {
				if (this.disposed) return;
				this.loadCount += 1;
				const { key, phase } = this.status;
				if (this.loadCount > 1 && (phase === "hidden" || phase === "rotating")) {
					this.rotate(key);
					return;
				}
				this.startRevealWatch(this.status, key);
			}
			/** Rotate the boot nonce for a reloaded frame and re-arm the reveal. */
			async rotate(key) {
				const workspace = this.deps.workspace();
				if (workspace === null) {
					this.startRevealWatch(this.status, key);
					return;
				}
				this.patch({
					phase: "rotating",
					nonce: "",
					workspace: "",
					ledger: null,
					revealed: false
				});
				const fresh = this.deps.mintNonce();
				const outcome = await this.deps.beginBoot(workspace, fresh);
				if (this.disposed || this.status.key !== key) return;
				const next = outcome.began ? {
					key,
					phase: "hidden",
					nonce: fresh,
					workspace,
					ledger: outcome.editors,
					revealed: false
				} : {
					key,
					phase: "dom",
					nonce: "",
					workspace: "",
					ledger: null,
					revealed: false
				};
				this.status = next;
				this.emit();
				this.startRevealWatch(next, key);
			}
			/**
			* The frame is going away (unmount or key change): rotate the parked
			* nonce once more, fire-and-forget — a lingering extension host still
			* holding the old nonce must stand down before its invisible window
			* poisons the shared editor ledger.
			*/
			fence() {
				const workspace = this.deps.workspace();
				if (workspace !== null) this.deps.beginBoot(workspace, this.deps.mintNonce());
			}
			/** Start (or restart) the reveal watch for the current load. */
			startRevealWatch(gate, key) {
				this.revealStop?.();
				this.revealStop = null;
				const reveal = () => {
					if (this.disposed || this.status.key !== key || this.status.revealed) return;
					this.patch({ revealed: true });
					this.revealStop?.();
				};
				if (gate.phase === "hidden") {
					const settledByLedger = () => {
						if (gate.ledger === null) return true;
						const strip = this.deps.domPaths();
						if (strip === null) return false;
						return sameEditorSet(strip, gate.ledger);
					};
					const stops = [];
					this.revealStop = () => {
						for (const stop of stops) stop();
					};
					const startedAt = this.deps.now();
					let pollStopped = false;
					stops.push(() => {
						pollStopped = true;
					});
					const tick = () => {
						if (pollStopped || this.disposed) return;
						(async () => {
							let matched = false;
							try {
								matched = await this.deps.pollBootStatus(gate.workspace, gate.nonce);
							} catch {
								matched = false;
							}
							if (pollStopped || this.disposed) return;
							if (matched || this.deps.now() - startedAt > 4e3 && settledByLedger()) {
								reveal();
								return;
							}
							this.deps.schedule(tick, 150);
						})();
					};
					tick();
					let quietStop = null;
					quietStop = watchBootQuiet({
						sample: () => this.deps.domSample(),
						settled: settledByLedger
					}, reveal, BOOT_QUIET_TIMING, (callback, ms) => {
						this.deps.schedule(callback, ms);
					}, () => {
						return this.deps.now();
					});
					stops.push(() => {
						quietStop?.();
					});
					return;
				}
				if (gate.phase === "dom") {
					this.revealStop = watchBootQuiet({ sample: () => this.deps.domSample() }, reveal, BOOT_QUIET_TIMING, (callback, ms) => {
						this.deps.schedule(callback, ms);
					}, () => {
						return this.deps.now();
					});
					return;
				}
				reveal();
			}
			/** Final teardown: stop the watch and ignore every later driver call. */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.revealStop?.();
				this.revealStop = null;
			}
		};
		//#endregion
		//#region src/client/focusGuard.ts
		/**
		* The focus fence of the embedded workbench (VscodeView): pure decision
		* logic plus the restore budget.
		*
		* Why a fence at all: the VS Code workbench PROGRAMMATICALLY focuses its
		* own content shortly after it boots — the Getting Started page calls
		* focus() on itself when it renders, and a restored workspace focuses
		* the editor it restored — typically 0.5–4s after the iframe loads, with
		* zero user interaction. Whenever that boot happens at a moment the user
		* did not aim at the workbench (a new session's default tab behind a
		* collapsed panel; switching back to a session whose workspace remounts
		* the panel; a page reload), the grab rips the caret out of wherever it
		* belongs — usually the freshly-autofocused composer, whose two blink
		* cycles are exactly how long the steal takes.
		*
		* The fence therefore bounces a focus entry into the frame unless there
		* is evidence of user intent, in two armed situations:
		*
		* 1. HIDDEN (`visible === false`): every entry is a steal — a hidden
		*    frame cannot receive user clicks.
		* 2. BOOT: for a window after EVERY load of the frame, because every
		*    load is a workbench boot and every boot self-focuses. Most boots
		*    happen at moments the user did not aim at the workbench: the pane
		*    survives workspace switches at the React level, but its iframe is
		*    torn out of the document on the way out and re-inserted on the way
		*    back — which the browser reloads, so switching back to a session
		*    boots a workbench that restores its editor and focuses it right
		*    after the composer was autofocused; a page reload does the same.
		*    During the window, entries bounce unless the user gestured inside
		*    the frame (a click/keydown seen through same-origin privilege — a
		*    cross-origin frame cannot report gestures, so the boot fence
		*    stands down rather than bounce real clicks) or a parent Tab
		*    keypress handed focus over. The one sanctioned boot is the
		*    deferred first load of a component that mounted hidden: the user
		*    revealed the tab to release it, so its focus grab is welcome (the
		*    component decides that, not this function).
		*
		* Bounces are bounded by a FocusRestoreBudget so a re-grabbing
		* workbench cannot livelock the focus chain.
		*
		* Pure bookkeeping on an injected clock so unit tests need no timers.
		*
		* @module dsh-sidebar-vscode/client/focusGuard
		*/
		/** How long after the first load the boot fence stays armed (ms). */
		const BOOT_WINDOW_MS = 6e3;
		/**
		* Should a focus entry into the frame be bounced back to the surface
		* that held focus last? (The caller checks `document.activeElement`
		* against the frame and spends budget on a `true`.)
		*/
		function fenceShouldBounce(facts, now) {
			if (facts.hidden) return true;
			if (!facts.bootArmed) return false;
			if (now >= facts.bootUntil) return false;
			if (facts.gestureAt > 0) return false;
			if (facts.parentTabAt > 0 && now - facts.parentTabAt <= 250) return false;
			return true;
		}
		/** Sliding-window restore budget. */
		var FocusRestoreBudget = class {
			/**
			* @param max - restores allowed per window before standing down.
			* @param windowMs - window length in milliseconds.
			*/
			constructor(max = 5, windowMs = 1e4) {
				this.max = max;
				this.windowMs = windowMs;
				_defineProperty(this, "windowStart", 0);
				_defineProperty(this, "used", 0);
			}
			/**
			* Try to spend one restore at the given time. The window slides: the
			* first `take` at or after `windowMs` from the window's start re-arms
			* the budget.
			* @param now - the current clock reading (ms).
			* @returns whether the restore may proceed.
			*/
			take(now) {
				if (now - this.windowStart >= this.windowMs) {
					this.windowStart = now;
					this.used = 0;
				}
				if (this.used >= this.max) return false;
				this.used += 1;
				return true;
			}
		};
		//#endregion
		//#region src/client/focusFence.ts
		/**
		* The focus fence of the embedded workbench: the controller that bounces
		* focus entries into the VS Code iframe back to the surface that held
		* focus last, unless the user actually aimed at the workbench.
		*
		* Why a fence at all: the VS Code workbench PROGRAMMATICALLY focuses its
		* own content shortly after it boots — the Getting Started page calls
		* focus() on itself when it renders, and a restored workspace focuses the
		* editor it restored — typically 0.5–4s after the iframe loads, with zero
		* user interaction. Whenever that boot happens at a moment the user did
		* not aim at the workbench (a new session's default tab behind a
		* collapsed panel; switching back to a session whose workspace remounts
		* the panel; a page reload), the grab rips the caret out of wherever it
		* belongs — usually the freshly-autofocused composer.
		*
		* The DECISION logic is pure and lives in focusGuard.ts (`fenceShouldBounce`,
		* `FocusRestoreBudget` — unit-tested there). This controller owns the
		* plumbing around it: the parent-document listeners for the component's
		* whole life, the per-load gesture trackers inside the frame document,
		* and the visibility/boot arming windows. Two armed situations:
		*
		* 1. HIDDEN (`visible === false`, explicit only): every entry is a steal
		*    — a hidden frame cannot receive user clicks.
		* 2. BOOT: for a window after EVERY load of the frame (each load is a
		*    workbench boot, and every boot self-focuses). Entries bounce UNLESS
		*    the user gestured inside the frame (same-origin pointerdown/keydown
		*    trackers, re-attached on every load — a cross-origin frame cannot
		*    report gestures, so the boot fence stands down rather than bounce
		*    real clicks) or a parent Tab keypress handed focus over. The ONE
		*    sanctioned boot is the deferred first load of a component that
		*    mounted hidden: the user revealed the tab to release it, so its
		*    focus grab is welcome (see {@link FocusFenceController.onFrameLoad}).
		*
		* Detection rides FOCUSOUT, not focusin: a focus crossing INTO the iframe
		* fires focusout in the parent document but never focusin — the focusin
		* lands inside the frame's own document.
		*
		* @module dsh-sidebar-vscode/client/focusFence
		*/
		/**
		* The fence controller: attach() installs the parent-document listeners
		* once for the owning component's lifetime; onFrameLoad() re-arms the
		* boot window and re-attaches the gesture trackers on every frame load
		* (the document they must live in is whichever the frame shows now — an
		* intermediate about:blank would otherwise leave them aimed at a dead
		* document); setVisible() feeds the hidden situation (armed only on an
		* EXPLICIT false — the official tab body's `visible` is always boolean;
		* a hypothetical absent flag must never have its user clicks fought;
		* undefined fails open).
		*/
		var FocusFenceController = class {
			constructor(deps, options = {}) {
				this.deps = deps;
				_defineProperty(this, "budget", void 0);
				_defineProperty(this, "lastOutside", null);
				_defineProperty(this, "bootArmed", false);
				_defineProperty(this, "bootUntil", 0);
				_defineProperty(this, "gestureAt", 0);
				_defineProperty(this, "parentTabAt", 0);
				_defineProperty(this, "visible", void 0);
				_defineProperty(this, "bornVisible", void 0);
				_defineProperty(this, "firstLoad", true);
				this.bornVisible = options.bornVisible ?? true;
				this.budget = new FocusRestoreBudget(options.budgetMax, options.budgetWindowMs);
			}
			/** Feed the tab's visibility flag (explicit false arms the hidden fence). */
			setVisible(visible) {
				this.visible = visible;
			}
			/**
			* Install the parent-document listeners (focusout/focusin tracking, the
			* Tab handoff marker, the steal check). Everything the handlers read
			* lives on the controller, so the listeners never need re-arming.
			* @returns the disposer removing them.
			*/
			attach() {
				const track = (target) => {
					if (target instanceof HTMLElement && target !== this.deps.getFrame()) this.lastOutside = target;
				};
				const checkSteal = () => {
					const frame = this.deps.getFrame();
					if (frame === null || document.activeElement !== frame) return;
					if (!fenceShouldBounce({
						hidden: this.visible === false,
						bootArmed: this.bootArmed,
						bootUntil: this.bootUntil,
						gestureAt: this.gestureAt,
						parentTabAt: this.parentTabAt
					}, this.deps.now())) return;
					if (!this.budget.take(this.deps.now())) return;
					if (this.lastOutside !== null && this.lastOutside.isConnected) this.lastOutside.focus();
				};
				const onFocusOut = (event) => {
					track(event.target);
					this.deps.setTimeout(checkSteal, 0);
				};
				const onFocusIn = (event) => {
					track(event.target);
				};
				const onKeyDown = (event) => {
					if (event.key === "Tab") this.parentTabAt = this.deps.now();
				};
				document.addEventListener("focusout", onFocusOut, true);
				document.addEventListener("focusin", onFocusIn, true);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("focusout", onFocusOut, true);
					document.removeEventListener("focusin", onFocusIn, true);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}
			/**
			* The frame fired a load: reset the gesture memory, re-attach the
			* same-origin gesture trackers into the frame's CURRENT document, and
			* re-arm the boot fence with a fresh window. The one sanctioned boot is
			* the deferred FIRST load of a component that mounted hidden — that
			* load was released by the user revealing the tab, so its focus grab is
			* welcome (and the gesture trackers make every other armed window
			* harmless for a user who is actually clicking inside).
			*/
			onFrameLoad() {
				this.gestureAt = 0;
				let gesturesVisible = true;
				const frame = this.deps.getFrame();
				try {
					const doc = frame?.contentDocument ?? null;
					if (frame === null || doc === null) gesturesVisible = false;
					else {
						const mark = () => {
							this.gestureAt = this.deps.now();
						};
						doc.addEventListener("pointerdown", mark, true);
						doc.addEventListener("keydown", mark, true);
					}
				} catch {
					gesturesVisible = false;
				}
				const firstLoad = this.firstLoad;
				this.firstLoad = false;
				const sanctionedReveal = firstLoad && !this.bornVisible;
				this.bootArmed = gesturesVisible && !sanctionedReveal;
				this.bootUntil = this.deps.now() + BOOT_WINDOW_MS;
			}
		};
		//#endregion
		//#region src/client/workbenchBase.ts
		/**
		* The workbench iframe-base resolver: which base URL the embedded VS Code
		* workbench opens at — the same-origin proxy mount (`/sidebar/vscode`)
		* whenever the host half's built-in reverse proxy is serving, the
		* configured direct URL otherwise, with a self-healing poll that
		* graduates a direct fallback to the mount once the proxy comes up.
		*
		* Extracted from the VscodeView render body as a controller so the whole
		* decision — the `proxy.config` push, the `proxy.status` ask, the reset
		* of a previously pushed upstream, the 5s graduation loop, and the
		* cancellation discipline — is one unit-testable object with injected
		* transport. The {@link useWorkbenchBase} hook is the thin React binding.
		*
		* Decision table (the base is decided by PROXY REACHABILITY ALONE —
		* `serverUrl` names the UPSTREAM and the fallback base):
		*
		* - a FULL URL (`http(s)://…`, base path and `?tkn=` token included) is
		*   pushed via `proxy.config`; reachable → mount; unreachable (a
		*   serve-web still warming up, a remote address) → the direct
		*   cross-origin iframe plus a notice, with the host still probing and
		*   the graduation loop watching for it to start serving;
		* - anything else (empty = the default local serve-web, or an explicit
		*   relative subpath with gateway semantics) is never pushed: any
		*   previously pushed upstream is RELEASED (`{reset:true}`), and the
		*   host's own proxy state picks the winner — serving → mount, else the
		*   subpath itself as a direct base.
		*
		* @module dsh-sidebar-vscode/client/workbenchBase
		*/
		/** The default fetch binding (the browser's global). */
		const defaultFetch$1 = (url, init) => fetch(url, init);
		/** How often a direct fallback re-asks the host whether it is serving yet. */
		const GRADUATE_POLL_MS = 5e3;
		/** The browser-global binding. */
		const defaultTimers = {
			setInterval: (handler, ms) => {
				return window.setInterval(handler, ms);
			},
			clearInterval: (handle) => {
				window.clearInterval(handle);
			}
		};
		/**
		* One resolution attempt per `serverUrl` shape. `update` cancels the
		* previous attempt and starts a new one; `cancel` stops everything
		* (unmount). The controller remembers what THIS component pushed to the
		* host (the historical `pushedUrl` discipline): switching from a full
		* URL to a relative subpath must RELEASE the previously adopted upstream
		* before the status ask, or the ask would observe the stale one — and
		* the release is awaited first for exactly that reason.
		*/
		var WorkbenchBaseController = class {
			constructor(emit, fetchLike = defaultFetch$1, timers = defaultTimers) {
				this.emit = emit;
				this.fetchLike = fetchLike;
				this.timers = timers;
				_defineProperty(this, "cancelled", false);
				_defineProperty(this, "graduate", null);
				_defineProperty(this, "pushedUrl", null);
			}
			/** POST one JSON body and answer `{ok, value}` structurally; null on failure. */
			async post(method, body) {
				try {
					const response = await this.fetchLike(`/sidebar-vscode/api/${method}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					});
					const parsed = await response.json().catch(() => null);
					if (!response.ok || parsed === null || typeof parsed !== "object") return null;
					const record = parsed;
					if (record.ok !== true) return null;
					return {
						ok: true,
						value: record.value
					};
				} catch {
					return null;
				}
			}
			/** Whether the host's proxy reports itself serving (a mount candidate). */
			async serving() {
				const parsed = await this.post("proxy.status", {});
				return parsed !== null && parsed.value?.serving === true;
			}
			/** Start the graduation loop: poll until the host serves, then emit mount. */
			watchServing() {
				const timer = this.timers.setInterval(() => {
					if (this.cancelled) return;
					(async () => {
						if (await this.serving()) {
							this.emit("mount", void 0);
							this.graduate?.();
						}
					})();
				}, GRADUATE_POLL_MS);
				this.graduate = () => {
					this.timers.clearInterval(timer);
				};
			}
			/**
			* Resolve the base for one `serverUrl` shape. Cancels any in-flight
			* resolution first; emits 'resolving' immediately, then
			* 'mount'/'direct' once the host answers (plus later 'mount'
			* graduations from the direct fallback's poll).
			*
			* @param effectiveServerUrl - the normalized setting value (empty =
			* DEFAULT_SERVER_URL applied by the caller).
			* @param fullUrl - whether the value is a full http(s) URL.
			*/
			update(effectiveServerUrl, fullUrl) {
				this.cancel();
				this.cancelled = false;
				const isCancelled = () => this.cancelled;
				this.emit("resolving", void 0);
				if (!fullUrl) {
					const previous = this.pushedUrl;
					this.pushedUrl = null;
					(async () => {
						if (previous !== null) await this.post("proxy.config", { reset: true }).catch(() => null);
						if (isCancelled()) return;
						if (await this.serving()) {
							if (!isCancelled()) this.emit("mount", void 0);
							return;
						}
						if (isCancelled()) return;
						this.emit("direct", void 0);
						this.watchServing();
					})();
					return;
				}
				(async () => {
					const parsed = await this.post("proxy.config", { url: effectiveServerUrl });
					if (isCancelled()) return;
					if (parsed !== null) {
						this.pushedUrl = effectiveServerUrl;
						if (parsed.value?.reachable === true) {
							this.emit("mount", void 0);
							return;
						}
					}
					this.emit("direct", "proxyFallback");
					this.watchServing();
				})();
			}
			/** Stop the in-flight resolution (unmount / HMR). */
			cancel() {
				this.cancelled = true;
				this.graduate?.();
				this.graduate = null;
			}
		};
		/**
		* The React binding: resolves the iframe base for one `serverUrl` shape
		* and re-resolves whenever it changes. `onNotice` receives the
		* degradation notice key ('proxyFallback') at most once per resolution.
		* @returns the live base state.
		*/
		function useWorkbenchBase(effectiveServerUrl, fullUrl, onNotice) {
			const [state, setState] = (0, react.useState)("resolving");
			const noticeRef = (0, react.useRef)(onNotice);
			noticeRef.current = onNotice;
			const controller = (0, react.useRef)(null);
			if (controller.current === null) controller.current = new WorkbenchBaseController((next, notice) => {
				setState(next);
				if (notice !== void 0) noticeRef.current(notice);
			});
			(0, react.useEffect)(() => {
				controller.current?.update(effectiveServerUrl, fullUrl);
				return () => {
					controller.current?.cancel();
				};
			}, [effectiveServerUrl, fullUrl]);
			return state;
		}
		//#endregion
		//#region src/client/bootLock.ts
		/**
		* The cross-tab workbench boot lock: serializes the FIRST moments of a
		* VS Code web boot across every same-origin DSH tab holding this plugin.
		*
		* Why: a VS Code web renderer opens its IndexedDB application storage
		* (`vscode-web-db`) within the first second of booting. When two
		* same-origin pages race to CREATE that database, one of them can hang
		* inside `willOpenDatabase` for minutes (measured on this very
		* deployment: a 294-second open on a warm profile; two fresh profiles
		* stalled forever, and both unblocked within 500ms of the OTHER tab's
		* page going away) — the workbench DOM never renders, and the boot
		* gate's reveal then shows an empty frame. The DSH app routinely has
		* several tabs open on the same origin (restored conversations), each
		* able to auto-open this VS Code tab, so the race is not exotic.
		*
		* The fix: before a frame may mount, the tab must hold the Web Lock
		* `dsh-sidebar-vscode:workbench-boot` (the Web Locks API — same-origin
		* scope, released automatically when a holding tab dies). The lock is
		* RELEASED once the workbench has rendered its DOM — a renderer cannot
		* paint `.monaco-workbench` without having passed the database open, so
		* that is exactly the moment the creation race is over for this profile;
		* from then on concurrent opens are the cheap reconnect kind.
		*
		* Everything is fail-open by design — the lock removes a rare stall, it
		* must never introduce a wait of its own:
		*
		* - no Web Locks API (older browsers): acquire answers null, the boot
		*   proceeds unlocked (stock behavior);
		* - the lock never grants (a wedged holder): a bounded wait cap proceeds
		*   unlocked;
		* - the render never happens (cross-origin frame, a broken boot): a
		*   bounded hold cap releases the lock so queued tabs are not starved.
		*
		* While the lock is contended beyond a short grace, the snapshot flips
		* to 'queued' so the loading overlay can say why nothing is happening.
		*
		* @module dsh-sidebar-vscode/client/bootLock
		*/
		/** The cross-tab lock name (identical in every DSH tab of the profile). */
		const BOOT_LOCK_NAME = "dsh-sidebar-vscode:workbench-boot";
		/** Bounded wait: proceed unlocked when the lock still has not granted. */
		const BOOT_LOCK_WAIT_CAP_MS = 6e4;
		/**
		* Acquire the cross-tab boot lock, waiting while another tab holds it.
		* Resolves the release function, or null when the Web Locks API is
		* unavailable (fail-open — the caller proceeds unlocked). The release is
		* idempotent.
		*/
		function acquireWebLock(name = BOOT_LOCK_NAME) {
			const locks = navigator.locks;
			if (locks === void 0 || typeof locks.request !== "function") return Promise.resolve(null);
			return new Promise((resolve) => {
				let granted = false;
				locks.request(name, async () => {
					granted = true;
					let release;
					const held = new Promise((resolveHeld) => {
						release = resolveHeld;
					});
					resolve(release);
					await held;
				}).catch(() => {
					if (!granted) resolve(null);
				});
			});
		}
		/** The initial snapshot (nothing begun — no key matches yet). */
		const INITIAL_STATUS = {
			key: "",
			state: "waiting"
		};
		/**
		* One boot-lock controller per mounted VscodeView, driven through two
		* entry points mirroring the boot gate:
		*
		* - {@link WorkbenchBootLock.begin} whenever the frame's load key is
		*   (re)established: releases any previous hold, flips to 'waiting'
		*   (then 'queued' past the grace), and holds the lock once granted —
		*   only a 'held' snapshot matching the CURRENT load key permits the
		*   iframe to mount;
		* - {@link WorkbenchBootLock.end} when that load key goes away
		*   (unmount / target change / manual reload): stops the cycle and
		*   releases the underlying lock (the next begin starts a fresh one).
		*
		* The physical release fires as soon as `rendered()` reports a painted
		* workbench (or the hold cap expires); the snapshot stays 'held' for
		* that key regardless — releasing the lock must never unmount the frame
		* it gated.
		*/
		var WorkbenchBootLock = class {
			constructor(deps) {
				this.deps = deps;
				_defineProperty(this, "status", INITIAL_STATUS);
				_defineProperty(this, "listeners", /* @__PURE__ */ new Set());
				_defineProperty(this, "generation", 0);
				_defineProperty(this, "settled", false);
				_defineProperty(this, "release", null);
				_defineProperty(this, "released", false);
				_defineProperty(this, "disposed", false);
			}
			/** The current snapshot (a fresh object per transition; identity-stable between). */
			getSnapshot() {
				return this.status;
			}
			/** Subscribe to snapshot transitions; returns the unsubscriber. */
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			emit() {
				for (const listener of this.listeners) listener();
			}
			patch(next) {
				this.status = {
					...this.status,
					...next
				};
				this.emit();
			}
			/**
			* Start one acquisition cycle for `key`: the frame behind that key may
			* mount only once the snapshot reads 'held' for it. A previous cycle
			* (and its lock hold) is stood down first — exactly one hold per
			* controller at any moment.
			*/
			begin(key) {
				if (this.disposed) return;
				this.cancelCycle();
				this.generation += 1;
				const generation = this.generation;
				this.settled = false;
				this.released = false;
				this.patch({
					key,
					state: "waiting"
				});
				this.deps.schedule(() => {
					if (this.disposed || generation !== this.generation || this.settled) return;
					this.patch({ state: "queued" });
				}, 500);
				this.deps.schedule(() => {
					if (this.disposed || generation !== this.generation || this.settled) return;
					this.hold(null);
				}, BOOT_LOCK_WAIT_CAP_MS);
				this.deps.acquire().then((release) => {
					if (this.disposed || generation !== this.generation || this.settled) {
						release?.();
						return;
					}
					this.hold(release);
				}, () => {
					if (this.disposed || generation !== this.generation || this.settled) return;
					this.hold(null);
				});
			}
			/** Stand the current cycle down (stop watches, release the lock). */
			end() {
				if (this.disposed) return;
				this.cancelCycle();
			}
			/**
			* The held lock: report 'held' for the key, then watch for the moment
			* the race this lock exists for is over — the painted workbench — and
			* physically release (bounded by the hold cap for frames whose DOM we
			* can never see, e.g. a cross-origin direct boot).
			*/
			hold(release) {
				this.settled = true;
				this.release = release;
				this.patch({ state: "held" });
				const generation = this.generation;
				const startedAt = this.deps.now();
				const tick = () => {
					if (this.disposed || generation !== this.generation) return;
					if (this.deps.rendered() || this.deps.now() - startedAt >= 3e4) {
						this.doRelease();
						return;
					}
					this.deps.schedule(tick, 250);
				};
				tick();
			}
			/** Physically release the lock (idempotent; the snapshot stays 'held'). */
			doRelease() {
				if (this.released) return;
				this.released = true;
				this.release?.();
				this.release = null;
			}
			/** Stop the in-flight cycle and release its hold (snapshot keeps its key). */
			cancelCycle() {
				this.generation += 1;
				this.settled = true;
				this.doRelease();
			}
			/** Final teardown: release and ignore every later driver call. */
			dispose() {
				if (this.disposed) return;
				this.disposed = true;
				this.cancelCycle();
			}
		};
		//#endregion
		//#region src/client/openRequests.ts
		/**
		* Read the open command one navigation's `params` carries. Structural and
		* throw-free: a malformed or absent params object (another plugin's
		* navigation, a hand-built record) yields null and the consumer stands
		* down for it — but the revision is still consumed as seen, so a later
		* well-formed navigation is not blocked by an earlier malformed one.
		*/
		function readNavigationOpen(params) {
			if (params === null || typeof params !== "object" || Array.isArray(params)) return null;
			const record = params;
			if (typeof record.path !== "string" || record.path === "") return null;
			const out = { path: record.path };
			if (typeof record.line === "number" && Number.isFinite(record.line) && record.line > 0) out.line = Math.floor(record.line);
			if (typeof record.column === "number" && Number.isFinite(record.column) && record.column > 0) out.column = Math.floor(record.column);
			return out;
		}
		/** The last minted command nonce (module state — one monotonic sequence per page). */
		let lastNonce = 0;
		/**
		* Mint the next command nonce: wall-clock based so sequences survive
		* reloads, but strictly monotonic within a page (two clicks in the same
		* millisecond must still produce increasing values, or the second would
		* be swallowed by the extension spool).
		*/
		function nextNonce(now = Date.now) {
			const current = now();
			lastNonce = current > lastNonce ? current : lastNonce + 1;
			return lastNonce;
		}
		/**
		* The highest navigation revision any consumer of this page has executed,
		* keyed by `${sessionId}:${tabId}`. Module level on purpose: it survives
		* tab close/reopen and tab-switch remounts (the official pane unmounts
		* inactive bodies) and resets only on reload — which also resets the
		* in-memory layout that holds the navigations.
		*/
		const executedWatermark = /* @__PURE__ */ new Map();
		/**
		* One consumer per mounted VscodeView. Feed it the tab's live navigation
		* and the consuming session/tab identity on every relevant change; it
		* owns the instance baseline and the page watermark, and decides
		* defer / execute / skip exactly once per revision.
		*/
		var OpenRequestConsumer = class {
			constructor(deps) {
				this.deps = deps;
				_defineProperty(this, "initialized", false);
				_defineProperty(this, "lastRevision", 0);
			}
			/**
			* Consider the tab's current navigation for the session whose tab
			* mounted this consumer. Call on every navigation/gate change;
			* repeated calls with the same revision are idempotent.
			*/
			update(navigation, sessionId, tabId) {
				const revision = navigation?.revision ?? 0;
				if (!this.initialized) {
					this.initialized = true;
					this.lastRevision = Math.max(readWatermark(sessionId, tabId), 0);
				}
				if (revision <= 0) return;
				if (revision <= this.lastRevision) return;
				if (!this.deps.gateSettled()) return;
				this.lastRevision = revision;
				writeWatermark(sessionId, tabId, revision);
				const open = readNavigationOpen(navigation?.params);
				if (open === null) return;
				Promise.resolve(this.deps.execute({
					...open,
					nonce: nextNonce()
				})).catch(() => {});
			}
		};
		/** The watermark of one tab (0 when this page never executed for it). */
		function readWatermark(sessionId, tabId) {
			const key = watermarkKey(sessionId, tabId);
			return key === void 0 ? Number.NEGATIVE_INFINITY : executedWatermark.get(key) ?? 0;
		}
		/** Record the watermark of one tab (best-effort; unknown identity skips). */
		function writeWatermark(sessionId, tabId, revision) {
			const key = watermarkKey(sessionId, tabId);
			if (key === void 0) return;
			executedWatermark.set(key, revision);
		}
		function watermarkKey(sessionId, tabId) {
			if (sessionId === void 0 || sessionId === "") return void 0;
			return `${sessionId}:${tabId ?? ""}`;
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Copy dictionaries for the VSCode tab (zh / en). Registered with the DSH
		* locale service under the `vscodeTab` namespace; `t()` picks by active
		* locale with a browser-language fallback.
		*
		* @module dsh-sidebar-vscode/client/locales
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "vscodeTab";
		/** Simplified-Chinese dictionary. */
		const zh = {
			title: "VSCode",
			guideTitle: "VSCode 工作台",
			guideDescription: "在右侧边栏内嵌当前会话工作区的 VS Code 网页工作台；选中代码可一键注入对话",
			cardTitle: "VSCode 侧边栏",
			cardDescription: "官方右侧边栏内嵌 VS Code 网页工作台：选中代码注入对话、文件点击接管与同源反代都在此配置",
			cardExpand: "展开配置",
			cardCollapse: "收起配置",
			cardCustomized: "已自定义",
			cardReset: "恢复默认",
			cardReadOnly: "设置以只读方式同步（远程浏览器进程本地连接）；以下展示当前生效值",
			settingServerUrl: "VSCode 服务地址",
			settingServerUrlDesc: "code serve-web 输出的完整地址（可含基路径与 ?tkn= 令牌）；留空 = 默认 http://127.0.0.1:8000。可达时经内置同源代理打开，否则回退直连",
			settingServerUrlPlaceholder: "留空 = http://127.0.0.1:8000；或 http://127.0.0.1:8000/vscode/?tkn=…",
			loading: "正在打开 VSCode …",
			loadHint: "长时间空白？请检查「设置 → 插件 → 插件配置 → VSCode 侧边栏」里的服务地址是否可达，或用「在新窗口打开」排查",
			bootQueue: "正在等待其他窗口的编辑器完成启动（避免同时启动互相卡死），马上就好 …",
			reload: "刷新",
			openNewWindow: "在新窗口打开",
			workspace: "工作区",
			unmapped: "当前工作区路径不是绝对路径，已打开 VS Code 默认界面",
			settingMaxLines: "引用最大行数",
			settingMaxLinesDesc: "单条引用注入的代码行数上限，超出时保留首尾、省略中间；默认 200，范围 1–2000",
			settingMaxBytes: "引用最大字节数",
			settingMaxBytesDesc: "单条引用注入的 UTF-8 字节上限（防超大单行文件），超出时同样保留首尾；默认 20000，范围 1000–200000",
			settingRangeHint: "超出可填范围，确认时将自动改为最近的边界值",
			settingOpenAsDefault: "接管对话与设置页的文件打开",
			settingOpenAsDefaultDesc: "开启后，对话中的文件点击（工具行路径、产出文件、正文引用）与设置页「打开配置文件」都改在 VSCode 标签打开；关闭后恢复官方默认行为（侧边栏自带查看器）",
			settingOpenBlocklist: "不由 VSCode 打开的文件类型",
			settingOpenBlocklistDesc: "命中后缀的文件在对话中点击时不进 VSCode，改由官方侧边栏查看器（文本预览等）打开；未设置时默认 pdf、docx、xlsx、pptx、png、jpeg、jpg；清空列表 = 全部由 VSCode 打开",
			settingOpenBlocklistPlaceholder: "输入后缀名，如 zip，回车添加",
			settingOpenBlocklistInvalid: "无效后缀：仅限字母、数字与 . - ，长度 1–16",
			settingOpenBlocklistRemove: "移除",
			openUnmapped: "文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）",
			injectedAsText: "已注入为文本引用（输入框暂不可写入，提交效果相同）",
			injectFailed: "未能注入：当前没有可用的对话输入框",
			proxyFallback: "内置代理暂不可达该地址（或宿主半为旧版本），已回退为直连：同源选区桥不可用，粘贴兜底仍可用",
			railReferences: "VS Code 代码引用",
			removeReference: "移除引用"
		};
		/** English dictionary. */
		const en = {
			title: "VSCode",
			guideTitle: "VSCode workbench",
			guideDescription: "Embed the session workspace as a VS Code web workbench in the right sidebar; selections inject into the chat",
			cardTitle: "VSCode Sidebar",
			cardDescription: "The VS Code web workbench inside the official right sidebar: selection injection, file-open takeovers, and the same-origin proxy are configured here",
			cardExpand: "Expand settings",
			cardCollapse: "Collapse settings",
			cardCustomized: "Customized",
			cardReset: "Reset to defaults",
			cardReadOnly: "Settings sync read-only (process-local remote browser connection); effective values shown below",
			settingServerUrl: "VSCode server URL",
			settingServerUrlDesc: "The full address `code serve-web` prints (base path and ?tkn= token included); empty = the default http://127.0.0.1:8000. Served through the built-in same-origin proxy when reachable, else a direct connection",
			settingServerUrlPlaceholder: "empty = http://127.0.0.1:8000; or http://127.0.0.1:8000/vscode/?tkn=…",
			loading: "Opening VS Code …",
			loadHint: "Blank for long? Check the server URL under Settings → Plugins → Plugin Config → VSCode Sidebar, or open in a new window to diagnose",
			bootQueue: "Waiting for the editor in another window to finish booting (simultaneous boots deadlock each other) — one moment …",
			reload: "Reload",
			openNewWindow: "Open in new window",
			workspace: "Workspace",
			unmapped: "The workspace path is not absolute; the VS Code default view was opened",
			settingMaxLines: "Reference line cap",
			settingMaxLinesDesc: "Line cap per injected reference; overflow keeps the head and tail. Default 200, range 1–2000",
			settingMaxBytes: "Reference byte cap",
			settingMaxBytesDesc: "UTF-8 byte cap per injected reference (guards huge single-line files); overflow truncates the same way. Default 20000, range 1000–200000",
			settingRangeHint: "Out of the allowed range; it will snap to the nearest bound when confirmed",
			settingOpenAsDefault: "Take over chat and settings file opens",
			settingOpenAsDefaultDesc: "Chat file clicks (tool-row paths, produced files, prose mentions) and the settings \"Open configuration file\" button open in the VSCode tab; off restores the official default behavior (the sidebar's own viewers)",
			settingOpenBlocklist: "File types never opened in VS Code",
			settingOpenBlocklistDesc: "Chat clicks on files whose extension matches fall through to the official sidebar viewers (the text preview and friends); unset defaults to pdf, docx, xlsx, pptx, png, jpeg, jpg; an emptied list lets VS Code open everything",
			settingOpenBlocklistPlaceholder: "Type an extension like zip, press Enter to add",
			settingOpenBlocklistInvalid: "Invalid extension: letters, digits, . and - only, length 1–16",
			settingOpenBlocklistRemove: "Remove",
			openUnmapped: "The file path is not an absolute container path; it was not opened in VS Code (absolute paths no longer need a matching mapping rule — unmatched ones open as-is)",
			injectedAsText: "Injected as a text reference (composer briefly unwritable; submitting works the same)",
			injectFailed: "Could not inject: no composer is available",
			proxyFallback: "The built-in proxy cannot reach that address (or the host half is older); falling back to a direct connection: the same-origin selection bridge is off, the paste fallback still works",
			railReferences: "VS Code code references",
			removeReference: "Remove reference"
		};
		//#endregion
		//#region src/client/i18n.ts
		/**
		* Locale integration: registers the dictionary with the DSH locale service
		* and serves `t()` from the active locale. `t()` is a plain function over a
		* module-level service handle — React re-renders pick the new copy up
		* through the app-wide locale re-render; settings rows use `() => t(...)`
		* callbacks so the settings page re-renders read fresh values.
		*
		* @module dsh-sidebar-vscode/client/i18n
		*/
		/** Attached service (module-level; the plugin is a singleton per page). */
		let localeService;
		/** The active locale id: the service snapshot, else the browser language. */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "en");
		}
		/**
		* Translate one copy key in the active locale (zh* → zh, else en).
		*/
		function t(key) {
			return (activeLocale().toLowerCase().startsWith("zh") ? zh : en)[key];
		}
		/**
		* Wire the dictionaries to the service (called once from the plugin body).
		* @returns the disposer cordis holds via `ctx.effect`: unregisters the
		* dictionaries (the service's own disposer, when it returned one) and
		* drops the module-level service handle.
		*/
		function attachLocale(service) {
			localeService = service;
			const stop = service.register(NS, {
				zh: { ...zh },
				en: { ...en }
			});
			return () => {
				if (typeof stop === "function") stop();
				localeService = void 0;
			};
		}
		//#endregion
		//#region src/client/workbenchLink.ts
		/**
		* The workbench open orchestrator: how ONE open request becomes an open
		* inside the embedded VS Code — the two-channel discipline extracted
		* from the VscodeView so it is a unit-testable object with injected
		* transport.
		*
		* - **Primary channel — the extension command spool**: when a workspace
		*   folder is known and the `dsh.selection-reference` extension answers
		*   its capability probe, the open rides `open.request` (the extension
		*   polls the spool and `showTextDocument`s the file — no workbench
		*   reload). From capability version 4 up the command is TAGGED with the
		*   workbench boot's nonce, so only the extension host that activated
		*   with it consumes the open — a lingering previous host (serve-web
		*   keeps it alive for a while after the iframe went away) must not eat
		*   the command, open the file into its dying window, and let the fresh
		*   host's ledger reconcile close it as a ghost.
		* - **Degraded channel — the URL payload**: without the extension (or a
		*   route failure, or no workspace), the workbench reloads once with VS
		*   Code web's native `payload` query parameter. The pending URL is
		*   stamped with the basis it was computed from and ignored once that
		*   basis changes (cwd flip / settings edit), so a stale payload can
		*   never hijack a later navigation.
		*
		* Path semantics: unmapped ≠ unopenable — a path no `pathMap` rule
		* matches passes through as-is (same-container deployment), and the open
		* channel decides existence (extension stat / VS Code's own not-found
		* error); `null` only for non-absolute garbage, which surfaces a notice.
		*
		* @module dsh-sidebar-vscode/client/workbenchLink
		*/
		/** The capability version from which the open command carries the boot tag. */
		const BOOT_TAG_CAP_V = 4;
		/**
		* Build the opener. Pure orchestration over the injected seams — the
		* historical `executeOpen` verbatim, with the pending-payload state
		* flowing outward through `onPendingChange` instead of React setState.
		*/
		function createWorkbenchOpener(deps) {
			const open = async (request) => {
				const { serverUrl: base, pathMap: rules, cwd: workdir } = deps.inputs();
				const workspace = workdir !== void 0 ? mapPath(workdir, rules) : void 0;
				const file = mapPathForOpen(request.path, rules);
				if (file === null) {
					deps.onNotice(`${t("openUnmapped")}: ${request.path}`);
					return;
				}
				if (workspace != null) {
					const capable = await deps.probeCapability(workspace);
					if (capable) {
						const boot = deps.taggableNonce();
						if (await deps.sendOpenCommand({
							folder: workspace,
							path: file,
							nonce: request.nonce,
							line: request.line,
							column: request.column,
							...boot !== void 0 && capable >= BOOT_TAG_CAP_V ? { boot } : {}
						})) return;
					}
				}
				let authority = deps.pageHost();
				try {
					authority = new URL(base, deps.pageHref()).host || authority;
				} catch {}
				deps.onPendingChange({
					basis: `${base}#${workspace ?? ""}`,
					url: buildVscodeUrl(base, workspace ?? null, {
						file,
						authority,
						line: request.line,
						column: request.column
					})
				});
			};
			return {
				open,
				clearPending() {
					deps.onPendingChange(null);
				}
			};
		}
		//#endregion
		//#region src/client/fullBleed.ts
		/**
		* Full-bleed mounting for the `vscode` tab body.
		*
		* The docking kit draws every tab body inside a padded scroller: the docked
		* pane's `.paneBody` (`padding: 12px`) and a floated pane's `.floatBody`
		* (`padding: 10px`). Document-like tabs (the file tree, the text preview)
		* want that breathing room; a workbench wants to BE the pane — with the
		* 12px strip of panel background showing on every side, the embedded VS
		* Code reads as a picture framed on a wall instead of an app.
		*
		* The pane bodies are platform CSS-module classes, so no stable selector
		* exists to neutralize their padding from a plugin sheet — and the padding
		* differs between the docked and floated presentations anyway. Instead the
		* view measures its layout host's computed padding (the nearest
		* box-generating ancestor — the slot machinery mounts seat bodies inside a
		* `display: contents` wrapper whose box does not exist) and pulls itself
		* out into that padding: negative margins plus a width/height grown by the
		* same amounts make the body cover the host's PADDING box exactly, edge to
		* edge, with no scrollbars (the grown box never extends past the padding
		* box, so the scroller's overflow region stays empty).
		*
		* The pure halves ({@link readPadding}, {@link bleedStyle}) are unit
		* tested; the hook degrades to no override when there is nothing to bleed
		* (a zero-padded host, or jsdom's style-less computed values), leaving the
		* stylesheet sizing (`width/height: 100%`) in force.
		*
		* @module dsh-sidebar-vscode/client/fullBleed
		*/
		/**
		* Read a host's padding off a computed style. Unparsable, negative, or
		* absent values read as 0 — a host that cannot be measured is a host the
		* body simply sits inside at stylesheet sizing.
		*/
		function readPadding(style) {
			const edge = (value) => {
				const parsed = Number.parseFloat(value);
				return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
			};
			return {
				x: edge(style.paddingLeft),
				y: edge(style.paddingTop)
			};
		}
		/**
		* Whether a computed `display` generates no box of its own (the slot
		* machinery mounts seat bodies inside a `display: contents` wrapper).
		*/
		function isBoxless(display) {
			return display === "contents";
		}
		/**
		* The inline style that makes the child cover the host's padding box
		* exactly: margins pulling each edge into the padding by its width, and a
		* box grown by both paddings per axis so its far edge lands on the padding
		* box's far edge (block `width: auto` cannot be used — the sheet keeps an
		* explicit `width`, so both dimensions are stated outright).
		*/
		function bleedStyle(padding) {
			return {
				marginTop: `${-padding.y}px`,
				marginRight: `${-padding.x}px`,
				marginBottom: `${-padding.y}px`,
				marginLeft: `${-padding.x}px`,
				width: `calc(100% + ${padding.x * 2}px)`,
				height: `calc(100% + ${padding.y * 2}px)`
			};
		}
		/**
		* Measure the mounting layout host's padding and keep the measurement
		* fresh.
		*
		* The layout host is not necessarily the parent element: keyed-seat
		* bodies mount inside a `display: contents` wrapper, whose box (and
		* padding) does not exist — the walk skips those and measures the
		* nearest ancestor that generates a box (the docked pane's `.paneBody`
		* or a float's `.floatBody`), which is also the containing block the
		* negative margins and percentages resolve against.
		*
		* Measures in the ref callback and again before first paint, then
		* watches the host so a re-parent (the tab docked out into a float,
		* whose body pads differently) re-measures through its own resize
		* event; state writes are value-compared so a re-measure that changes
		* nothing re-renders nothing.
		*
		* @returns the ref to place on the bleeding element, and the inline style
		* to spread onto it (undefined until measured — the stylesheet sizing
		* governs that first paint, and a zero-padding host stays on it forever).
		*/
		function useFullBleed() {
			const [padding, setPadding] = (0, react.useState)(null);
			const nodeRef = (0, react.useRef)(null);
			/** The nearest box-generating ancestor: the element whose padding frames us. */
			const hostOf = (0, react.useCallback)(() => {
				let host = nodeRef.current?.parentElement ?? null;
				while (host !== null && isBoxless(window.getComputedStyle(host).display)) host = host.parentElement;
				return host;
			}, []);
			const measure = (0, react.useCallback)(() => {
				const host = hostOf();
				if (host === null) return;
				const next = readPadding(window.getComputedStyle(host));
				setPadding((current) => current !== null && current.x === next.x && current.y === next.y ? current : next);
			}, [hostOf]);
			const ref = (0, react.useCallback)((node) => {
				nodeRef.current = node;
				measure();
			}, [measure]);
			(0, react.useLayoutEffect)(() => {
				const host = hostOf();
				if (host === null || typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(() => {
					measure();
				});
				observer.observe(host);
				return () => {
					observer.disconnect();
				};
			});
			return {
				ref,
				style: padding === null || padding.x === 0 && padding.y === 0 ? void 0 : bleedStyle(padding)
			};
		}
		//#endregion
		//#region src/client/referencePipeline.ts
		/** Installed lander (undefined before the plugin body's apply). */
		let lander;
		/** Paste-fallback options (refreshed by the tab; empty before it renders). */
		let fallbackOptions = {};
		/** Install the module-level lander handle (plugin body; cleared on dispose). */
		function setReferenceLander(instance) {
			lander = instance;
		}
		/** The lander installed by the plugin body (undefined before apply). */
		function getReferenceLander() {
			return lander;
		}
		/** Refresh the paste-fallback options (the tab's effect path). */
		function setFallbackOptions(options) {
			fallbackOptions = options;
		}
		/** The freshest paste-fallback options (the dock reads them per paste). */
		function getFallbackOptions() {
			return fallbackOptions;
		}
		//#endregion
		//#region src/client/openChannelApi.ts
		/**
		* Client half of the extension command channel: the two same-origin fetches
		* the VSCode tab makes against THIS plugin's node-half routes
		* (`/sidebar-vscode/api/*`) to (a) probe whether the upgraded
		* `dsh.selection-reference` extension is alive in the embedded workbench and
		* (b) hand it one file-open command.
		*
		* The routes are fence-protected by the node half (same-origin GUI only) —
		* the plugin family's standard browser-trust fence. Both helpers are
		* fail-soft: any error answers `false` / `undefined`, and the VscodeView
		* falls back to the URL-payload channel — a missing route (older host half
		* not reloaded yet) or a missing extension must degrade, never break.
		*
		* @module dsh-sidebar-vscode/client/openChannelApi
		*/
		/** The base path of this plugin's node-half routes. */
		const OPEN_CHANNEL_API = "/sidebar-vscode/api";
		/** The default fetch binding (the browser's global). */
		const defaultFetch = (url, init) => fetch(url, init);
		/** POST one JSON body and answer `{ok, value}` structurally; null on any failure. */
		async function postJson(method, body, fetchLike) {
			try {
				const response = await fetchLike(`${OPEN_CHANNEL_API}/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				const parsed = await response.json().catch(() => null);
				if (!response.ok || parsed === null || typeof parsed !== "object") return null;
				const record = parsed;
				if (record.ok !== true) return null;
				return {
					ok: true,
					value: record.value
				};
			} catch {
				return null;
			}
		}
		/**
		* Whether the extension serving `folder` is alive: its capability marker
		* file must exist and be fresh (the extension refreshes it every poll tick;
		* the node half enforces the age window). Results are cached per folder for
		* a short TTL so a burst of clicks does not hammer the probe. The answer is
		* `false` when absent, else the marker's build VERSION (a truthy number) —
		* callers gate version-specific channel features on it (the open command's
		* boot tag exists from 4 up).
		*/
		const CAPABILITY_TTL_MS = 5e3;
		let capabilityCache = null;
		async function probeCapability(folder, fetchLike = defaultFetch, now = Date.now) {
			if (capabilityCache !== null && capabilityCache.folder === folder && now() - capabilityCache.at < CAPABILITY_TTL_MS) return capabilityCache.present;
			const parsed = await postJson("open.capability", { folder }, fetchLike);
			let present = false;
			if (parsed !== null && parsed.value !== null && typeof parsed.value === "object") {
				const value = parsed.value;
				if (value.present === true) present = typeof value.version === "number" && Number.isFinite(value.version) && value.version > 0 ? value.version : 2;
			}
			capabilityCache = {
				folder,
				at: now(),
				present
			};
			return present;
		}
		/**
		* Hand one open command to the extension through the node half. Answers
		* whether the command was accepted (written to the spool the extension
		* polls) — delivery itself is asynchronous by design (the extension polls).
		*/
		async function sendOpenCommand(command, fetchLike = defaultFetch) {
			return await postJson("open.request", command, fetchLike) !== null;
		}
		/**
		* Park one boot nonce with the node half BEFORE the workbench iframe
		* mounts (see `boot.begin`): the extension (≥ 0.1.2) echoes it in its
		* post-reconcile `boot.json` receipt, and {@link pollBootStatus} reports
		* the match — together they let the VscodeView keep the iframe invisible
		* until the editor area is reconciled, so a ghost file restored by VS
		* Code's own state never visibly opens just to be closed again.
		*
		* Fail-soft like every helper here: a missing route (an older host half
		* not reloaded yet) answers `{ began: false }` and the caller skips the
		* gating — the workbench boots visible with stock behavior.
		*/
		async function beginBoot(folder, nonce, fetchLike = defaultFetch) {
			const parsed = await postJson("boot.begin", {
				folder,
				nonce
			}, fetchLike);
			if (parsed === null) return {
				began: false,
				editors: null
			};
			const raw = parsed.value?.editors;
			return {
				began: true,
				editors: Array.isArray(raw) && raw.every((entry) => typeof entry === "string") ? raw : null
			};
		}
		/**
		* Whether the extension's boot receipt for `folder` echoes THIS boot's
		* nonce — i.e. the editor reconcile finished for the workbench the caller
		* is keeping invisible. Answers false on any mismatch/absence/transport
		* error: keep waiting, the caller's timeout reveals regardless.
		*/
		async function pollBootStatus(folder, nonce, fetchLike = defaultFetch) {
			const parsed = await postJson("boot.status", {
				folder,
				nonce
			}, fetchLike);
			return parsed !== null && parsed.value?.matched === true;
		}
		/**
		* Stamp one user interaction for THIS boot (route `boot.interact`): the
		* extension's reconcile close loop and ghost passes stand down once the
		* user is already interacting with the revealed workbench, so a file they
		* opened inside the reveal-vs-reconcile window is never closed as a
		* restore ghost. Fail-soft like every helper here.
		*/
		async function reportUserInteract(folder, nonce, fetchLike = defaultFetch) {
			return await postJson("boot.interact", {
				folder,
				nonce
			}, fetchLike) !== null;
		}
		/**
		* Locate the settings provider's local document through this plugin's node
		* half (`settings.document`, same fenced route family as the open channel).
		* The stock `/api/settings.openDocument` deliberately never reveals the
		* Host path to the browser — this plugin's own route does, so the settings
		* button takeover can hand the file to the embedded VS Code instead of the
		* Host OS opener (which dies with `xdg-open ENOENT` on headless containers).
		*
		* Fail-soft like every helper here: an absent settings provider, a provider
		* without a local document, an older node half (route not reloaded yet), or
		* any transport error answers null and the caller falls back to the stock
		* open behavior.
		*/
		async function fetchSettingsDocumentPath(fetchLike = defaultFetch) {
			const parsed = await postJson("settings.document", {}, fetchLike);
			if (parsed === null) return null;
			const path = parsed.value?.path;
			return typeof path === "string" && path !== "" ? path : null;
		}
		//#endregion
		//#region src/client/VscodeView.tsx
		/**
		* The `vscode` tab body of the official right Sidebar: a composition layer
		* over the workbench lifecycle controllers. Each orthogonal concern of
		* embedding the VS Code web workbench lives in its own unit-testable
		* module, and this component only wires them to the tab's props and
		* renders their state:
		*
		* - the iframe BASE resolution (same-origin mount vs direct URL, with
		*   self-healing graduation) — `workbenchBase.ts`;
		* - the session cwd resolution (the sessions registry's live snapshot —
		*   the official standard `useSessions` prop);
		* - the BOOT GATE (park a nonce before the frame mounts, await the
		*   extension's post-reconcile receipt OR the rendered editor strip —
		*   whichever settles first — rotate on in-place reloads) —
		*   `bootGate.ts` (`BootGateController`);
		* - the BOOT LOCK (hold a cross-tab Web Lock while the workbench boots,
		*   release once it has painted — two same-origin tabs racing to create
		*   VS Code's IndexedDB storage deadlock for minutes) — `bootLock.ts`
		*   (`WorkbenchBootLock`);
		* - the FOCUS FENCE (bounce uninvited focus grabs out of the frame) —
		*   `focusFence.ts` (`FocusFenceController`) over the pure rules in
		*   `focusGuard.ts`;
		* - the OPEN NAVIGATIONS (one-shot revision discipline: retire stale,
		*   defer until the gate settles) — `openRequests.ts`
		*   (`OpenRequestConsumer`) driving the two-channel opener in
		*   `workbenchLink.ts` (extension spool first, URL payload degraded);
		* - the CLIPBOARD BRIDGE (same-origin envelope interception) —
		*   `clipboardBridge.ts`;
		* - the paste-fallback options feed — `referencePipeline.ts`.
		*
		* Props are the official keyed-seat share: the framework-bound
		* `useTabInfo()` (live sidebar/panel/tab state — `tab.visible` is the
		* docked-active-or-floating visibility, `tab.navigation` carries the
		* takeover's `openTab` params with a monotonic revision), the
		* session-scoped standard props (`sessionId`, `useSessions`), and this
		* plugin's injected settings scope (the `vscode-sidebar` namespace).
		*
		* Design notes that belong to the view itself:
		* - The root mounts FULL-BLEED: the docking kit pads every tab body
		*   (`.paneBody` 12px docked, `.floatBody` 10px floated), and a workbench
		*   reads as the pane itself, not a framed picture — `fullBleed.ts`
		*   measures the host's padding and cancels it edge to edge.
		* - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
		*   the workbench is served same-origin (through the host half's built-in
		*   `/sidebar/vscode` proxy, or the deployment's gateway subpath — cookies
		*   flow, the WebSocket terminal works). The FIRST load is deferred,
		*   though, until the tab has been visible once (a workbench booted
		*   inside a hidden iframe steals the caret from the composer via its
		*   Getting Started page, so the boot waits for an audience). Note the
		*   official pane renders only the ACTIVE tab's body: switching to a
		*   sibling tab in the same pane unmounts the workbench (a reload path
		*   the boot gate + editor-ledger reconcile handle), and switching back
		*   remounts it through this same deferred-first-load rule.
		* - Settings (`serverUrl`, `pathMap`, the caps) are read from the bound
		*   scope each render (the settings card writes the document), so edits
		*   apply on the next render.
		* - All chrome follows the DSH appearance (light / dark / system) through
		*   the host's `--dsw-alias-*` tokens (the tab stylesheet lives in
		*   styles.ts, adopted by the plugin body with the body registration).
		*
		* @module dsh-sidebar-vscode/client/VscodeView
		*/
		/** One client-randomness boot nonce (printable, bounded). */
		function mintBootNonce() {
			return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
		/** Presentational: the toolbar strip (workspace path + reload + pop-out). */
		function Toolbar(props) {
			const { mapped, target, onReload } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeTab_strip",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeTab_title",
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh_vscodeTab_path",
						title: mapped ?? void 0,
						children: [
							t("workspace"),
							": ",
							mapped ?? "…"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh_vscodeTab_spacer" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsh_vscodeTab_reload",
						onClick: onReload,
						children: ["↻ ", t("reload")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: "dsh_vscodeTab_open",
						href: target,
						target: "_blank",
						rel: "noreferrer",
						children: ["⧉ ", t("openNewWindow")]
					})
				]
			});
		}
		/** Presentational: one amber degradation notice row. */
		function NoticeRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh_vscodeTab_notice",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh_vscodeTab_noticeText",
					children: props.text
				})
			});
		}
		/**
		* Render the VS Code workbench for the session's workspace.
		* @param props - the official keyed-seat share plus the settings scope.
		*/
		function VscodeView(props) {
			const { sessionId, useSessions } = props;
			const { tab } = props.useTabInfo();
			const visible = tab.visible;
			const values = useSettings(props.settings);
			const rawServerUrl = values.serverUrl;
			const effectiveServerUrl = rawServerUrl.trim() === "" ? DEFAULT_SERVER_URL : normalizeBaseUrl(rawServerUrl);
			const fullUrl = isFullServerUrl(effectiveServerUrl);
			const pathMap = parsePathMap(values.pathMap);
			const { maxLines, maxBytes } = readSettingCaps(values);
			const [flash, setFlash] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (flash === null) return;
				const timer = window.setTimeout(() => {
					setFlash(null);
				}, 3e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [flash]);
			const baseState = useWorkbenchBase(effectiveServerUrl, fullUrl, () => {
				setFlash(t("proxyFallback"));
			});
			const resolvingBase = baseState === "resolving";
			const serverUrl = baseState === "mount" ? PROXY_MOUNT : effectiveServerUrl;
			const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
			const mapped = cwd === void 0 ? void 0 : mapPath(cwd, pathMap);
			const unmapped = cwd !== void 0 && mapped === null;
			const iframeRef = (0, react.useRef)(null);
			const inputsRef = (0, react.useRef)({
				serverUrl,
				pathMap,
				cwd
			});
			inputsRef.current = {
				serverUrl,
				pathMap,
				cwd
			};
			const workspaceOf = (0, react.useCallback)(() => {
				const { pathMap: rules, cwd: workdir } = inputsRef.current;
				return workdir !== void 0 ? mapPath(workdir, rules) : null;
			}, []);
			const gateRef = (0, react.useRef)(null);
			if (gateRef.current === null) gateRef.current = new BootGateController({
				workspace: workspaceOf,
				beginBoot,
				pollBootStatus,
				domSample: () => {
					try {
						const doc = iframeRef.current?.contentDocument ?? null;
						if (doc === null) return null;
						if (doc.querySelector(".monaco-workbench") === null) return "";
						const tabs = Array.from(doc.querySelectorAll(".editor-group-container .tab"));
						if (tabs.length === 0) return "(none)";
						return tabs.map((tab) => {
							const label = tab.querySelector(".tab-label");
							return `${label !== null ? label.textContent ?? "" : ""}${tab.classList.contains("active") ? "*" : ""}`;
						}).join("|");
					} catch {
						return null;
					}
				},
				domPaths: () => {
					try {
						const doc = iframeRef.current?.contentDocument ?? null;
						if (doc === null) return null;
						if (doc.querySelector(".monaco-workbench") === null) return null;
						return Array.from(doc.querySelectorAll(".editor-group-container .tab"), (tab) => (tab.getAttribute("data-resource-name") ?? tab.querySelector(".tab-label")?.textContent ?? "").trim());
					} catch {
						return null;
					}
				},
				mintNonce: mintBootNonce,
				schedule: (callback, ms) => {
					window.setTimeout(callback, ms);
				},
				now: () => Date.now()
			});
			const gate = gateRef.current;
			const [gateState, setGateState] = (0, react.useState)(gate.getSnapshot());
			(0, react.useEffect)(() => gate.subscribe(() => {
				setGateState(gate.getSnapshot());
			}), [gate]);
			(0, react.useEffect)(() => () => {
				gate.dispose();
			}, [gate]);
			const bootLockRef = (0, react.useRef)(null);
			if (bootLockRef.current === null) bootLockRef.current = new WorkbenchBootLock({
				acquire: () => acquireWebLock(),
				rendered: () => {
					try {
						return iframeRef.current?.contentDocument?.querySelector(".monaco-workbench") != null;
					} catch {
						return false;
					}
				},
				schedule: (callback, ms) => {
					window.setTimeout(callback, ms);
				},
				now: () => Date.now()
			});
			const bootLock = bootLockRef.current;
			const [lockSnap, setLockSnap] = (0, react.useState)(bootLock.getSnapshot());
			(0, react.useEffect)(() => bootLock.subscribe(() => {
				setLockSnap(bootLock.getSnapshot());
			}), [bootLock]);
			(0, react.useEffect)(() => () => {
				bootLock.dispose();
			}, [bootLock]);
			const [pendingOpen, setPendingOpen] = (0, react.useState)(null);
			const openerRef = (0, react.useRef)(null);
			if (openerRef.current === null) openerRef.current = createWorkbenchOpener({
				inputs: () => ({
					serverUrl: inputsRef.current.serverUrl,
					pathMap: inputsRef.current.pathMap,
					cwd: inputsRef.current.cwd
				}),
				taggableNonce: () => gateRef.current?.taggableNonce(),
				onNotice: (message) => {
					setFlash(message);
				},
				onPendingChange: (pending) => {
					setPendingOpen(pending);
				},
				probeCapability,
				sendOpenCommand,
				pageHref: () => window.location.href,
				pageHost: () => window.location.host
			});
			const opener = openerRef.current;
			const consumerRef = (0, react.useRef)(null);
			if (consumerRef.current === null) consumerRef.current = new OpenRequestConsumer({
				execute: (request) => openerRef.current?.open(request),
				gateSettled: () => gateRef.current !== null && gateRef.current.settled()
			});
			const navigation = tab.navigation;
			(0, react.useEffect)(() => {
				consumerRef.current?.update(navigation, sessionId, tab.id);
			}, [
				navigation.revision,
				navigation.params,
				sessionId,
				tab.id,
				gateState.phase
			]);
			const targetBasis = `${serverUrl}#${mapped ?? ""}`;
			const effectivePending = pendingOpen !== null && pendingOpen.basis === targetBasis ? pendingOpen : null;
			const target = effectivePending !== null ? effectivePending.url : buildVscodeUrl(serverUrl, mapped ?? null);
			const [everVisible, setEverVisible] = (0, react.useState)(visible);
			(0, react.useEffect)(() => {
				if (visible) setEverVisible(true);
			}, [visible]);
			const ready = cwd !== void 0 && !resolvingBase && everVisible;
			const [loaded, setLoaded] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				setLoaded(false);
			}, [target]);
			const loadKey = `${target}#${nonce}`;
			const bootGate = gateState.key === loadKey ? gateState : {
				key: loadKey,
				phase: "pending",
				nonce: "",
				workspace: "",
				ledger: null,
				revealed: false
			};
			const revealed = bootGate.revealed;
			const bootHidden = (bootGate.phase === "hidden" || bootGate.phase === "dom" || bootGate.phase === "rotating") && !revealed;
			const bootLockHeld = lockSnap.key === loadKey && lockSnap.state === "held";
			const lockQueued = lockSnap.key === loadKey && lockSnap.state === "queued";
			(0, react.useEffect)(() => {
				if (!ready) return;
				bootLock.begin(loadKey);
				return () => {
					bootLock.end();
				};
			}, [
				ready,
				loadKey,
				bootLock
			]);
			(0, react.useEffect)(() => {
				if (!ready || !bootLockHeld) return;
				gate.begin(loadKey);
				return () => {
					gate.fence();
				};
			}, [
				ready,
				bootLockHeld,
				loadKey,
				gate
			]);
			(0, react.useEffect)(() => {
				if (!revealed || bootGate.phase !== "hidden" || bootGate.nonce === "") return;
				const doc = iframeRef.current?.contentDocument ?? null;
				if (doc === null) return;
				const options = { capture: true };
				let done = false;
				const cleanup = () => {
					if (done) return;
					done = true;
					doc.removeEventListener("pointerdown", gesture, options);
					doc.removeEventListener("keydown", gesture, options);
				};
				const gesture = () => {
					cleanup();
					const { pathMap: rules, cwd: workdir } = inputsRef.current;
					const workspace = workdir !== void 0 ? mapPath(workdir, rules) : null;
					if (workspace !== null) reportUserInteract(workspace, bootGate.nonce);
				};
				doc.addEventListener("pointerdown", gesture, options);
				doc.addEventListener("keydown", gesture, options);
				return cleanup;
			}, [
				revealed,
				bootGate.phase,
				bootGate.nonce,
				loadKey
			]);
			(0, react.useEffect)(() => {
				setFallbackOptions({
					reverseRules: pathMap,
					cwd,
					maxLines,
					maxBytes
				});
			});
			const handlePayload = (0, react.useCallback)((payload) => {
				return (async () => {
					const lander = getReferenceLander();
					if (lander === void 0) {
						setFlash(t("injectFailed"));
						return false;
					}
					const outcome = await lander(sessionId, payload, {
						reverseRules: inputsRef.current.pathMap,
						cwd: inputsRef.current.cwd,
						maxLines,
						maxBytes
					});
					if (outcome.failed) {
						setFlash(t("injectFailed"));
						return false;
					}
					if (outcome.textFallback > 0) setFlash(t("injectedAsText"));
					return true;
				})();
			}, [
				sessionId,
				maxLines,
				maxBytes
			]);
			const bridgeDisposer = (0, react.useRef)(null);
			const installBridge = (0, react.useCallback)(() => {
				bridgeDisposer.current?.();
				bridgeDisposer.current = null;
				const frame = iframeRef.current;
				if (frame === null) return;
				bridgeDisposer.current = installClipboardBridge(frame, handlePayload);
			}, [handlePayload]);
			(0, react.useEffect)(() => () => {
				bridgeDisposer.current?.();
				bridgeDisposer.current = null;
			}, []);
			(0, react.useEffect)(() => {
				if (loaded) installBridge();
			}, [loaded, installBridge]);
			const fenceRef = (0, react.useRef)(null);
			if (fenceRef.current === null) fenceRef.current = new FocusFenceController({
				getFrame: () => iframeRef.current,
				now: () => Date.now(),
				setTimeout: (callback, ms) => {
					window.setTimeout(callback, ms);
				}
			}, { bornVisible: visible });
			const fence = fenceRef.current;
			(0, react.useEffect)(() => {
				fence.setVisible(visible);
			}, [fence, visible]);
			(0, react.useEffect)(() => fence.attach(), [fence]);
			const handleFrameLoad = (0, react.useCallback)(() => {
				setLoaded(true);
				installBridge();
				gate.frameLoaded();
				fence.onFrameLoad();
			}, [
				installBridge,
				gate,
				fence
			]);
			const bleed = useFullBleed();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeTab_root",
				ref: bleed.ref,
				style: bleed.style,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toolbar, {
						mapped,
						target,
						onReload: () => {
							opener.clearPending();
							setLoaded(false);
							setNonce(nonce + 1);
						}
					}),
					unmapped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeRow, { text: t("unmapped") }),
					flash !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeRow, { text: flash }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh_vscodeTab_surface",
						children: [ready && bootLockHeld && bootGate.phase !== "pending" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
							ref: iframeRef,
							src: target,
							title: "VSCode",
							onLoad: handleFrameLoad,
							className: "dsh_vscodeTab_frame",
							style: bootHidden ? {
								opacity: 0,
								pointerEvents: "none"
							} : void 0
						}, loadKey) : null, !ready || !loaded || bootHidden ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh_vscodeTab_loading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("loading") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh_vscodeTab_loadingHint",
								children: lockQueued ? t("bootQueue") : t("loadHint")
							})]
						}) : null]
					})
				]
			});
		}
		//#endregion
		//#region src/client/icons.tsx
		/**
		* The VS Code logo (simple-icons geometry, 24×24 viewBox) at the requested
		* pixel size.
		* @param size - square edge length in CSS pixels.
		*/
		function VscodeIcon(size) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .325 8.74L3.899 12 .325 15.26a1 1 0 0 0 .002 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" })
			});
		}
		/**
		* The guide-entry glyph: {@link VscodeIcon} dressed as the component the
		* official `SidebarRightGuideEntry.icon` seat expects
		* (`ComponentType<IconProps>`), drawn at the sidebar's own 16px scale.
		*/
		function VscodeGuideIcon({ size = 16, className }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className,
				"aria-hidden": "true",
				style: { display: "inline-flex" },
				children: VscodeIcon(size)
			});
		}
		/**
		* The document glyph of one composer reference chip (16×16 viewBox,
		* stroked) — the file icon of a vscode-selection chip.
		*/
		function FileRefIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				className: "dsh_vscodeRef_icon",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M3 2.5A1.5 1.5 0 0 1 4.5 1h3l3 3v9.5A1.5 1.5 0 0 1 9 15H4.5A1.5 1.5 0 0 1 3 13.5v-11Z",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M7.5 1v3h3",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M13 4.5v8A1.5 1.5 0 0 1 11.5 14H5",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.2"
					})
				]
			});
		}
		/**
		* The folder glyph of one composer resource chip (16×16 viewBox, stroked) —
		* the icon of a vscode file/folder reference citing a directory.
		*/
		function FolderRefIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				className: "dsh_vscodeRef_icon",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9Z",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.2"
				})
			});
		}
		/**
		* The close (×) glyph of one reference chip's remove button (16×16
		* viewBox, stroked).
		*/
		function XIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M4 4l8 8M12 4l-8 8",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})
			});
		}
		//#endregion
		//#region src/client/definition.ts
		/**
		* Stage one of this plugin's registration with the official right
		* Sidebar: what the `vscode` tab type IS.
		*
		* The type is a PAGE, not a viewer: it claims no resource address, because
		* the workbench is ONE surface per session (a second iframe racing the
		* first re-opens VS Code's IndexedDB and deadlocks — see bootLock.ts),
		* while the registry's identity rule would mint one tab per address. The
		* guide page offers it as an entry box (点选即在引导标签的位置打开),
		* chat-originated file opens reach it through the `openResource` takeover
		* (`openIntercept.ts`) as `openTab('vscode', { params })`, and the params
		* arrive at the body as `tab.navigation.params` with a monotonic
		* `revision` (the one-shot open command's vehicle).
		*
		* Structural over the official `SidebarRightTabDefinition` — the client
		* bundle keeps its zero-official-value-imports discipline; the shapes
		* match the registry's contract exactly.
		*
		* @module dsh-sidebar-vscode/client/definition
		*/
		/** This implementation's identity in the tab system, and the key its body registers under. */
		const VSCODE_ID = "dsh-sidebar-vscode";
		/** The tab kind this plugin owns (`openTab('vscode')` names it). */
		const VSCODE_KIND = "vscode";
		/**
		* The `vscode` type's registry definition.
		* @returns the definition to register into `ctx.sidebarRightTabs`.
		*/
		function vscodeTabDefinition() {
			return {
				id: VSCODE_ID,
				kind: VSCODE_KIND,
				priority: "extension",
				title: () => t("title"),
				guide: [{
					order: 20,
					title: () => t("guideTitle"),
					description: () => t("guideDescription"),
					icon: VscodeGuideIcon
				}]
			};
		}
		//#endregion
		//#region src/client/openBlocklist.ts
		/**
		* The open-blocklist contract: file types the chat-open takeover must NOT
		* claim. When the `openAsDefault` switch is on, every chat-originated file
		* open (tool-row path links, prose file mentions, produced-files chips)
		* is rerouted into the VSCode tab — but some files (Office documents,
		* images, PDFs) belong to the sidebar's viewer surface, not a code
		* editor. This module owns the whole pure contract both sides share:
		*
		* - the stored shape (the `vscode-sidebar` settings section's
		* `openBlocklist` field — a string array of file extensions) and its
		* base default (the seven common binary types below; the official
		* settings layering makes unset resolve to that base, so an explicit
		* `[]` remains the stored decision "block nothing");
		* - normalization (case-insensitive, dot-tolerant, charset-checked) and
		*   matching (a path is blocked when its lowercased BASE NAME ends with
		*   `'.' + extension` — one rule that covers single-part (`pdf`),
		*   treats `a.notpdf` as NOT matching `pdf`, needs no special case for
		*   extension-less files, and supports multi-part extensions such as
		*   `tar.gz` when the entry itself carries the dot).
		*
		* The read side is per-call (readOpenBlocklist): the takeover gate calls
		* it on every open, so settings edits apply to the very next click with
		* no re-wiring.
		*
		* Scope: ONLY the chat-open seam (openIntercept.ts's wrapper). The
		* settings-page「打开配置文件」takeover (settingsTakeover.ts)
		* deliberately ignores this list — it opens a text document through its
		* own resolve route, and honoring the list there would let a blacklisted
		* `yaml` break the button.
		*
		* Dependency-free by design so the contract is unit-testable in isolation.
		*
		* @module dsh-sidebar-vscode/client/openBlocklist
		*/
		/** The settings field the blocklist persists under (kept as the test handle). */
		const OPEN_BLOCKLIST_KEY = "openBlocklist";
		/**
		* Suggestions the settings row's dropdown offers beyond what is already
		* listed: the defaults plus other types a code editor renders poorly.
		* Order matters only for display; the input stays free-form.
		*/
		const BLOCKLIST_SUGGESTIONS = [
			...DEFAULT_OPEN_BLOCKLIST,
			"gif",
			"webp",
			"bmp",
			"ico",
			"svg",
			"csv",
			"zip",
			"gz",
			"tar.gz",
			"7z",
			"exe",
			"dll",
			"so",
			"dylib",
			"mp4",
			"mov",
			"mp3",
			"wav"
		];
		/** Longest accepted extension (multi-part suffixes included). */
		const MAX_EXTENSION_LENGTH = 16;
		/**
		* Normalize one user-entered extension: trim, lowercase, drop a leading
		* '.'; reject anything but letters/digits with internal '.'/'-' (a
		* multi-part entry like `tar.gz` stays one entry) and lengths outside
		* 1–16. Returns null for junk the row must refuse to add.
		*/
		function normalizeExtension(raw) {
			let value = raw.trim().toLowerCase();
			while (value.startsWith(".")) value = value.slice(1);
			if (value.length < 1 || value.length > MAX_EXTENSION_LENGTH) return null;
			if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value)) return null;
			return value;
		}
		/**
		* Parse the stored `openBlocklist` value. A non-array (unset key, string,
		* number, null) yields the code default; an array is normalized, deduped
		* (first-seen order), and capped at {@link OPEN_BLOCKLIST_MAX_ENTRIES}.
		* An explicit empty array passes through unchanged — "block nothing" is a
		* stored decision, not a missing one.
		*/
		function parseOpenBlocklist(raw) {
			if (!Array.isArray(raw)) return DEFAULT_OPEN_BLOCKLIST;
			const out = [];
			const seen = /* @__PURE__ */ new Set();
			for (const entry of raw) {
				if (typeof entry !== "string") continue;
				const normalized = normalizeExtension(entry);
				if (normalized === null || seen.has(normalized)) continue;
				if (out.length >= 64) break;
				seen.add(normalized);
				out.push(normalized);
			}
			return out;
		}
		/** The file name of a path (both separators), before any extension match. */
		function baseNameOf(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/**
		* Whether one path is blocked by the list: the lowercased base name ends
		* with `'.' + extension` for some entry. Dot files need their own entry
		* (`.gitignore` matches only a `gitignore` entry — a plain `ignore` entry
		* does not hit); an extension-less base name never matches; an empty
		* entry can never match (it is rejected at parse time, and re-checked
		* here so hand-built lists stay safe).
		*/
		function isBlockedPath(path, list) {
			const name = baseNameOf(path.trim()).toLowerCase();
			if (name === "" || !name.includes(".")) return false;
			for (const extension of list) {
				if (extension === "") continue;
				if (name.endsWith(`.${extension}`)) return true;
			}
			return false;
		}
		/**
		* The suggestion entries not already listed — the settings row's dropdown
		* contents. First-seen order, deduped against the current list.
		*/
		function blocklistSuggestions(current) {
			const listed = new Set(current);
			return BLOCKLIST_SUGGESTIONS.filter((entry) => !listed.has(entry));
		}
		/**
		* The effective blocklist for one open decision: the resolved
		* `vscode-sidebar` section's `openBlocklist` value parsed per call
		* (absent scope = the code default, matching readSettings's
		* base-fallback contract).
		*/
		function readOpenBlocklist(scope) {
			return parseOpenBlocklist(readSettings(scope).openBlocklist);
		}
		//#endregion
		//#region src/client/openIntercept.ts
		/** The scheme+type prefix every file address opens with. */
		const FILE_ADDRESS_PREFIX = "dsh-resource://file/";
		/** Whether a decoded first path segment is a Windows drive (`C:`). */
		function isDriveSegment(segment) {
			return segment !== void 0 && /^[A-Za-z]:$/.test(segment);
		}
		/**
		* Read a file address back into its parts (the official grammar:
		* component-encoded segments, `:` literal for drive letters, a UNC
		* path's empty first segment preserved).
		* @param address - a candidate address.
		* @returns the parts, or `undefined` when the string is not a
		* `dsh-resource://file/` URI in a known scope with a path, or a segment
		* is not validly encoded.
		*/
		function parseFileAddress(address) {
			if (!address.startsWith(FILE_ADDRESS_PREFIX)) return void 0;
			try {
				const url = new URL(address);
				if (url.protocol !== "dsh-resource:" || url.host !== "file") return void 0;
				const [, scope, ...rest] = url.pathname.split("/");
				if (scope === "session") {
					const [id, ...segments] = rest;
					if (id === void 0 || id === "" || segments.length === 0) return void 0;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join("/")
					};
				}
				if (scope === "absolute") {
					const unc = rest[0] === "" && rest.length > 1;
					const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent);
					if (segments.length === 0 || segments[0] === "") return void 0;
					if (unc) return {
						scope,
						path: `//${segments.join("/")}`
					};
					return {
						scope,
						path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`
					};
				}
				return;
			} catch {
				return;
			}
		}
		/** Whether a path is absolute (POSIX root, drive letter, or UNC share). */
		function isAbsoluteLike(path) {
			if (path.startsWith("/")) return true;
			if (path.startsWith("\\\\")) return true;
			return /^[a-zA-Z]:[\\/]/.test(path);
		}
		/**
		* Resolve a (possibly relative) path against the session cwd — the join
		* the session-scope translation needs (the official `fileAddressFor`
		* folded this step into address construction; the takeover unfolds it
		* again on the way back).
		*/
		function resolveAgainst(cwd, path) {
			if (isAbsoluteLike(path)) return path;
			const base = cwd ?? "";
			if (base === "") return path;
			const separator = base.includes("\\") ? "\\" : "/";
			return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
		}
		/** The 1-based line of one open's `params`, when the caller gave a sane one. */
		function readLine(options) {
			const line = (options?.params)?.line;
			if (typeof line !== "number" || !Number.isFinite(line) || line <= 0) return void 0;
			return Math.floor(line);
		}
		/**
		* Wrap `ctx.sidebarRight.openResource` — the official sidebar's public
		* resource funnel — with the workbench takeover.
		*
		* Fail-soft at the seam: a service whose `openResource` does not resolve
		* to a function, or whose `openTab` does not, installs nothing (the stock
		* funnel stands). A claimed open that throws inside `openTab` also falls
		* back to the original — a stock open beats a lost one.
		*
		* @param service - the navigation controller instance (`ctx.sidebarRight`).
		* @param deps - per-call takeover decisions.
		* @returns the disposer removing the shadow while it is still ours
		* (HMR-safe; a later re-shadow by anyone else is left standing).
		*/
		function wrapSidebarRightOpenResource(service, deps) {
			const original = service.openResource;
			const openTab = service.openTab;
			if (typeof original !== "function" || typeof openTab !== "function") return () => {};
			const saved = Object.getOwnPropertyDescriptor(service, "openResource");
			const fallthrough = (address, options) => {
				original.call(service, address, options);
			};
			const wrapped = (address, options) => {
				if (!deps.takeoverEnabled()) return fallthrough(address, options);
				if (typeof address !== "string" || !address.startsWith(FILE_ADDRESS_PREFIX)) return fallthrough(address, options);
				const parsed = parseFileAddress(address);
				if (parsed === void 0) return fallthrough(address, options);
				let absolute;
				if (parsed.scope === "absolute") absolute = parsed.path;
				else {
					const cwd = deps.cwdOf(parsed.sessionId);
					if (cwd === void 0 || cwd === "") return fallthrough(address, options);
					absolute = resolveAgainst(cwd, parsed.path);
				}
				if (deps.blocked(absolute)) return fallthrough(address, options);
				const line = readLine(options);
				const params = {
					path: absolute,
					...line !== void 0 ? { line } : {}
				};
				try {
					openTab.call(service, deps.kind, { params });
				} catch {
					fallthrough(address, options);
				}
			};
			Object.defineProperty(service, "openResource", {
				configurable: true,
				enumerable: true,
				writable: true,
				value: wrapped
			});
			return () => {
				if (Object.getOwnPropertyDescriptor(service, "openResource")?.value !== wrapped) return;
				if (saved === void 0) delete service.openResource;
				else Object.defineProperty(service, "openResource", saved);
			};
		}
		//#endregion
		//#region src/client/expandTakeover.ts
		/**
		* The expand-button takeover of the OFFICIAL right Sidebar: one capture-phase
		* document listener that turns the collapsed column's expand control into a
		* direct workbench reveal, behind the same `openAsDefault` switch as the
		* chat-open and settings-page takeovers.
		*
		* Why a DOM seam: the expand control (`ExpandButton.tsx` of
		* `@deepseek-ai/dsh-client-ui-sidebar-right`) lives in the conversation
		* header's corner seat and acts on the per-session store it shares with the
		* panel — `actions.setExpanded(sessionId, true)` — a store the slot runtime
		* mints per session and no public service exposes. The controller's own
		* `toggleExpanded` is not the button's path either. The ONE externally
		* observable, stable marker of that control is its dedicated attribute
		* (`data-sidebar-right-expand`, spelled on nothing else), so the takeover
		* captures clicks that bubble from it at the document's capture phase —
		* before the React root's bubble-phase handler — and re-issues the gesture
		* as `sidebarRight.openTab('vscode')`:
		*
		* - `openTab` reveals or creates the session's ONE workbench page tab
		*   (the registry deduplicates pages by kind) and expands the column in
		*   the same step — the official "content the user cannot see is not
		*   opened" rule — so the stock `setExpanded(true)` the button would have
		*   run is subsumed, and the click is consumed (stopPropagation +
		*   preventDefault) only AFTER the workbench open succeeded;
		* - a declined click (switch off) reaches the stock handler untouched and
		*   the column expands to whatever it last showed (the seeded guide on a
		*   fresh surface — with several registered guide entries the official
		*   seed rule resolves to the guide, never to this plugin's page);
		* - a failed open (no mounted seat, a thrown `openTab`) lets the stock
		*   expand proceed — a plain expand beats a dead button.
		*
		* The listener is installed for the plugin's lifetime and removed on
		* dispose (HMR-safe); everything time-varying (the switch) is read per
		* click, so flipping the setting applies to the very next press.
		*
		* @module dsh-sidebar-vscode/client/expandTakeover
		*/
		/** The official expand control's stable marker (spelled on nothing else). */
		const EXPAND_BUTTON_SELECTOR = "[data-sidebar-right-expand]";
		/**
		* Whether one event target lives inside the official expand control.
		* @param target - the event's target (any node; non-element targets match
		* nothing).
		* @param selector - the expand control's selector.
		* @returns whether the click belongs to the expand control.
		*/
		function isExpandControlClick(target, selector = EXPAND_BUTTON_SELECTOR) {
			if (target === null || typeof target !== "object") return false;
			const closest = target.closest;
			if (typeof closest !== "function") return false;
			try {
				return closest.call(target, selector) !== null;
			} catch {
				return false;
			}
		}
		/**
		* Consider one capture-phase click for the workbench takeover.
		*
		* Pure decision + act: claims nothing while the switch is off or the click
		* is not the expand control's; otherwise opens the workbench and, only once
		* that succeeded, consumes the click so the stock expand handler never
		* runs. An `openWorkbench` throw is swallowed here on purpose — the stock
		* expand is the correct fallback and must still receive the event.
		*
		* @param event - the capture-phase click event.
		* @param deps - per-click takeover decisions.
		* @param selector - the expand control's selector.
		* @returns whether the click was claimed (opened + consumed).
		*/
		function claimExpandClick(event, deps, selector = EXPAND_BUTTON_SELECTOR) {
			if (!deps.takeoverEnabled()) return false;
			if (!isExpandControlClick(event.target, selector)) return false;
			try {
				deps.openWorkbench();
			} catch {
				return false;
			}
			event.stopPropagation();
			event.preventDefault();
			return true;
		}
		/**
		* Install the expand-button takeover on one document-like target.
		*
		* Fail-soft: an environment with no `document` (SSR, tests) installs
		* nothing. The listener rides the CAPTURE phase so it decides before any
		* bubble-phase React handler; removal restores nothing else (the listener
		* is wholly ours).
		*
		* @param deps - per-click takeover decisions (the shared gate + the
		* workbench open).
		* @param target - the listener target (the page document by default).
		* @param selector - the expand control's selector.
		* @returns the disposer removing the listener (HMR-safe, idempotent).
		*/
		function installExpandTakeover(deps, target = typeof document === "undefined" ? void 0 : document, selector = EXPAND_BUTTON_SELECTOR) {
			if (target === void 0) return () => {};
			const onClick = (event) => {
				claimExpandClick(event, deps, selector);
			};
			target.addEventListener("click", onClick, { capture: true });
			return () => {
				target.removeEventListener("click", onClick, { capture: true });
			};
		}
		//#endregion
		//#region src/client/settingsTakeover.ts
		/**
		* The settings-page takeover seam: a wrapper around the wire method behind
		* the settings page's「打开配置文件」button — the gateway-era
		* `remote.settings.openSettingsDocument` Host Remote, or the legacy
		* `connection.api.settings.openDocument` client-service member — so the
		* click lands the configuration file inside the embedded VS Code instead of
		* the Host OS opener.
		*
		* Why this seam exists: the stock button asks the Host to hand
		* `$DSH_HOME/settings.yaml` to the platform opener (macOS: a text editor;
		* Linux: the desktop file association — `spawn xdg-open ENOENT` on the
		* headless containers DSH typically runs in). The method's contract
		* deliberately carries no path, so the browser cannot choose a Host target;
		* this plugin instead resolves the document through its OWN fenced node-half
		* route (`settings.document`, see src/client/openChannelApi.ts) and reroutes
		* the open exactly like the chat-side seam (openIntercept.ts):
		* `sidebarRight.openTab('vscode', { params: { path } })` — the official
		* sidebar reveals the workbench tab and hands it the navigation. An absolute
		* path needs no mapping-rule match (mapPathForOpen passes unmatched paths
		* through), so the home-side settings.yaml opens as-is in the default
		* same-container topology.
		*
		* Fail-soft by construction: the wrapper declines (gate off, settings
		* provider absent, node half not reloaded yet, any transport error) by
		* calling the untouched original — and a page whose runtime carries neither
		* seam (no `remote.settings` namespace, no `api.settings.openDocument`
		* member) gets no wrapper installed at all (see wrapSettingsOpenDocument /
		* wrapRemoteOpenSettingsDocument) — the button never breaks because of this
		* plugin, it merely keeps its stock behavior.
		*
		* Dependency-free by design (mirrors openIntercept.ts's wrapper) so the
		* takeover logic is unit-testable in isolation.
		*
		* @module dsh-sidebar-vscode/client/settingsTakeover
		*/
		/**
		* Redefine one gateway-namespace method with an intercepting replacement,
		* chaining onto WHATEVER property shape is installed.
		*
		* Two shapes reach this seam, and both must compose:
		*
		* - the gateway's own mount (`remote.<ns>.<method>`): configurable,
		*   getter-only own properties — no setter, so plain assignment throws —
		*   where every getter access returns a FRESH invocation closure resolved
		*   against the live mount. This helper redefines the property with its own
		*   getter that re-invokes the original getter on every access and hands the
		*   yielded closure through `makeInterceptor`, so each caller still resolves
		*   a fresh chain against the live mount — exactly the stock semantics.
		* - a peer's VALUE-property shadow: another plugin wrapping the same seam
		*   by capturing the current closure and redefining the property as
		*   `{ writable: true, value: wrapped }` — a plain function, no getter. A
		*   getter-only redefinition cannot chain onto that (the descriptor has no
		*   `get`), so here the captured `descriptor.value` plays the original: the
		*   interceptor wraps it and is installed as a value property again, so
		*   whichever plugin installs LATER sits outermost and sees each call first.
		*
		* The disposer restores the saved descriptor, but only while OUR replacement
		* is still the installed one: the gateway deletes the property when it
		* unmounts the method and re-creates it on remount, and clobbering either
		* state with the saved (stale) descriptor would resurrect a dead mount.
		*
		* Fail-soft at the seam: a target carrying no such own property, a descriptor
		* whose getter does not yield a callable, or a value that is not a function
		* installs nothing.
		*
		* @param target - the namespace service object (or any face carrying the method).
		* @param method - the own property name to redefine.
		* @param makeInterceptor - wraps one original closure; on the getter path it
		* is invoked once per property access (the interceptor never holds a stale
		* mount), on the value path once at install.
		* @returns the disposer restoring the original descriptor (HMR-safe).
		*/
		function redefineGetterMethod(target, method, makeInterceptor) {
			const descriptor = Object.getOwnPropertyDescriptor(target, method);
			if (descriptor === void 0) return () => {};
			if (typeof descriptor.get === "function") {
				if (typeof descriptor.get.call(target) !== "function") return () => {};
				const readOriginal = descriptor.get;
				const wrapperGetter = () => {
					return makeInterceptor(readOriginal.call(target));
				};
				Object.defineProperty(target, method, {
					configurable: true,
					enumerable: descriptor.enumerable,
					get: wrapperGetter
				});
				return () => {
					if (Object.getOwnPropertyDescriptor(target, method)?.get === wrapperGetter) Object.defineProperty(target, method, descriptor);
				};
			}
			if (typeof descriptor.value === "function") {
				const original = descriptor.value;
				const wrapped = makeInterceptor(original);
				Object.defineProperty(target, method, {
					configurable: true,
					enumerable: descriptor.enumerable,
					writable: true,
					value: wrapped
				});
				return () => {
					if (Object.getOwnPropertyDescriptor(target, method)?.value === wrapped) Object.defineProperty(target, method, descriptor);
				};
			}
			return () => {};
		}
		/**
		* Wrap `connection.api.settings.openDocument` with the settings-button
		* takeover.
		*
		* Fail-soft at the SEAM itself, not only per call: `api` may be undefined
		* and the settings member may be absent (a web shell whose connection
		* service carries a different shape — older, newer, or third-party — than
		* this plugin was authored against). The takeover is an optional
		* enhancement, so a missing seam installs nothing and the button keeps its
		* stock behavior; the plugin must never fail activation over it.
		*
		* Chain-safety: the disposer restores the RAW original reference (the same
		* contract as wrapWorkspacesOpenPath), so this wrapper composes with any
		* other patch of the same member in any install/dispose order, and HMR
		* re-apply cannot strand a stale closure.
		*
		* @param api - the client connection's settings API member (mutated in
		* place; undefined or seam-less slices are declined with a no-op).
		* @param deps - per-call takeover decisions (the same gate as the chat seams').
		* @returns the disposer restoring the original method.
		*/
		/**
		* The settings-open takeover body both era wrappers share: gate → resolve
		* the document through this plugin's fenced node-half route → reroute
		* into the VSCode tab (+ close the dialog) → answer with the seam's
		* synthesized success. Every decline (gate off, provider absent, route
		* missing, transport error) falls back to the untouched original — the
		* stock behavior is always the correct fallback, so the button never
		* breaks because of this plugin.
		*
		* Type-parameterized by the seam's answer shape: the legacy member
		* resolves a `SettingsOpenResponse`, the gateway-era remote a
		* `RemoteSettingsOpenResult`; `fallthrough` invokes the seam's own
		* original, `success` builds its receipt (both production callers read
		* `result.ok` alone to clear the button's busy state; the workbench open
		* itself is asynchronous by design — extension polling / one payload
		* reload — and a synthesized acknowledgment must not wait for, or
		* surface, its outcome).
		*/
		async function settingsOpenRoute(deps, fallthrough, success) {
			if (!deps.takeoverEnabled()) return await fallthrough();
			const path = await deps.resolvePath();
			if (path === null || path === "") return await fallthrough();
			deps.reroute(path);
			deps.closeDialog?.();
			return success();
		}
		function wrapSettingsOpenDocument(api, deps) {
			const settings = api?.settings;
			if (settings === void 0 || typeof settings.openDocument !== "function") return () => {};
			const original = settings.openDocument;
			settings.openDocument = (payload, signal) => settingsOpenRoute(deps, () => original.call(settings, payload, signal), () => ({
				rpcId: "",
				result: {
					ok: true,
					value: { opened: true }
				}
			}));
			return () => {
				settings.openDocument = original;
			};
		}
		/**
		* Wrap `remote.settings.openSettingsDocument` — the settings-document funnel
		* of the gateway-era client runtime — with the SAME takeover gate and
		* reroute as the legacy `connection.api.settings.openDocument` wrapper above.
		*
		* Why this seam exists: the runtime that retired `connection.api` routes the
		* button through the `settings/openSettingsDocument` Host Remote
		* (SettingsDocumentStore.open is its only production caller), which hands the
		* materialized document to the Host's native opener (`xdg-open` — dead on a
		* headless container). The legacy wrapper above therefore installs nothing on
		* this runtime; on the pre-gateway runtime the reverse holds — the
		* `remote.settings` namespace never appears and the legacy member keeps the
		* takeover. Exactly one of the two ever intercepts.
		*
		* Mechanics (property redefinition of the gateway's getter-only namespace
		* methods, per-access original, restore-only-ours) live in
		* `redefineGetterMethod` (openIntercept.ts). A taken-over call resolves with
		* the native receipt's success shape so the button's busy state clears
		* without surfacing the Host opener's failure.
		*
		* @param settings - the remote settings namespace service to wrap.
		* @param deps - per-call takeover decisions (the same gate as the chat seams').
		* @returns the disposer restoring the original property descriptor (HMR-safe).
		*/
		function wrapRemoteOpenSettingsDocument(settings, deps) {
			return redefineGetterMethod(settings, "openSettingsDocument", (original) => (signal) => settingsOpenRoute(deps, () => original(signal), () => ({
				ok: true,
				value: { opened: true }
			})));
		}
		/**
		* Close the host settings dialog after a taken-over open.
		*
		* The settings shell keeps its open state component-local — no service or
		* store exposes a close — but its modal panel mounts a document-level
		* Escape listener whose lifetime is exactly the panel's (see
		* SettingsRoot.tsx's SettingsPanel). A synthetic Escape keydown is therefore
		* the one externally reachable close path, and it rides the dialog's own
		* semantics: the listener exists only while the dialog is open, so this
		* cannot close anything through the settings shell itself, and an
		* already-closed dialog makes it a no-op. (A synthetic document-level
		* Escape is not scoped, though: any OTHER concurrently-mounted
		* document/window-level Escape listener receives it too — a stacked
		* overlay inside the settings dialog would close along with it; the
		* settings modal excludes other overlays in practice.)
		*
		* Fail-soft like everything here: environments without a constructible
		* KeyboardEvent (or any dispatch failure) simply leave the dialog open.
		*
		* @param doc - the document to dispatch on (the page global by default).
		* @param makeEvent - the event factory (injectable for tests).
		*/
		function closeSettingsDialog(doc = typeof document === "undefined" ? void 0 : document, makeEvent = (type, init) => new KeyboardEvent(type, init)) {
			if (doc === void 0) return;
			try {
				doc.dispatchEvent(makeEvent("keydown", {
					key: "Escape",
					bubbles: true
				}));
			} catch {}
		}
		//#endregion
		//#region src/client/takeovers.ts
		/**
		* The takeover family's installation for the OFFICIAL right Sidebar: the
		* seams that reroute a host-side file open into the embedded VS Code
		* workbench, wired through ONE gate and live settings reads.
		*
		* - **The chat-open seam** (`openIntercept.ts`): `ctx.sidebarRight
		*   .openResource` — the official navigation controller's public resource
		*   funnel and the one route every chat-originated open of the current
		*   runtime takes (ui-chat's `openFile`: tool-row path links and prose
		*   mentions; the deliverables row's produced-files chips). The wrapper
		*   claims the open for the workbench (`openTab('vscode', { params })`)
		*   or falls through untouched — switch off, blocklisted path, or an
		*   unresolvable session scope — to the stock registry routing, where
		*   the official text preview (or a future viewer plugin) claims it.
		* - **The settings open-document seam** (`settingsTakeover.ts`): the
		*   settings page's「打开配置文件」click resolves the document through
		*   this plugin's own fenced node-half route and opens it in the
		*   workbench tab, closing the settings dialog behind it. Two era-specific
		*   seams (`remote.settings.openSettingsDocument` vs the legacy
		*   `connection.api.settings.openDocument`); exactly one ever intercepts.
		* - **The expand-button seam** (`expandTakeover.ts`): the collapsed
		*   column's header control (the one node carrying
		*   `data-sidebar-right-expand`) captured at the document's capture phase
		*   and re-issued as `openTab('vscode')`, so a switch-on deployment's
		*   expand click lands directly on the workbench tab instead of the seeded
		*   guide — the stock `setExpanded` the button would have run is subsumed
		*   by the open's own expansion, and a declined or failed claim leaves the
		*   stock expand untouched.
		*
		* Cross-cutting wiring that lives HERE so no seam carries its own copy:
		*
		* - the gate: `takeoverEnabled` = the `openAsDefault` switch resolved from
		*   the live settings scope (evaluated per call, so flipping the switch
		*   applies to the very next click);
		* - the open blocklist (`openBlocklist.ts`), read per call from the same
		*   scope: a file type the code editor renders poorly (Office/image/PDF …)
		*   declines the VSCode reroute and falls through to the official
		*   sidebar's own viewer surface;
		* - session addressing: the session-scope address translation resolves
		*   the workspace root from the sessions registry's live snapshot.
		*
		* @module dsh-sidebar-vscode/client/takeovers
		*/
		/**
		* Install every takeover seam behind one gate. Fail-soft at each layer:
		* the openResource wrapper declines per call (switch off / blocklist /
		* unresolvable address) and installs nothing on a foreign service shape;
		* each era-specific settings seam simply never installs on a runtime that
		* does not provide its service.
		*
		* @param client - the client context face (sidebarRight, sessions, era services).
		* @param scope - the bound `vscode-sidebar` settings scope (live reads;
		* undefined = no settings service, every read falls back to the code
		* defaults — the switch reads off, so every seam declines).
		* @returns the disposer unwinding every installed seam (HMR-safe).
		*/
		function installTakeovers(client, scope) {
			const takeoverEnabled = () => takeoverSwitchOn(scope);
			const blockedPath = (path) => isBlockedPath(path, readOpenBlocklist(scope));
			const cwdOf = (sessionId) => client.sessions?.list?.getSnapshot().byId?.[sessionId]?.cwd;
			const sidebarRight = client.sidebarRight;
			const stopOpenResource = sidebarRight === void 0 ? void 0 : wrapSidebarRightOpenResource(sidebarRight, {
				takeoverEnabled,
				blocked: blockedPath,
				cwdOf,
				kind: VSCODE_KIND
			});
			const stopExpand = sidebarRight === void 0 ? void 0 : installExpandTakeover({
				takeoverEnabled,
				openWorkbench: () => {
					sidebarRight.openTab(VSCODE_KIND);
				}
			});
			const settingsDeps = {
				takeoverEnabled,
				resolvePath: () => fetchSettingsDocumentPath(),
				reroute: (path) => {
					sidebarRight?.openTab(VSCODE_KIND, { params: { path } });
				},
				closeDialog: () => {
					closeSettingsDialog();
				}
			};
			if (client.inject !== void 0) client.inject(["remote.settings"], (scopeCtx) => {
				const settings = scopeCtx.get("remote.settings");
				if (settings === null || typeof settings !== "object") return void 0;
				return wrapRemoteOpenSettingsDocument(settings, settingsDeps);
			});
			const connection = client.connection;
			const stopSettingsOpen = connection === void 0 ? void 0 : wrapSettingsOpenDocument(connection.api, settingsDeps);
			return () => {
				stopExpand?.();
				stopSettingsOpen?.();
				stopOpenResource?.();
			};
		}
		//#endregion
		//#region src/mentionCodec.ts
		/**
		* The vscode-selection mention codec shared verbatim by the host half
		* (pre-step parsing and context injection) and the browser half (chip
		* serialization). Pure logic only: no Node builtins, no `@deepseek-ai/*`
		* value imports, so the same module passes the client bundle's purity gate.
		*
		* Wire form (the `ref` of every composer chip whose source is
		* 'vscode-reference', and the exact text the trigger codec serializes it to):
		*
		* ```
		* @[<escaped label>](dsh-vscode:<base64url(json payload)>)
		* ```
		*
		* The payload is self-contained — path, 1-based inclusive line range, the
		* captured snapshot text, its content hash, and capture-time flags — so the
		* draft text alone carries everything the host needs at `agent/pre-step`.
		* This mirrors the canonical-URI discipline of dsh-session references
		* (`dsh-session:`): decode must re-encode to the identical URI.
		*
		* @module dsh-sidebar-vscode/mentionCodec
		*/
		/** URI scheme reserved for VS Code editor-selection references. */
		const VSCODE_MENTION_SCHEME = "dsh-vscode:";
		/** URI scheme reserved for VS Code explorer file/folder references. */
		const VSCODE_RESOURCE_SCHEME = "dsh-vscode-res:";
		/** Error thrown when an explicit `dsh-vscode:` mention or bare URI is malformed. */
		var VscodeMentionError = class extends Error {
			constructor(message, options) {
				super(message, options);
				this.name = "VscodeMentionError";
			}
		};
		/** UTF-8 string → base64url without padding. */
		function encodeBase64Url(text) {
			const bytes = new TextEncoder().encode(text);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		}
		/** base64url → UTF-8 string; throws on malformed input. */
		function decodeBase64Url(value) {
			const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
			const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
			const binary = atob(padded);
			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		}
		/** Whether the value structurally matches {@link VscodeRefPayload} (v1). */
		function isVscodeRefPayload(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			return candidate.v === 1 && typeof candidate.path === "string" && candidate.path !== "" && typeof candidate.start === "number" && Number.isInteger(candidate.start) && candidate.start >= 1 && typeof candidate.end === "number" && Number.isInteger(candidate.end) && candidate.end >= candidate.start && (candidate.lang === void 0 || typeof candidate.lang === "string" && candidate.lang !== "") && typeof candidate.text === "string" && typeof candidate.hash === "string" && /^[0-9a-f]{0,16}$/.test(candidate.hash) && (candidate.truncated === void 0 || typeof candidate.truncated === "boolean") && (candidate.headLen === void 0 || typeof candidate.headLen === "number" && Number.isInteger(candidate.headLen) && candidate.headLen >= 0) && (candidate.omitLines === void 0 || typeof candidate.omitLines === "number" && Number.isInteger(candidate.omitLines) && candidate.omitLines >= 0) && (candidate.omitBytes === void 0 || typeof candidate.omitBytes === "number" && Number.isInteger(candidate.omitBytes) && candidate.omitBytes >= 0) && (candidate.dirty === void 0 || typeof candidate.dirty === "boolean");
		}
		/** Serialize one payload to its canonical URI (fixed key order; falsy flags omitted). */
		function encodeVscodeRefUri(payload) {
			const wire = {
				v: 1,
				path: payload.path,
				start: payload.start,
				end: payload.end
			};
			if (payload.lang !== void 0 && payload.lang !== "") wire.lang = payload.lang;
			wire.text = payload.text;
			wire.hash = payload.hash;
			if (payload.truncated === true) {
				wire.truncated = true;
				if (payload.headLen !== void 0) wire.headLen = payload.headLen;
				if (payload.omitLines !== void 0) wire.omitLines = payload.omitLines;
				if (payload.omitBytes !== void 0) wire.omitBytes = payload.omitBytes;
			}
			if (payload.dirty === true) wire.dirty = true;
			return `${VSCODE_MENTION_SCHEME}${encodeBase64Url(JSON.stringify(wire))}`;
		}
		/**
		* Decode and canonicalize one `dsh-vscode:` URI.
		* @param uri - complete URI string.
		* @returns the validated payload.
		* @throws VscodeMentionError when the URI is not a canonical v1 reference.
		*/
		function decodeVscodeRefUri(uri) {
			if (!uri.startsWith("dsh-vscode:")) throw new VscodeMentionError(`not a vscode-selection URI: ${JSON.stringify(uri)}`);
			const encoded = uri.slice(11);
			if (encoded === "" || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new VscodeMentionError(`malformed vscode-selection URI payload`);
			let parsed;
			try {
				parsed = JSON.parse(decodeBase64Url(encoded));
			} catch (error) {
				throw new VscodeMentionError(`undecodable vscode-selection URI payload`, { cause: error });
			}
			if (!isVscodeRefPayload(parsed)) throw new VscodeMentionError(`vscode-selection URI payload failed validation`);
			const payload = parsed;
			if (encodeVscodeRefUri(payload) !== uri) throw new VscodeMentionError(`vscode-selection URI is not canonical`);
			return payload;
		}
		/** Whether the value structurally matches {@link VscodeResourcePayload} (v1). */
		function isVscodeResourcePayload(value) {
			if (typeof value !== "object" || value === null) return false;
			const candidate = value;
			return candidate.v === 1 && typeof candidate.path === "string" && candidate.path !== "" && (candidate.type === "file" || candidate.type === "folder");
		}
		/** Serialize one resource payload to its canonical URI (fixed key order). */
		function encodeVscodeResourceUri(payload) {
			const wire = {
				v: 1,
				path: payload.path,
				type: payload.type
			};
			return `${VSCODE_RESOURCE_SCHEME}${encodeBase64Url(JSON.stringify(wire))}`;
		}
		/**
		* Decode and canonicalize one `dsh-vscode-res:` URI.
		* @param uri - complete URI string.
		* @returns the validated payload.
		* @throws VscodeMentionError when the URI is not a canonical v1 resource.
		*/
		function decodeVscodeResourceUri(uri) {
			if (!uri.startsWith("dsh-vscode-res:")) throw new VscodeMentionError(`not a vscode-resource URI: ${JSON.stringify(uri)}`);
			const encoded = uri.slice(15);
			if (encoded === "" || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new VscodeMentionError(`malformed vscode-resource URI payload`);
			let parsed;
			try {
				parsed = JSON.parse(decodeBase64Url(encoded));
			} catch (error) {
				throw new VscodeMentionError(`undecodable vscode-resource URI payload`, { cause: error });
			}
			if (!isVscodeResourcePayload(parsed)) throw new VscodeMentionError(`vscode-resource URI payload failed validation`);
			const payload = parsed;
			if (encodeVscodeResourceUri(payload) !== uri) throw new VscodeMentionError(`vscode-resource URI is not canonical`);
			return payload;
		}
		/** Escape `\` and `]` so a label cannot break out of the `@[…](…)` form. */
		function escapeLabel(label) {
			return label.replace(/[\\\]]/gu, (match) => `\\${match}`);
		}
		/** Line-range label: `L10` for single lines, `L10-L25` otherwise. */
		function rangeLabel(start, end) {
			return start === end ? `L${start}` : `L${start}-L${end}`;
		}
		/** Chip label / readable mention replacement: `path L10-L12`. */
		function referenceLabel(payload) {
			return `${payload.path} ${rangeLabel(payload.start, payload.end)}`;
		}
		/** Chip label / readable resource mention replacement: the bare path. */
		function resourceLabel(payload) {
			return payload.path;
		}
		/** Render the canonical Markdown mention for one payload. */
		function formatVscodeMention(payload) {
			return `@[${escapeLabel(referenceLabel(payload))}](${encodeVscodeRefUri(payload)})`;
		}
		/** Render the canonical Markdown mention for one resource payload. */
		function formatVscodeResourceMention(payload) {
			return `@[${escapeLabel(resourceLabel(payload))}](${encodeVscodeResourceUri(payload)})`;
		}
		/** Markdown mention shape with whitespace-drifted sigils (rendered-chip copies). */
		const RECOVERED_MD_RE = /@[ \t]*\[[^\]\n]*\][ \t]*\([ \t]*(dsh-vscode(?:-res)?):[ \t]*([A-Za-z0-9_-]+)[ \t]*\)/gu;
		/** Bare URI shape, canonical or with whitespace drifted around the colon. */
		const RECOVERED_BARE_RE = /\b(dsh-vscode(?:-res)?):[ \t]*([A-Za-z0-9_-]+)/gu;
		/** Project one recovered payload onto its mention/label projections. */
		function projectRecovered(payload, start, end) {
			return isVscodeResourcePayload(payload) ? {
				payload,
				mention: formatVscodeResourceMention(payload),
				label: resourceLabel(payload),
				start,
				end
			} : {
				payload,
				mention: formatVscodeMention(payload),
				label: referenceLabel(payload),
				start,
				end
			};
		}
		/** Decode one `scheme` + base64url pair; null when it is not a canonical URI. */
		function recoverPayload(scheme, encoded) {
			const uri = `${scheme}:${encoded}`;
			try {
				return scheme === "dsh-vscode-res:".slice(0, -1) ? decodeVscodeResourceUri(uri) : decodeVscodeRefUri(uri);
			} catch {
				return null;
			}
		}
		/**
		* Scan arbitrary text (typically a paste) for mention copies: the canonical
		* `@[…](dsh-vscode:…)` form, whitespace-padded renderings of it, and bare
		* (possibly padded) URIs — both schemes. Every candidate must decode as a
		* canonical URI or it is skipped: the copied label is never trusted (chips
		* render lossy basenames), so all projections are rebuilt from the payload.
		* A bare URI nested inside a Markdown-shaped match is claimed by the wrapper
		* (valid or not); one inside a wrapper that failed to decode still recovers
		* on its own — a copy truncated past the closing paren keeps its reference.
		*
		* @param text - text to scan.
		* @returns recovered mentions in text order (may be empty; never throws).
		*/
		function scanRecoveredMentions(text) {
			const found = [];
			const claimed = [];
			for (const match of text.matchAll(RECOVERED_MD_RE)) {
				const start = match.index ?? 0;
				const end = start + match[0].length;
				const recovered = recoverPayload(match[1] ?? "", match[2] ?? "");
				claimed.push({
					start,
					end
				});
				if (recovered === null) continue;
				found.push(projectRecovered(recovered, start, end));
			}
			for (const match of text.matchAll(RECOVERED_BARE_RE)) {
				const start = match.index ?? 0;
				const end = start + match[0].length;
				if (claimed.some((range) => start < range.end && end > range.start)) continue;
				const recovered = recoverPayload(match[1] ?? "", match[2] ?? "");
				if (recovered === null) continue;
				found.push(projectRecovered(recovered, start, end));
			}
			return found.sort((a, b) => a.start - b.start);
		}
		/** Hash-normalize snapshot text: LF line endings, no trailing newline. */
		function normalizeForHash(text) {
			return text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
		}
		/**
		* Normalize and bound one snapshot: LF endings, drop the trailing newline,
		* then cap by line count and encoded byte length — keeping the HEAD and TAIL
		* halves and omitting the MIDDLE (never the tail alone), so the model keeps
		* both the opening context and the closing statements of the selection. The
		* gap is described by the returned counters; the host renders the inline
		* `... (N lines omitted, L1-L2) ...` marker from them. Neither counter
		* includes the marker itself.
		*/
		function truncateSnapshot(text, limits) {
			const normalized = normalizeForHash(text);
			const maxLines = Math.max(1, Math.floor(limits.maxLines));
			const maxBytes = Math.max(1, Math.floor(limits.maxBytes));
			const encoder = new TextEncoder();
			const byteLengthOf = (value) => encoder.encode(value).length;
			/** Longest prefix of `value` whose UTF-8 length stays within `budget` (multi-byte safe). */
			const prefixWithin = (value, budget) => {
				let lo = 0;
				let hi = value.length;
				while (lo < hi) {
					const mid = Math.ceil((lo + hi) / 2);
					if (byteLengthOf(value.slice(0, mid)) <= budget) lo = mid;
					else hi = mid - 1;
				}
				return value.slice(0, lo);
			};
			/** Longest suffix of `value` whose UTF-8 length stays within `budget` (multi-byte safe). */
			const suffixWithin = (value, budget) => {
				let lo = 0;
				let hi = value.length;
				while (lo < hi) {
					const mid = Math.floor((lo + hi) / 2);
					if (byteLengthOf(value.slice(mid)) <= budget) hi = mid;
					else lo = mid + 1;
				}
				return value.slice(lo);
			};
			let head = normalized;
			let tail = "";
			let omitLines = 0;
			const lines = normalized.split("\n");
			if (lines.length > maxLines) {
				const headCount = Math.ceil(maxLines / 2);
				const tailCount = maxLines - headCount;
				omitLines = lines.length - maxLines;
				head = lines.slice(0, headCount).join("\n");
				tail = tailCount > 0 ? lines.slice(lines.length - tailCount).join("\n") : "";
			}
			let omitBytes = 0;
			if (byteLengthOf(head) + byteLengthOf(tail) > maxBytes) {
				const headBudget = Math.ceil(maxBytes / 2);
				const tailBudget = maxBytes - headBudget;
				const keptHead = prefixWithin(head, headBudget);
				const keptTail = suffixWithin(tail === "" ? head : tail, tailBudget);
				omitBytes = byteLengthOf(head) + byteLengthOf(tail) - byteLengthOf(keptHead) - byteLengthOf(keptTail);
				head = keptHead;
				tail = keptTail;
			}
			if (omitLines === 0 && omitBytes === 0) return {
				text: normalized,
				truncated: false
			};
			return {
				text: [head, tail].filter((part) => part !== "").join("\n"),
				truncated: true,
				headLen: head.length,
				omitLines,
				omitBytes
			};
		}
		/** First {@link HASH_HEX_LENGTH} hex chars of a sha-256 digest hex string. */
		function hashPrefix(hexDigest) {
			return hexDigest.slice(0, 16);
		}
		//#endregion
		//#region src/client/references.ts
		/**
		* Client-side vscode-selection references: building composer chips from a
		* decoded clipboard payload, inserting them through the conversation input
		* machine, recovering pasted mention copies back into chips, and computing
		* the reference-rail view over the live occurrence table.
		*
		* Everything here is structurally typed against the ui-conversation /
		* ui-input-trigger contracts (the browser bundle's purity gate forbids
		* `@deepseek-ai/*` value imports, and the shapes are frozen public seams).
		*
		* TWO host generations are served, keyed by one structural probe
		* ({@link isLexicalInput} — the Lexical-era shell owns an `editor`; the
		* textarea-era machine does not):
		*
		* - Lexical hosts (DSH ≥ 0.1.2-alpha.2): the draft is the CLIPBOARD
		*   projection (each chip expands to its `clipboardText` — here the full
		*   canonical mention) while `TokenSpan`s are DETECT-projection offsets
		*   (each chip is one `￼` char); the two planes diverge as soon as any chip
		*   exists. Insertion still goes through `SessionInput.insertReference`
		*   with a revision-CAS'd detect span; plain-text degradation rides the
		*   scoped `'slash/input-insert-text'` bail event (a span-addressed editor
		*   write that never flattens other chips — unlike `setDraft`, which
		*   replaces the whole editor as plain text); chip removal rides
		*   `'slash/input-consume-token'`. Spans and returned carets are detect
		*   offsets; {@link detectLengthOf}/{@link detectOfClipboard}/
		*   {@link clipboardOfDetect} translate between the planes through the
		*   occurrence table.
		*
		* - Textarea-era hosts: one text plane — the draft itself. The historical
		*   span math (draft-tail append, `setDraft` splice with an edit range)
		*   stays exactly as it was.
		*
		* In both worlds every chip is an atomic occurrence: backspace deletes it
		* whole, submit serializes it through this plugin's trigger-source codec,
		* and the draft text (not any side table) is the single store of what will
		* be injected at `agent/pre-step`.
		*
		* @module dsh-sidebar-vscode/client/references
		*/
		/** The occurrence/source name this plugin registers in the trigger registry. */
		const VSCODE_SOURCE = "vscode-reference";
		/**
		* Whether one input facade is the Lexical-era shell. The shell owns its
		* editor (`readonly editor: LexicalEditor`); the textarea-era machine never
		* did. Everything plane-sensitive branches on this single probe.
		*/
		function isLexicalInput(input) {
			return "editor" in input && input.editor !== void 0;
		}
		/** Occurrence table sorted by offset (the machine's published invariant). */
		function sortedOccurrences(occurrences) {
			return [...occurrences].sort((a, b) => a.offset - b.offset);
		}
		/**
		* Length of the detect projection: the clipboard draft minus every chip's
		* expansion beyond its single detect character.
		*/
		function detectLengthOf(snapshot) {
			const chips = snapshot.occurrences.reduce((sum, occ) => sum + Math.max(0, occ.length - 1), 0);
			return Math.max(0, snapshot.draft.length - chips);
		}
		/**
		* Clipboard offset → detect offset (host parity with
		* `detectOffsetOfClipboardOffset`): offsets before a chip map before it;
		* offsets at or inside a chip's expansion snap to the chip's trailing edge.
		*/
		function detectOfClipboard(clipboardOffset, occurrences) {
			let adjust = 0;
			for (const occ of sortedOccurrences(occurrences)) {
				if (clipboardOffset >= occ.offset + occ.length) {
					adjust += Math.max(0, occ.length - 1);
					continue;
				}
				if (clipboardOffset <= occ.offset) return clipboardOffset - adjust;
				return occ.offset - adjust + 1;
			}
			return clipboardOffset - adjust;
		}
		/**
		* Detect offset → clipboard offset: the inverse of {@link detectOfClipboard}.
		* A detect offset at a chip's leading edge maps before its expansion; at the
		* trailing edge (leading+1) it maps after it.
		*/
		function clipboardOfDetect(detectOffset, occurrences) {
			let adjust = 0;
			for (const occ of sortedOccurrences(occurrences)) {
				if (detectOffset >= occ.offset - adjust + 1) {
					adjust += Math.max(0, occ.length - 1);
					continue;
				}
				break;
			}
			return detectOffset + adjust;
		}
		/**
		* Resolve the model-facing path for one captured path: reverse-map the
		* container absolute path into DSH space when possible, then relativize
		* against the session cwd when the result sits underneath it. The same
		* resolution serves editor selections and explorer resources.
		*
		* @param path - the container-side absolute path.
		* @param relative - the workspace-relative path (when the VS Code workspace
		* matches the DSH workspace root), the next best form when no rule matches.
		*/
		function resolveWorkspacePath(path, relative, reverseRules, cwd) {
			let absolute;
			if (reverseRules !== void 0) absolute = reverseMapPath(path, reverseRules) ?? void 0;
			if (absolute === void 0) return relative !== void 0 && relative !== "" ? relative : path;
			if (cwd !== void 0 && cwd !== "" && absolute.startsWith(`${cwd}/`)) return absolute.slice(cwd.length + 1);
			return absolute;
		}
		/** sha-256 hex prefix of the hash-normalized snapshot; '' when unavailable. */
		async function hashSnapshot(text) {
			const normalized = normalizeForHash(text);
			if (typeof crypto === "undefined" || crypto.subtle === void 0) return "";
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
			return hashPrefix([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
		}
		/**
		* Build one atomic composer chip per selection span of a decoded payload.
		* @param payload - the decoded clipboard envelope payload.
		* @param options - path translation and capture bounds.
		* @returns one {@link ReferenceInsertLike} per span, in editor order.
		*/
		async function buildRefsFromPayload(payload, options) {
			const maxLines = options.maxLines === void 0 ? 200 : clampCap(options.maxLines, 1, MAX_LINES_MAX);
			const maxBytes = options.maxBytes === void 0 ? MAX_BYTES_DEFAULT : clampCap(options.maxBytes, MAX_BYTES_MIN, MAX_BYTES_MAX);
			const path = resolveWorkspacePath(payload.path, payload.relative, options.reverseRules, options.cwd);
			const refs = [];
			for (const span of payload.spans) {
				const snapshot = truncateSnapshot(span.text, {
					maxLines,
					maxBytes
				});
				const chipPayload = {
					v: 1,
					path,
					start: span.startLine,
					end: span.endLine,
					...payload.language !== void 0 && payload.language !== "" ? { lang: payload.language } : {},
					text: snapshot.text,
					hash: await hashSnapshot(snapshot.text),
					...snapshot.truncated ? {
						truncated: true,
						headLen: snapshot.headLen,
						omitLines: snapshot.omitLines,
						omitBytes: snapshot.omitBytes
					} : {},
					...payload.dirty === true ? { dirty: true } : {}
				};
				const mention = formatVscodeMention(chipPayload);
				refs.push({
					source: VSCODE_SOURCE,
					ref: mention,
					label: referenceLabel(chipPayload),
					appearance: "file",
					clipboardText: mention
				});
			}
			return refs;
		}
		/**
		* Build one atomic composer chip per explorer-selected resource. Unlike
		* selections, a resource chip carries no snapshot: the canonical mention
		* holds only the resolved path and the file/folder kind, and the host half
		* expands it into a content-less `<file-selection>`/`<folder-selection>`
		* context marker.
		* @param payload - the decoded clipboard envelope payload.
		* @param options - path translation.
		* @returns one {@link ReferenceInsertLike} per resource, in explorer order.
		*/
		function buildResourceRefsFromPayload(payload, options) {
			return payload.resources.map((item) => {
				const chipPayload = {
					v: 1,
					path: resolveWorkspacePath(item.path, item.relative, options.reverseRules, options.cwd),
					type: item.type
				};
				const mention = formatVscodeResourceMention(chipPayload);
				return {
					source: VSCODE_SOURCE,
					ref: mention,
					label: resourceLabel(chipPayload),
					appearance: item.type,
					clipboardText: mention
				};
			});
		}
		/** Await one macrotask tick (retry backoff). */
		function delay(ms) {
			return new Promise((resolve) => setTimeout(resolve, ms));
		}
		/** Append one mention as plain text onto a draft (separator-aware). */
		function appendMention(draft, mention) {
			return `${draft}${draft !== "" && !/\s$/u.test(draft) ? " " : ""}${mention} `;
		}
		/** Clamp one caller-addressed range into [0, length] with start ≤ end. */
		function clampSpan(range, length) {
			const a = Math.max(0, Math.min(range.start, length));
			const b = Math.max(0, Math.min(range.end, length));
			return a <= b ? {
				start: a,
				end: b
			} : {
				start: b,
				end: a
			};
		}
		/** Dispatch one scoped input event (`'slash/input-insert-text'`); false when unhandled. */
		function bailInsertText(actx, request) {
			const scope = actx;
			if (scope === null || scope === void 0 || typeof scope.bail !== "function") return false;
			try {
				return scope.bail(scope, "slash/input-insert-text", request) === true;
			} catch {
				return false;
			}
		}
		/** Dispatch one scoped input event (`'slash/input-consume-token'`); false when unhandled. */
		function bailConsumeToken(actx, request) {
			const scope = actx;
			if (scope === null || scope === void 0 || typeof scope.bail !== "function") return false;
			try {
				return scope.bail(scope, "slash/input-consume-token", request) === true;
			} catch {
				return false;
			}
		}
		/**
		* The machine's trailing-gap rule, evaluated through the clipboard draft:
		* a chip (or mention) landing at `clipboardPoint` is followed by one space
		* unless the text there already starts with one — including at the draft
		* end, where the machine appends the gap itself.
		*/
		function trailingGapAt(snapshot, clipboardPoint) {
			return snapshot.draft[clipboardPoint] === " " ? "" : " ";
		}
		/**
		* Insert references as atomic chips on the addressed session's composer,
		* at the caller's addressed point: the first reference replaces the `at`
		* range (a bare caret is the zero-width case), every following one splices
		* at the point just past its predecessor, and a missing `at` keeps the
		* historical end-of-draft append. Spans are detect-projection offsets on
		* Lexical hosts ({@link isLexicalInput}) and draft offsets on textarea-era
		* ones — `at` must come from the same plane (the keyboard face's
		* `caretSpan()`, the composer DOM mapping, or a textarea selection).
		*
		* Whenever the input machine refuses the chip transaction (mid-submit
		* phases, CAS loss after retry) the canonical mention lands as plain text
		* over the same point — on Lexical hosts through the span-addressed
		* `'slash/input-insert-text'` event so every OTHER chip survives intact
		* (the whole-draft `setDraft` write runs only when that host exposes no
		* event seam), and on textarea-era hosts directly through `setDraft`.
		* The host boundary parses plain-text mentions identically, so the text
		* path degrades only the chip affordance — never the context.
		*
		* @param sessions - the sessions service (scope resolution).
		* @param conversation - the conversation service (input resolver).
		* @param sessionId - the addressed session.
		* @param refs - references to land, in order.
		* @param at - the range the references replace (usually the composer
		* caret; a non-zero width is the selection it replaces). Undefined = append
		* at the draft tail.
		* @returns the per-path landing counts plus the post-landing caret.
		*/
		async function insertVscodeReferences(sessions, conversation, sessionId, refs, at) {
			if (refs.length === 0) return {
				inserted: 0,
				textFallback: 0,
				failed: false
			};
			const actx = sessionId !== void 0 ? sessions?.scope(sessionId) : void 0;
			if (actx === void 0 || conversation === void 0) return {
				inserted: 0,
				textFallback: 0,
				failed: true
			};
			let input;
			try {
				input = conversation.input.for(actx);
			} catch {
				return {
					inserted: 0,
					textFallback: 0,
					failed: true
				};
			}
			const lexical = isLexicalInput(input);
			/** The current span-addressable length: detect plane or the draft itself. */
			const planeLength = (snapshot) => lexical ? detectLengthOf(snapshot) : snapshot.draft.length;
			let inserted = 0;
			let textFallback = 0;
			let caret;
			let next = at === void 0 ? void 0 : {
				start: at.start,
				end: at.end
			};
			for (const ref of refs) {
				let landed = false;
				for (let attempt = 0; attempt < 2 && !landed; attempt++) {
					const snapshot = input.state.getSnapshot();
					if (snapshot.phase !== "plain" && snapshot.phase !== "claimed") {
						await delay(150);
						continue;
					}
					const span = next === void 0 ? {
						start: planeLength(snapshot),
						end: planeLength(snapshot)
					} : clampSpan(next, planeLength(snapshot));
					const beforeLen = planeLength(snapshot);
					landed = input.insertReference(ref, {
						...span,
						draftRev: snapshot.draftRev
					});
					if (landed) {
						const afterLen = planeLength(input.state.getSnapshot());
						caret = span.start + (afterLen - beforeLen) + (span.end - span.start);
						next = {
							start: caret,
							end: caret
						};
					} else await delay(150);
				}
				if (landed) {
					inserted++;
					continue;
				}
				const snapshot = input.state.getSnapshot();
				if (next === void 0) {
					const text = `${snapshot.draft !== "" && !/\s$/u.test(snapshot.draft) ? " " : ""}${ref.ref} `;
					const tail = planeLength(snapshot);
					if (bailInsertText(actx, {
						text,
						span: {
							start: tail,
							end: tail,
							draftRev: snapshot.draftRev
						}
					})) caret = tail + text.length;
					else {
						const draft = appendMention(snapshot.draft, ref.ref);
						input.setDraft(draft);
						caret = draft.length;
					}
				} else {
					const span = clampSpan(next, planeLength(snapshot));
					if (lexical) {
						const clipboardStart = clipboardOfDetect(span.start, snapshot.occurrences);
						const clipboardEnd = clipboardOfDetect(span.end, snapshot.occurrences);
						const gap = trailingGapAt(snapshot, clipboardEnd);
						const text = `${ref.ref}${gap}`;
						if (bailInsertText(actx, {
							text,
							span: {
								...span,
								draftRev: snapshot.draftRev
							}
						})) caret = span.start + text.length;
						else {
							input.setDraft(`${snapshot.draft.slice(0, clipboardStart)}${text}${snapshot.draft.slice(clipboardEnd)}`, {
								start: clipboardStart,
								end: clipboardEnd,
								insertedLength: text.length
							});
							caret = clipboardStart + text.length;
						}
					} else {
						const point = span.start;
						const tail = snapshot.draft.slice(span.end);
						const gap = tail.length === 0 || tail[0] !== " " ? " " : "";
						const replacement = `${ref.ref}${gap}`;
						input.setDraft(`${snapshot.draft.slice(0, point)}${replacement}${tail}`, {
							start: point,
							end: span.end,
							insertedLength: replacement.length
						});
						caret = point + replacement.length;
					}
					next = {
						start: caret,
						end: caret
					};
				}
				textFallback++;
			}
			return caret === void 0 ? {
				inserted,
				textFallback,
				failed: false
			} : {
				inserted,
				textFallback,
				failed: false,
				caret
			};
		}
		/**
		* Build one atomic composer chip per recovered mention payload. The payload
		* already carries its (possibly truncated) capture snapshot and resolved
		* path, so nothing is re-derived — the chip identity is the canonical
		* mention rebuilt from the payload, exactly like a freshly captured one.
		* @param mentions - recovered mentions (either kind), in text order.
		* @returns one {@link ReferenceInsertLike} per mention.
		*/
		function refsFromRecoveredMentions(mentions) {
			return mentions.map(({ payload }) => {
				if (isVscodeResourcePayload(payload)) {
					const mention = formatVscodeResourceMention(payload);
					return {
						source: VSCODE_SOURCE,
						ref: mention,
						label: resourceLabel(payload),
						appearance: payload.type,
						clipboardText: mention
					};
				}
				const mention = formatVscodeMention(payload);
				return {
					source: VSCODE_SOURCE,
					ref: mention,
					label: referenceLabel(payload),
					appearance: "file",
					clipboardText: mention
				};
			});
		}
		/**
		* Parse pasted text into prose parts plus reference chips for every
		* recovered mention copy (see {@link scanRecoveredMentions}). Edge
		* whitespace is trimmed — copying a rendered item drags surrounding blank
		* lines that a paste should not re-insert — while interior text stays
		* verbatim so a prose-and-mention paste keeps its shape.
		* @param text - the pasted plain text.
		* @returns the parsed paste, or null when no mention copy is recoverable.
		*/
		function parseRecoveredPaste(text) {
			const trimmed = text.trim();
			if (trimmed === "") return null;
			const mentions = scanRecoveredMentions(trimmed);
			if (mentions.length === 0) return null;
			const refs = refsFromRecoveredMentions(mentions);
			const parts = [];
			let cursor = 0;
			mentions.forEach((mention, index) => {
				if (mention.start > cursor) parts.push({
					kind: "text",
					text: trimmed.slice(cursor, mention.start)
				});
				parts.push({
					kind: "ref",
					ref: refs[index]
				});
				cursor = mention.end;
			});
			if (cursor < trimmed.length) parts.push({
				kind: "text",
				text: trimmed.slice(cursor)
			});
			return {
				parts,
				refs
			};
		}
		/** Chip display text — what a chip occupies in the draft's text planes. */
		function chipDisplay(ref) {
			return `@${ref.label}`;
		}
		/**
		* Land one parsed paste on the addressed session's composer at the paste
		* selection: the prose inserts verbatim and every mention becomes an atomic
		* chip.
		*
		* Lexical hosts ({@link isLexicalInput}): one cursor walk over the parts in
		* detect coordinates — each prose run rides the span-addressed
		* `'slash/input-insert-text'` event and each mention a chip
		* `insertReference` at the cursor, the cursor advancing by the measured
		* detect delta after every step. Chips already in the draft survive
		* untouched (no whole-draft write ever happens), and a chip step the
		* machine refuses (transient phases, CAS loss) degrades that one mention
		* to its canonical plain text over the same range.
		*
		* Textarea-era hosts: the historical algorithm — ONE whole-draft write of
		* the pasted display text followed by per-chip upgrades from the LAST chip
		* backwards — stays verbatim.
		*
		* @param sessions - the sessions service (scope resolution).
		* @param conversation - the conversation service (input resolver).
		* @param sessionId - the addressed session.
		* @param parts - the parsed paste (see {@link parseRecoveredPaste}).
		* @param selection - the range the paste replaces (usually the caret), in
		* the plane the addressed composer's selection speaks.
		* @returns per-path landing counts plus the post-landing caret.
		*/
		async function pasteRecoveredMentions(sessions, conversation, sessionId, parts, selection) {
			const refs = parts.filter((part) => part.kind === "ref");
			if (refs.length === 0) return {
				inserted: 0,
				textFallback: 0,
				failed: false
			};
			const actx = sessionId !== void 0 ? sessions?.scope(sessionId) : void 0;
			if (actx === void 0 || conversation === void 0) return {
				inserted: 0,
				textFallback: 0,
				failed: true
			};
			let input;
			try {
				input = conversation.input.for(actx);
			} catch {
				return {
					inserted: 0,
					textFallback: 0,
					failed: true
				};
			}
			if (isLexicalInput(input)) return pasteLexical(actx, input, parts, refs, selection);
			return pasteLegacy(input, parts, refs, selection);
		}
		/** The Lexical-host paste: a detect-coordinate cursor walk over the parts. */
		async function pasteLexical(actx, input, parts, refs, selection) {
			const before = input.state.getSnapshot();
			if (before.phase !== "plain" && before.phase !== "claimed") {
				const textual = parts.map((part) => part.kind === "text" ? part.text : `${part.ref.ref} `).join("");
				const span = clampSpan(selection, detectLengthOf(before));
				if (bailInsertText(actx, {
					text: textual,
					span: {
						...span,
						draftRev: before.draftRev
					}
				})) return {
					inserted: 0,
					textFallback: refs.length,
					failed: false,
					caret: span.start + textual.length
				};
				const clipboardStart = clipboardOfDetect(span.start, before.occurrences);
				const clipboardEnd = clipboardOfDetect(span.end, before.occurrences);
				input.setDraft(`${before.draft.slice(0, clipboardStart)}${textual}${before.draft.slice(clipboardEnd)}`, {
					start: clipboardStart,
					end: clipboardEnd,
					insertedLength: textual.length
				});
				return {
					inserted: 0,
					textFallback: refs.length,
					failed: false,
					caret: clipboardStart + textual.length
				};
			}
			let cursor = clampSpan(selection, detectLengthOf(before));
			let inserted = 0;
			let textFallback = 0;
			for (const part of parts) {
				if (part.kind === "text") {
					if (part.text !== "") {
						let applied = false;
						for (let attempt = 0; attempt < 2 && !applied; attempt++) {
							const snapshot = input.state.getSnapshot();
							applied = bailInsertText(actx, {
								text: part.text,
								span: {
									...clampSpan(cursor, detectLengthOf(snapshot)),
									draftRev: snapshot.draftRev
								}
							});
						}
						if (applied) cursor = {
							start: cursor.start + part.text.length,
							end: cursor.start + part.text.length
						};
					}
					continue;
				}
				let landed = false;
				for (let attempt = 0; attempt < 2 && !landed; attempt++) {
					const snapshot = input.state.getSnapshot();
					if (snapshot.phase !== "plain" && snapshot.phase !== "claimed") {
						await delay(150);
						continue;
					}
					const span = clampSpan(cursor, detectLengthOf(snapshot));
					const beforeLen = detectLengthOf(snapshot);
					landed = input.insertReference(part.ref, {
						...span,
						draftRev: snapshot.draftRev
					});
					if (landed) {
						const afterLen = detectLengthOf(input.state.getSnapshot());
						const caret = span.start + (afterLen - beforeLen) + (span.end - span.start);
						cursor = {
							start: caret,
							end: caret
						};
					} else await delay(150);
				}
				if (landed) {
					inserted++;
					continue;
				}
				const snapshot = input.state.getSnapshot();
				const span = clampSpan(cursor, detectLengthOf(snapshot));
				const clipboardStart = clipboardOfDetect(span.start, snapshot.occurrences);
				const clipboardEnd = clipboardOfDetect(span.end, snapshot.occurrences);
				const gap = trailingGapAt(snapshot, clipboardEnd);
				const text = `${part.ref.ref}${gap}`;
				if (bailInsertText(actx, {
					text,
					span: {
						...span,
						draftRev: snapshot.draftRev
					}
				})) cursor = {
					start: span.start + text.length,
					end: span.start + text.length
				};
				else {
					input.setDraft(`${snapshot.draft.slice(0, clipboardStart)}${text}${snapshot.draft.slice(clipboardEnd)}`, {
						start: clipboardStart,
						end: clipboardEnd,
						insertedLength: text.length
					});
					cursor = {
						start: span.start + text.length,
						end: span.start + text.length
					};
				}
				textFallback++;
			}
			return {
				inserted,
				textFallback,
				failed: false,
				caret: cursor.start
			};
		}
		/** The textarea-era paste algorithm, kept verbatim for old hosts. */
		async function pasteLegacy(input, parts, refs, selection) {
			const before = input.state.getSnapshot();
			if (before.phase !== "plain" && before.phase !== "claimed") {
				const textual = parts.map((part) => part.kind === "text" ? part.text : `${part.ref.ref} `).join("");
				input.setDraft(`${before.draft.slice(0, selection.start)}${textual}${before.draft.slice(selection.end)}`, {
					start: selection.start,
					end: selection.end,
					insertedLength: textual.length
				});
				return {
					inserted: 0,
					textFallback: refs.length,
					failed: false,
					caret: selection.start + textual.length
				};
			}
			const display = parts.map((part) => part.kind === "text" ? part.text : chipDisplay(part.ref)).join("");
			input.setDraft(`${before.draft.slice(0, selection.start)}${display}${before.draft.slice(selection.end)}`, {
				start: selection.start,
				end: selection.end,
				insertedLength: display.length
			});
			const spans = [];
			let offset = selection.start;
			for (const part of parts) {
				if (part.kind === "text") {
					offset += part.text.length;
					continue;
				}
				spans.push({
					start: offset,
					end: offset + chipDisplay(part.ref).length,
					ref: part.ref
				});
				offset += chipDisplay(part.ref).length;
			}
			let inserted = 0;
			let textFallback = 0;
			for (const span of [...spans].reverse()) {
				const snapshot = input.state.getSnapshot();
				if (input.insertReference(span.ref, {
					start: span.start,
					end: span.end,
					draftRev: snapshot.draftRev
				})) {
					inserted++;
					continue;
				}
				const current = input.state.getSnapshot();
				const tail = current.draft.slice(span.end);
				const gap = tail.length === 0 || tail[0] !== " " ? " " : "";
				const replacement = `${span.ref.ref}${gap}`;
				input.setDraft(`${current.draft.slice(0, span.start)}${replacement}${current.draft.slice(span.end)}`, {
					start: span.start,
					end: span.end,
					insertedLength: replacement.length
				});
				textFallback++;
			}
			const after = input.state.getSnapshot();
			const caret = selection.start + (after.draft.length - before.draft.length) + (selection.end - selection.start);
			return {
				inserted,
				textFallback,
				failed: false,
				caret
			};
		}
		/**
		* Project the rail view over the input machine's occurrence table: distinct
		* vscode-selection references in first-appearance order, each with the ranges
		* of every chip citing it.
		* @param occurrences - the live occurrence table.
		*/
		function groupRailTags(occurrences) {
			const tags = [];
			const groups = /* @__PURE__ */ new Map();
			for (const occurrence of occurrences) {
				if (occurrence.source !== "vscode-reference") continue;
				const existing = groups.get(occurrence.ref);
				if (existing === void 0) {
					let truncated = false;
					let folder = false;
					try {
						const resMatch = /\(dsh-vscode-res:([A-Za-z0-9_-]+)\)/u.exec(occurrence.ref);
						if (resMatch !== null) folder = decodeVscodeResourceUri(`dsh-vscode-res:${resMatch[1]}`).type === "folder";
						else {
							const match = /\(dsh-vscode:([A-Za-z0-9_-]+)\)/u.exec(occurrence.ref);
							if (match !== null) truncated = decodeVscodeRefUri(`dsh-vscode:${match[1]}`).truncated === true;
						}
					} catch {}
					const group = {
						label: occurrence.label,
						truncated,
						folder,
						invalid: occurrence.invalid === true,
						count: 1,
						ranges: [{
							offset: occurrence.offset,
							length: occurrence.length
						}]
					};
					groups.set(occurrence.ref, group);
					tags.push({
						ref: occurrence.ref,
						...group,
						ranges: [...group.ranges]
					});
				} else {
					existing.count++;
					existing.ranges.push({
						offset: occurrence.offset,
						length: occurrence.length
					});
					existing.invalid = existing.invalid && occurrence.invalid === true;
				}
			}
			return tags.map((tag) => ({
				...tag,
				...groups.get(tag.ref),
				ranges: [...groups.get(tag.ref).ranges]
			}));
		}
		/**
		* Compute the next draft with every chip citing one reference removed:
		* ranges splice high-to-low, a doubled space at a seam collapses to one, and
		* a draft left whitespace-only clears to ''.
		* @param draft - the current draft text.
		* @param occurrences - the live occurrence table.
		* @param ref - the canonical mention to remove.
		* @returns the next draft to write through `inputActions.setDraft`.
		*/
		function removeRefRanges(draft, occurrences, ref) {
			const ranges = occurrences.filter((occurrence) => occurrence.source === "vscode-reference" && occurrence.ref === ref).map((occurrence) => ({
				start: occurrence.offset,
				end: occurrence.offset + occurrence.length
			})).sort((a, b) => b.start - a.start);
			let next = draft;
			for (const { start, end } of ranges) {
				let cutStart = start;
				let cutEnd = end;
				if (next[cutEnd] === " " && (cutStart === 0 || next[cutStart - 1] === " ")) {
					if (cutStart === 0) cutEnd++;
					else cutStart--;
				}
				next = next.slice(0, cutStart) + next.slice(cutEnd);
			}
			return next.trim() === "" ? "" : next.replace(/[ \t]+$/u, "");
		}
		/**
		* Compute one chip's removal window in the draft's own coordinates: the
		* occurrence range, widened by the seam rule (a doubled space around the
		* chip collapses to one; at the draft head the following space is eaten).
		* @param draft - the clipboard-projection draft.
		* @param range - the occurrence's [start, end) window.
		* @returns the widened window to cut.
		*/
		function removalWindow(draft, range) {
			let cutStart = range.start;
			let cutEnd = range.end;
			if (draft[cutEnd] === " " && (cutStart === 0 || draft[cutStart - 1] === " ")) {
				if (cutStart === 0) cutEnd++;
				else cutStart--;
			}
			return {
				start: cutStart,
				end: cutEnd
			};
		}
		/** Upper bound on chips currently in the draft (the removal loop budget). */
		function snapshotBudget(input) {
			return input.state.getSnapshot().occurrences.length;
		}
		/**
		* Remove every chip citing one reference from the addressed session's
		* draft — the reference rail's close affordance.
		*
		* Lexical hosts: one span-addressed `'slash/input-consume-token'`
		* transaction per chip (highest offset first, fresh snapshot before each),
		* so every OTHER chip in the draft survives with its rendering intact —
		* `setDraft` would flatten them all to raw mention text. The seam rule is
		* the same {@link removalWindow} the legacy splice used. A whitespace-only
		* remainder clears to the empty draft. A machine that refuses every
		* transaction degrades to the whole-draft `setDraft` write once.
		*
		* Textarea-era hosts: the historical whole-draft splice
		* ({@link removeRefRanges}) directly.
		*
		* @param sessions - the sessions service (scope resolution).
		* @param conversation - the conversation service (input resolver).
		* @param sessionId - the addressed session.
		* @param ref - the canonical mention to remove.
		* @returns how many chips left the draft, and whether the write degraded.
		*/
		async function removeVscodeReferences(sessions, conversation, sessionId, ref) {
			const actx = sessionId !== void 0 ? sessions?.scope(sessionId) : void 0;
			if (actx === void 0 || conversation === void 0) return {
				removed: 0,
				degraded: true
			};
			let input;
			try {
				input = conversation.input.for(actx);
			} catch {
				return {
					removed: 0,
					degraded: true
				};
			}
			let removed = 0;
			if (isLexicalInput(input)) {
				let refusals = 0;
				let degrade = false;
				let budget = snapshotBudget(input) * 2 + 4;
				for (;;) {
					if (budget-- <= 0) {
						degrade = true;
						break;
					}
					const snapshot = input.state.getSnapshot();
					const targets = snapshot.occurrences.filter((occurrence) => occurrence.source === "vscode-reference" && occurrence.ref === ref);
					if (targets.length === 0) break;
					const last = targets[targets.length - 1];
					const window = removalWindow(snapshot.draft, {
						start: last.offset,
						end: last.offset + last.length
					});
					if (bailConsumeToken(actx, { guard: {
						kind: "span",
						span: {
							start: detectOfClipboard(window.start, snapshot.occurrences),
							end: detectOfClipboard(window.end, snapshot.occurrences),
							draftRev: snapshot.draftRev
						}
					} })) {
						removed++;
						refusals = 0;
						continue;
					}
					refusals++;
					if (refusals >= 2) {
						degrade = true;
						break;
					}
					await delay(150);
				}
				if (!degrade) {
					const settled = input.state.getSnapshot();
					const length = detectLengthOf(settled);
					if (settled.draft.trim() === "" && length > 0) bailConsumeToken(actx, { guard: {
						kind: "span",
						span: {
							start: 0,
							end: length,
							draftRev: settled.draftRev
						}
					} });
					return {
						removed,
						degraded: false
					};
				}
			} else {
				const snapshot = input.state.getSnapshot();
				const next = removeRefRanges(snapshot.draft, snapshot.occurrences, ref);
				if (next !== snapshot.draft) {
					input.setDraft(next);
					removed = snapshot.occurrences.filter((occurrence) => occurrence.source === "vscode-reference" && occurrence.ref === ref).length;
					return {
						removed,
						degraded: false
					};
				}
				return {
					removed: 0,
					degraded: false
				};
			}
			const snapshot = input.state.getSnapshot();
			input.setDraft(removeRefRanges(snapshot.draft, snapshot.occurrences, ref));
			return {
				removed: snapshot.occurrences.filter((occurrence) => occurrence.source === "vscode-reference" && occurrence.ref === ref).length,
				degraded: true
			};
		}
		//#endregion
		//#region src/client/composerDom.ts
		/** Element-node type constant (text is 3). */
		const ELEMENT_NODE = 1;
		/** Text-node type constant. */
		const TEXT_NODE = 3;
		/** Whether one node contains another (or is itself). */
		function contains(ancestor, node) {
			let cursor = node;
			while (cursor !== null) {
				if (cursor === ancestor) return true;
				cursor = cursor.parentNode;
			}
			return false;
		}
		/** Index of one child inside its parent's childNodes (-1 when absent). */
		function indexOfChild(parent, child) {
			const kids = parent.childNodes;
			for (let index = 0; index < kids.length; index++) if (kids[index] === child) return index;
			return -1;
		}
		/** Whether an element is a reference chip host (never descended into). */
		function isChipElement(node) {
			return node.nodeType === ELEMENT_NODE && node.getAttribute?.("data-composer-chip") != null;
		}
		/**
		* Whether a `<br>` is the presentational break Lexical mounts inside an
		* EMPTY block (cursor geometry): the editor state has no LineBreakNode for
		* it, so the detect projection counts nothing. A plain `<br>` is a real
		* line break and counts its one newline.
		*/
		function isManagedLineBreak(node) {
			return node.getAttribute?.("data-lexical-managed-linebreak") != null;
		}
		/** The detect length of one `<br>` (managed 0, real line break 1). */
		function brDetectLength(node) {
			return isManagedLineBreak(node) ? 0 : 1;
		}
		/**
		* Walk one composer subtree, appending segments and recording elements.
		* @returns the subtree's detect length.
		*/
		function walk(node, base, segments, elements, texts, chips) {
			if (node.nodeType === TEXT_NODE) {
				const length = (node.data ?? "").length;
				const segment = {
					kind: "text",
					node,
					parent: node.parentNode,
					base,
					length
				};
				segments.push(segment);
				texts.set(node, segment);
				return length;
			}
			if (node.nodeType !== ELEMENT_NODE) return 0;
			if (isChipElement(node)) {
				const segment = {
					kind: "chip",
					node,
					parent: node.parentNode,
					base,
					length: 1
				};
				segments.push(segment);
				chips.set(node, segment);
				return 1;
			}
			if (node.nodeName === "BR") {
				if (!isManagedLineBreak(node)) segments.push({
					kind: "linebreak",
					node,
					parent: node.parentNode,
					base,
					length: 1
				});
				return brDetectLength(node);
			}
			const start = base;
			const boundaries = [base];
			for (const child of node.childNodes) {
				base += walk(child, base, segments, elements, texts, chips);
				boundaries.push(base);
			}
			elements.set(node, {
				base: start,
				length: base - start,
				boundaries
			});
			return base - start;
		}
		/**
		* Build the detect-projection map over one composer editable.
		*
		* Block gaps: between every consecutive pair of the root's child nodes —
		* mirroring the host's own `$composerLayout` (a gap is one `\n` regardless
		* of what the two neighbors are; empty paragraphs still get their seams).
		*
		* @param root - the contenteditable element (any structural node works).
		*/
		function buildComposerLayoutMap(root) {
			const segments = [];
			const elements = /* @__PURE__ */ new Map();
			const texts = /* @__PURE__ */ new Map();
			const chips = /* @__PURE__ */ new Map();
			let base = 0;
			const kids = root.childNodes;
			const rootBoundaries = [0];
			kids.forEach((child, index) => {
				if (index > 0) {
					rootBoundaries.push(base);
					segments.push({
						kind: "gap",
						node: null,
						parent: root,
						base,
						length: 1
					});
					base += 1;
				}
				base += walk(child, base, segments, elements, texts, chips);
			});
			rootBoundaries.push(base);
			elements.set(root, {
				base: 0,
				length: base,
				boundaries: rootBoundaries
			});
			/** Projected length of one child node (element content, leaf, or 0). */
			const lengthOf = (node) => {
				if (node === void 0) return 0;
				const element = elements.get(node);
				if (element !== void 0) return element.length;
				const text = texts.get(node);
				if (text !== void 0) return text.length;
				const chip = chips.get(node);
				if (chip !== void 0) return chip.length;
				if (node.nodeType === ELEMENT_NODE && node.nodeName === "BR") return brDetectLength(node);
				return 0;
			};
			const detectOffsetOf = (point) => {
				const { container, offset } = point;
				if (container.nodeType === TEXT_NODE) {
					const segment = texts.get(container);
					if (segment !== void 0) return segment.base + Math.min(Math.max(offset, 0), segment.length);
					const chip = nearestChip(chips, container);
					if (chip !== null) return offset <= 0 ? chip.base : chip.base + chip.length;
					return null;
				}
				if (container.nodeType === ELEMENT_NODE) {
					const chip = chips.get(container);
					if (chip !== void 0) return offset <= 0 ? chip.base : chip.base + chip.length;
					const record = elements.get(container);
					if (record !== void 0) {
						const bound = Math.min(Math.max(offset, 0), container.childNodes.length);
						return record.boundaries[bound] ?? record.base + record.length;
					}
					const byAncestor = nearestChip(chips, container);
					if (byAncestor !== null) return offset <= 0 ? byAncestor.base : byAncestor.base + byAncestor.length;
					return null;
				}
				return null;
			};
			const domPointOf = (detectOffset) => {
				if (detectOffset < 0 || detectOffset > base) return null;
				for (let index = 0; index < segments.length; index++) {
					const segment = segments[index];
					if (detectOffset < segment.base || detectOffset > segment.base + segment.length) continue;
					if (detectOffset === segment.base + segment.length) {
						const next = segments[index + 1];
						if (detectOffset < base && next !== void 0 && next.base === detectOffset) continue;
					}
					if (segment.kind === "text" && segment.node !== null) return {
						container: segment.node,
						offset: detectOffset - segment.base
					};
					if (segment.node !== null && segment.parent !== null) {
						const at = indexOfChild(segment.parent, segment.node);
						if (at < 0) continue;
						const before = detectOffset <= segment.base ? at : at + 1;
						return {
							container: segment.parent,
							offset: Math.min(before, segment.parent.childNodes.length)
						};
					}
					if (segment.kind === "gap" && segment.parent !== null) {
						const afterIndex = indexOfDetectStart(segment.parent, segments, segment.base + segment.length);
						return {
							container: segment.parent,
							offset: afterIndex
						};
					}
				}
				return {
					container: root,
					offset: root.childNodes.length
				};
			};
			/** Root childNodes index whose detect start is `detectStart` (end fallback). */
			const indexOfDetectStart = (parent, segs, detectStart) => {
				let accumulate = 0;
				const kidsOf = parent.childNodes;
				for (let index = 0; index < kidsOf.length; index++) {
					const child = kidsOf[index];
					if (index > 0) accumulate += 1;
					if (accumulate >= detectStart) return index;
					accumulate += lengthOf(child);
				}
				return kidsOf.length;
			};
			return {
				detectLength: base,
				detectOffsetOf,
				domPointOf
			};
		}
		/** Nearest chip segment on the ancestor chain, or null. */
		function nearestChip(chips, node) {
			let cursor = node.parentNode;
			while (cursor !== null) {
				const chip = chips.get(cursor);
				if (chip !== void 0) return chip;
				cursor = cursor.parentNode;
			}
			return null;
		}
		/** The live document (injectable for tests). */
		let doc = typeof document !== "undefined" ? document : void 0;
		/**
		* Locate the displayed conversation's editable composer surface. Only an
		* EDITABLE surface answers: the no-session hero card renders the same
		* attributes inert (a workspace trigger, not an input).
		*/
		function findComposerEditable() {
			const el = doc?.querySelector("[data-composer-card] [data-composer-input][contenteditable=\"true\"]");
			return el != null && el.childNodes !== void 0 ? el : null;
		}
		/**
		* Read the live DOM selection of the displayed composer in detect
		* coordinates — the user's last caret or range, which the contenteditable
		* keeps through focus loss into the VS Code iframe. Undefined whenever the
		* composer is absent or the selection is not wholly inside it.
		*/
		function readComposerSelectionDetect() {
			const root = findComposerEditable();
			const selection = doc?.getSelection?.();
			if (root === null || selection === null || selection === void 0 || selection.rangeCount === 0) return void 0;
			const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
			if (anchorNode === null || focusNode === null) return void 0;
			if (!contains(root, anchorNode) || !contains(root, focusNode)) return void 0;
			const layout = buildComposerLayoutMap(root);
			const anchor = layout.detectOffsetOf({
				container: anchorNode,
				offset: anchorOffset
			});
			const focus = layout.detectOffsetOf({
				container: focusNode,
				offset: focusOffset
			});
			if (anchor === null || focus === null) return void 0;
			return {
				start: Math.min(anchor, focus),
				end: Math.max(anchor, focus)
			};
		}
		/**
		* Place the DOM caret of the displayed composer at one detect offset — the
		* contenteditable replacement for the textarea's `setSelectionRange`.
		* Selection only, never focus: the user's focus stays wherever they were
		* working (typically inside the VS Code iframe); Lexical adopts the DOM
		* selection when the surface regains focus. One frame out so a concurrent
		* controlled-value render settles first. Best-effort by design.
		*/
		function restoreComposerCaretDetect(caret) {
			if (findComposerEditable() === null) return;
			requestAnimationFrame(() => {
				try {
					const live = findComposerEditable();
					if (live === null) return;
					const point = buildComposerLayoutMap(live).domPointOf(caret);
					if (point === null) return;
					const selection = doc?.getSelection?.();
					if (selection === null || selection === void 0) return;
					const documentFace = doc;
					if (typeof documentFace.createRange !== "function" || typeof selection.removeAllRanges !== "function" || typeof selection.addRange !== "function") return;
					const range = documentFace.createRange();
					const settable = range;
					if (typeof settable.setStart !== "function" || typeof settable.collapse !== "function") return;
					settable.setStart(point.container, point.offset);
					settable.collapse(true);
					selection.removeAllRanges();
					selection.addRange(range);
				} catch {}
			});
		}
		//#endregion
		//#region src/client/composer.tsx
		/**
		* Composer dock: the reference rail and the paste fallbacks — the DSH-side
		* landing of VS Code selections that did not come through the iframe bridge.
		*
		* The rail projects the input machine's occurrence table (`input.occurrences`,
		* refreshed on every machine change) into one closable tag per distinct
		* vscode-selection reference. Closing a tag removes every chip citing that
		* reference from the draft — on Lexical hosts through the injected
		* chip-preserving removal (span-addressed consume-token transactions; see
		* `removeVscodeReferences`), falling back to the whole-draft `setDraft`
		* splice only where the inject face is absent.
		*
		* Two paste fallbacks cover what the bridge cannot: a clipboard envelope
		* (cross-origin or standalone editor windows) pasted into the composer
		* decodes back into the same reference chips the bridge path produces —
		* landing at the paste caret, like any paste — and a copied reference item
		* — the `@ [ label ]( dsh-vscode: … )` text a rendered chip yields on
		* copy, mangled or canonical — is recovered into chips at the caret with
		* its surrounding prose kept verbatim. Both address the modern
		* contenteditable composer (`div[data-composer-input]`, detect-coordinate
		* selection via the composer DOM mapping) and the textarea-era one alike.
		*
		* @module dsh-sidebar-vscode/client/composer
		*/
		/**
		* The dock entry: renders the reference rail over the live occurrence table
		* and runs the paste fallbacks.
		*/
		function ComposerDock(props) {
			const { session, sessionId: legacySessionId, input, inputActions, lander, pasteMentions, removeRef } = props;
			const sessionId = session?.sessionId ?? legacySessionId;
			const tags = groupRailTags(input.occurrences);
			(0, react.useEffect)(() => {
				const onPaste = (event) => {
					if (event.defaultPrevented) return;
					const target = event.target;
					const textarea = target instanceof HTMLTextAreaElement ? target : null;
					if (!(textarea === null && target instanceof Element && target.closest("[data-composer-input]") !== null && target.closest("[contenteditable=\"true\"]") !== null) && textarea === null) return;
					const clipboard = event.clipboardData;
					if (clipboard === null) return;
					if (clipboard.items !== void 0 && clipboard.items.length > 0 && Array.from(clipboard.items).some((item) => item.kind === "File")) return;
					const text = clipboard.getData("text/plain");
					if (text === "") return;
					/**
					* A handled paste is swallowed whole: preventDefault alone does NOT
					* stop the composer's own paste handling (the Lexical root element
					* listens in the bubble phase; the old textarea world delegated
					* through React), so the capture-phase stopPropagation keeps every
					* downstream listener from firing at all.
					*/
					const swallow = () => {
						event.preventDefault();
						event.stopPropagation();
					};
					/** The paste landing point in the plane the surface speaks. */
					const selection = textarea !== null ? {
						start: textarea.selectionStart ?? 0,
						end: textarea.selectionEnd ?? textarea.selectionStart ?? 0
					} : readComposerSelectionDetect() ?? {
						start: 0,
						end: 0
					};
					const payload = parseClipboardEnvelope(text);
					if (payload !== null) {
						swallow();
						const el = textarea;
						(async () => {
							const outcome = await lander(sessionId, payload, getFallbackOptions(), selection);
							if (outcome.caret !== void 0) {
								const caret = outcome.caret;
								if (el !== null) requestAnimationFrame(() => {
									el.setSelectionRange(caret, caret);
								});
								else restoreComposerCaretDetect(caret);
							}
						})().catch(() => {});
						return;
					}
					const recovered = parseRecoveredPaste(text);
					if (recovered === null) return;
					swallow();
					const el = textarea;
					(async () => {
						const outcome = await pasteMentions(sessionId, recovered.parts, selection);
						if (outcome.caret !== void 0) {
							const caret = outcome.caret;
							if (el !== null) requestAnimationFrame(() => {
								el.setSelectionRange(caret, caret);
							});
							else restoreComposerCaretDetect(caret);
						}
					})().catch(() => {});
				};
				document.addEventListener("paste", onPaste, true);
				return () => {
					document.removeEventListener("paste", onPaste, true);
				};
			}, [
				lander,
				pasteMentions,
				sessionId
			]);
			if (tags.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh_vscodeRef_rail",
				role: "group",
				"aria-label": t("railReferences"),
				"data-vscode-reference-dock": true,
				children: tags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh_vscodeRef_row",
					"data-vscode-reference": tag.ref,
					"data-invalid": tag.invalid ? "true" : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh_vscodeRef_path",
						title: tag.label,
						children: [tag.folder ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderRefIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileRefIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh_vscodeRef_text",
							children: [
								tag.truncated ? "… " : "",
								tag.label,
								tag.count > 1 ? ` ×${tag.count}` : ""
							]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh_vscodeRef_remove",
						"aria-label": `${t("removeReference")}: ${tag.label}`,
						onClick: () => {
							const legacySplice = () => {
								inputActions.setDraft(removeRefRanges(input.draft, input.occurrences, tag.ref));
							};
							if (removeRef === void 0) {
								legacySplice();
								return;
							}
							removeRef(sessionId, tag.ref).then((outcome) => {
								if (outcome.removed === 0 && outcome.degraded) legacySplice();
							}, () => {
								legacySplice();
							});
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(XIcon, {})
					})]
				}, tag.ref))
			});
		}
		/** Locate the textarea-era composer's textarea, when one is displayed. */
		function activeComposerTextarea() {
			const el = document.querySelector("[data-composer-card] textarea");
			return el instanceof HTMLTextAreaElement && !el.disabled ? el : null;
		}
		/**
		* Read the displayed composer's selection — the user's last caret or range,
		* which the surface keeps through focus loss into the VS Code iframe — in
		* the coordinates the displayed surface speaks: detect-projection offsets
		* for the modern contenteditable (see composerDom), draft offsets for the
		* textarea-era composer. Undefined whenever the composer is absent, inert,
		* or holds no addressable selection; the caller then falls back to the
		* draft tail.
		*/
		function readActiveComposerSelection() {
			const fromEditable = readComposerSelectionDetect();
			if (fromEditable !== void 0) return fromEditable;
			const el = activeComposerTextarea();
			if (el === null) return void 0;
			const start = el.selectionStart;
			if (start === null) return void 0;
			return {
				start,
				end: el.selectionEnd ?? start
			};
		}
		/**
		* Restore the displayed composer's caret after an external landing. One
		* frame out — the editor's own commit settles first. Selection only, never
		* focus: the user's focus stays wherever they were working (typically
		* inside the VS Code iframe). Covers both surfaces: the contenteditable
		* mapping (a no-op without one) and the textarea's setSelectionRange.
		*/
		function restoreActiveComposerCaret(caret) {
			restoreComposerCaretDetect(caret);
			const el = activeComposerTextarea();
			if (el !== null) requestAnimationFrame(() => {
				el.setSelectionRange(caret, caret);
			});
		}
		//#endregion
		//#region src/client/settingsCard.tsx
		/**
		* The plugin's configuration card inside the official settings page:
		* 设置 → 插件 → 插件配置 → VSCode 侧边栏.
		*
		* The card registers into the `settings.plugin.item` seat keyed by the
		* `vscode-sidebar` namespace — the same namespace the Host half serves
		* (`src/settingsSection.ts`) — so the configurable-plugins tab pairs the
		* two and dispatches this card under that key. Reads and writes ride the
		* official settings scope (`ctx.settingsScope.bind`): every row commits
		* per action through `scope.set(field, value)`, and the footer's
		* 「恢复默认」 clears the user layer field by field (`scope.unset`) so
		* each reverts to the composition base.
		*
		* The chrome follows the official PluginCard disclosure (the built-in
		* plugin cards and `dsh-web-search-aggregation`'s copy of it): a `<li>`
		* whose header is one full-width button — name over description, a
		* 「已自定义」 chip while any user-layer field is set, a chevron that
		* rotates — disclosing the rows in place. COLLAPSED by default, like
		* every other card on that page: the card is one entry among many, and
		* which card a user opens is a reading gesture this card keeps to itself
		* (`useState`, no persistence).
		*
		* The disclosed rows are the panel this plugin has always owned, carried
		* over end-to-end:
		*
		* - the openAsDefault SWITCH row (the two file-open takeovers' gate);
		* - the openBlocklist TAG row (openBlocklist.ts's contract): extensions
		*   the chat-open takeover must not claim, rendered as removable tag
		*   chips plus one inline free-form input with a suggestion dropdown —
		*   each add/remove persists the whole next array (commit-per-action);
		* - the serverUrl TEXT row, stacked — description on top, the input
		*   alone on its own full-width line below (`pathMap` deliberately has
		*   NO row: the rare split-container rewrite lives in the settings
		*   document only — the read side still honors it when present);
		* - the maxLines / maxBytes NUMBER rows: pre-filled defaults (an unset
		*   field shows the effective default, and merely focusing and blurring
		*   it writes nothing) and input-time range enforcement (an edit below
		*   the declared minimum or above the maximum is flagged the moment it
		*   is typed and snaps to the nearest bound when it commits).
		*
		* A read-only scope (memory mode — a remote browser process-local
		* connection) disables every control and says so; the rows still render
		* the effective values.
		*
		* @module dsh-sidebar-vscode/client/settingsCard
		*/
		/** Copy of one cap row, resolved through t() at render time. */
		const CAP_COPY = {
			maxLines: {
				title: "settingMaxLines",
				desc: "settingMaxLinesDesc"
			},
			maxBytes: {
				title: "settingMaxBytes",
				desc: "settingMaxBytesDesc"
			}
		};
		/** The stacked text rows, in card order (above the cap rows). */
		const TEXT_SPECS = [{
			key: "serverUrl",
			title: "settingServerUrl",
			desc: "settingServerUrlDesc",
			placeholder: "settingServerUrlPlaceholder"
		}];
		/** Every field the card may clear on「恢复默认」. */
		const RESETTABLE_FIELDS = [
			"openAsDefault",
			OPEN_BLOCKLIST_KEY,
			"serverUrl",
			"pathMap",
			"maxLines",
			"maxBytes"
		];
		/**
		* One switch row (the card's boolean settings): title/description left,
		* the standard switch right. Flipping persists the value through the
		* scope; the takeovers read it live, so the very next click follows.
		*/
		function SwitchRow(props) {
			const { title, desc, checked, disabled, onWrite } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_row",
				"data-vscode-switch-row": "openAsDefault",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh_vscodeSet_text",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeSet_title",
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeSet_desc",
						children: desc
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh_vscodeSet_control",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh_vscodeSet_switch",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							className: "dsh_vscodeSet_switchInput",
							checked,
							disabled,
							"aria-label": title,
							onChange: (event) => {
								onWrite(event.currentTarget.checked);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_switchTrack",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh_vscodeSet_switchThumb" })
						})]
					})
				})]
			});
		}
		/**
		* One stacked text row: title/description on top, the input alone on its
		* own full-width line below. Displays the stored string ('' when unset,
		* which the read side treats as "not set" and falls back to the code
		* default); commits the raw text on blur/Enter exactly as typed —
		* including '' when cleared — but only when it actually changed.
		*/
		function TextRow(props) {
			const { spec, raw, disabled, onWrite } = props;
			const title = t(spec.title);
			const placeholder = t(spec.placeholder);
			const effective = typeof raw === "string" ? raw : "";
			const [draft, setDraft] = (0, react.useState)(null);
			const shown = draft ?? effective;
			/** Blur / Enter: persist the draft only when it differs from the stored
			* value (merely focusing and blurring an untouched field writes nothing);
			* an unchanged draft never produces a write, a cleared one stores ''. */
			const commit = () => {
				if (draft === null) return;
				setDraft(null);
				if (draft !== effective) onWrite(draft);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_row dsh_vscodeSet_row--stack",
				"data-vscode-text-row": spec.key,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh_vscodeSet_text",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeSet_title",
						children: title
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeSet_desc",
						children: t(spec.desc)
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "text",
					className: "dsh_vscodeSet_input dsh_vscodeSet_input--block",
					value: shown,
					placeholder,
					spellCheck: false,
					"aria-label": title,
					disabled,
					onChange: (event) => {
						setDraft(event.currentTarget.value);
					},
					onBlur: commit,
					onKeyDown: (event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}
				})]
			});
		}
		/**
		* The blocklist row: the effective extension list as removable tags plus
		* one inline input adding new entries (free-form, normalized on commit —
		* the <datalist> dropdown only SUGGESTS common binary types). Commits per
		* action (each add/remove persists the whole next array), so no
		* draft-vs-store reconciliation exists beyond the input's own text: the
		* composition base is the default list, and the first edit writes an
		* explicit array (removing every tag stores [] — "block nothing", a
		* stored decision, not a reset to the default).
		*/
		function BlocklistRow(props) {
			const { raw, disabled, onWrite } = props;
			const effective = parseOpenBlocklist(raw);
			const [draft, setDraft] = (0, react.useState)("");
			const [invalid, setInvalid] = (0, react.useState)(false);
			/** Adopt one entered extension: empty reverts silently, junk flags the
			* hint (the draft stays fixable), a duplicate is a silent no-op, a real
			* new entry appends and persists. Returns whether the input cleared.
			* Takes the text explicitly because the comma path commits a value the
			* draft state has not flushed yet. */
			const adopt = (text = draft.trim()) => {
				if (text === "") {
					setInvalid(false);
					return true;
				}
				const normalized = normalizeExtension(text);
				if (normalized === null) {
					setDraft(text);
					setInvalid(true);
					return false;
				}
				if (!effective.includes(normalized)) onWrite([...effective, normalized]);
				setDraft("");
				setInvalid(false);
				return true;
			};
			const remove = (extension) => {
				onWrite(effective.filter((entry) => entry !== extension));
			};
			const label = t("settingOpenBlocklist");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_row dsh_vscodeSet_row--stack",
				"data-vscode-blocklist-row": OPEN_BLOCKLIST_KEY,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh_vscodeSet_text",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_title",
							children: label
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_desc",
							children: t("settingOpenBlocklistDesc")
						}),
						invalid && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_hint",
							children: t("settingOpenBlocklistInvalid")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh_vscodeSet_tagWrap",
					children: [
						effective.map((extension) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh_vscodeSet_tag",
							children: [`.${extension}`, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh_vscodeSet_tagX",
								disabled,
								"aria-label": t("settingOpenBlocklistRemove"),
								title: t("settingOpenBlocklistRemove"),
								onClick: () => {
									remove(extension);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
									width: "10",
									height: "10",
									viewBox: "0 0 16 16",
									fill: "none",
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: "M4 4l8 8M12 4l-8 8",
										stroke: "currentColor",
										strokeWidth: "1.6",
										strokeLinecap: "round"
									})
								})
							})]
						}, extension)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "text",
							className: "dsh_vscodeSet_input dsh_vscodeSet_input--inline",
							list: "dsh-vscode-blocklist-suggest",
							value: draft,
							placeholder: t("settingOpenBlocklistPlaceholder"),
							spellCheck: false,
							"aria-label": label,
							"aria-invalid": invalid,
							"data-invalid": invalid ? "true" : void 0,
							disabled,
							onChange: (event) => {
								setDraft(event.currentTarget.value);
								setInvalid(false);
								if (event.currentTarget.value.endsWith(",")) adopt(event.currentTarget.value.slice(0, -1));
							},
							onBlur: () => {
								adopt();
							},
							onKeyDown: (event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									adopt();
								}
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
							id: "dsh-vscode-blocklist-suggest",
							children: blocklistSuggestions(effective).map((suggestion) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: suggestion }, suggestion))
						})
					]
				})]
			});
		}
		/**
		* One numeric cap row: title/desc left, a bounded number input right.
		* Displays the stored value, or the default when unset; flags
		* out-of-range drafts live; commits clamped on blur/Enter.
		*/
		function CapRow(props) {
			const { spec, raw, disabled, onWrite } = props;
			const copy = CAP_COPY[spec.key];
			const effective = displayCap(raw, spec.def);
			const [draft, setDraft] = (0, react.useState)(null);
			const shown = draft ?? String(effective);
			const parsed = Number(shown);
			const outOfRange = shown.trim() !== "" && (!Number.isFinite(parsed) || parsed < spec.min || parsed > spec.max);
			/** Blur / Enter: adopt the clamped draft (writing only on change),
			* or revert to the effective value on empty / unparsable input. */
			const commit = () => {
				if (draft === null) return;
				const next = commitCap(draft, effective, spec.min, spec.max);
				setDraft(null);
				if (next !== null) onWrite(next);
			};
			const title = t(copy.title);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_row",
				"data-vscode-cap-row": spec.key,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "dsh_vscodeSet_text",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_title",
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_desc",
							children: t(copy.desc)
						}),
						outOfRange && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_hint",
							children: t("settingRangeHint")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsh_vscodeSet_control",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "number",
						className: "dsh_vscodeSet_input",
						value: shown,
						min: spec.min,
						max: spec.max,
						step: 1,
						inputMode: "numeric",
						"aria-label": title,
						"aria-invalid": outOfRange,
						disabled,
						title: outOfRange ? t("settingRangeHint") : void 0,
						"data-invalid": outOfRange ? "true" : void 0,
						onChange: (event) => {
							setDraft(event.currentTarget.value);
						},
						onBlur: commit,
						onKeyDown: (event) => {
							if (event.key === "Enter") event.currentTarget.blur();
						}
					})
				})]
			});
		}
		/**
		* The card: the disclosure header (collapsed at rest, like every card on
		* that page) over the disclosed body — the takeover switch, the
		* open-blocklist tag row (it qualifies the switch above it — which files
		* that takeover must NOT claim), the serverUrl text row, one {@link
		* CapRow} per declared cap spec, and the reset footer — reading and
		* writing the `vscode-sidebar` settings section.
		*/
		function VscodeSettingsCard(props) {
			const { scope } = props;
			const snapshot = useSettingsSnapshot(scope);
			const values = snapshot.value ?? VSCODE_SIDEBAR_SETTINGS_BASE;
			const disabled = !snapshot.writable;
			const user = readUserLayer(scope);
			const overridden = RESETTABLE_FIELDS.filter((field) => field in user);
			const [resetting, setResetting] = (0, react.useState)(false);
			const [open, setOpen] = (0, react.useState)(false);
			/** 「恢复默认」: clear the user layer field by field, so every row
			* re-inherits the composition base (the code defaults). */
			const resetDefaults = () => {
				if (scope === void 0 || resetting) return;
				setResetting(true);
				Promise.all(overridden.map((field) => scope.unset(field))).catch(() => {}).finally(() => {
					setResetting(false);
				});
			};
			const write = (field, value) => {
				scope?.set(field, value).catch(() => {});
			};
			const title = t("cardTitle");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: open ? "dsh_vscodeSet_card dsh_vscodeSet_card--open" : "dsh_vscodeSet_card",
				"data-vscode-settings-card": snapshot.status,
				"data-vscode-card-open": open ? "true" : "false",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh_vscodeSet_cardHead",
					"aria-expanded": open,
					"aria-label": `${t(open ? "cardCollapse" : "cardExpand")}: ${title}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh_vscodeSet_cardText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh_vscodeSet_cardTitle",
								children: title
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh_vscodeSet_cardDesc",
								children: t("cardDescription")
							})]
						}),
						overridden.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeSet_chip",
							children: t("cardCustomized")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
							className: "dsh_vscodeSet_chevron",
							width: "14",
							height: "14",
							viewBox: "0 0 16 16",
							fill: "none",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
								d: "M4 6l4 4 4-4",
								stroke: "currentColor",
								strokeWidth: "1.5",
								strokeLinecap: "round",
								strokeLinejoin: "round"
							})
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh_vscodeSet_cardBody",
					children: [
						disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh_vscodeSet_readonly",
							children: t("cardReadOnly")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh_vscodeSet_rows",
							"data-vscode-settings": true,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
									title: t("settingOpenAsDefault"),
									desc: t("settingOpenAsDefaultDesc"),
									checked: values.openAsDefault === true,
									disabled,
									onWrite: (next) => {
										write("openAsDefault", next);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BlocklistRow, {
									raw: values.openBlocklist,
									disabled,
									onWrite: (value) => {
										write("openBlocklist", [...value]);
									}
								}),
								TEXT_SPECS.map((spec) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
									spec,
									raw: values[spec.key],
									disabled,
									onWrite: (value) => {
										write(spec.key, value);
									}
								}, spec.key)),
								CAP_SPECS.map((spec) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapRow, {
									spec,
									raw: values[spec.key],
									disabled,
									onWrite: (value) => {
										write(spec.key, value);
									}
								}, spec.key))
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh_vscodeSet_foot",
							children: overridden.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh_vscodeSet_footNote",
								children: t("cardCustomized")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh_vscodeSet_reset",
								disabled: disabled || resetting,
								onClick: resetDefaults,
								children: t("cardReset")
							})] })
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/** The registry. Keep each block byte-identical when moving a sheet in. */
		const STYLE_SHEETS = {
			tab: {
				id: "dsh-sidebar-vscode-tab-css",
				css: `
.dsh_vscodeTab_root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeTab_strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 5px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
}
.dsh_vscodeTab_title {
  flex: none;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  white-space: nowrap;
}
.dsh_vscodeTab_path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeTab_spacer {
  flex: 1;
}
.dsh_vscodeTab_reload {
  flex: none;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.dsh_vscodeTab_reload:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_open {
  flex: none;
  padding: 3px 2px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.12s;
}
.dsh_vscodeTab_open:hover {
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTab_notice {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-state-warn-tertiary);
}
.dsh_vscodeTab_noticeText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeTab_surface {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.dsh_vscodeTab_frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.dsh_vscodeTab_loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  font: var(--dsw-font-xs-13);
  color: var(--dsw-alias-label-tertiary);
  pointer-events: none;
}
.dsh_vscodeTab_loadingHint {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.8;
  max-width: 420px;
}
`
			},
			rail: {
				id: "dsh-sidebar-vscode-composer-css",
				css: `
.dsh_vscodeRef_rail {
  box-sizing: border-box;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 6px;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance));
  max-width: var(--dsh-composer-card-max-width);
  min-width: 0;
  margin: 0 auto;
}
.dsh_vscodeRef_row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_vscodeRef_row[data-invalid='true'] {
  opacity: 0.55;
}
.dsh_vscodeRef_row[data-invalid='true'] .dsh_vscodeRef_path {
  text-decoration: line-through;
}
.dsh_vscodeRef_path {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 360px;
  height: 100%;
  padding: 0 6px 0 10px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeRef_icon {
  flex: none;
  width: 14px;
  height: 14px;
}
.dsh_vscodeRef_text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh_vscodeRef_remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--dsw-alias-label-dimmed);
  cursor: pointer;
}
.dsh_vscodeRef_remove svg {
  width: 12px;
  height: 12px;
}
.dsh_vscodeRef_remove:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
`
			},
			settings: {
				id: "dsh-sidebar-vscode-settings-css",
				css: `
/* The card shell: one plugin's disclosure box inside the official
 * configurable-plugins tab (设置 → 插件 → 插件配置), matching that tab's
 * card rhythm over the same host tokens — collapsed at rest, the whole
 * header one button, the body disclosed in place. */
.dsh_vscodeSet_card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 0.16s, background 0.16s;
}
.dsh_vscodeSet_card:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_card--open {
  border-color: var(--dsw-alias-label-dimmed);
  background: var(--dsw-alias-bg-layer-2);
}
/* The header: one full-width button stacking the name over the line
 * describing what the settings govern, with the disclosure glyph at its
 * end (the official PluginCard rhythm). */
.dsh_vscodeSet_cardHead {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  border: 0;
  border-radius: 12px;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh_vscodeSet_cardHead:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dsh_vscodeSet_cardText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}
.dsh_vscodeSet_cardTitle {
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_cardDesc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
/* Marker for a card holding user-layer overrides (the chip the official
 * chrome gives an unsaved card; ours marks persisted customization). */
.dsh_vscodeSet_chip {
  flex: none;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
}
.dsh_vscodeSet_chevron {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 0.16s;
}
.dsh_vscodeSet_card--open .dsh_vscodeSet_chevron {
  transform: rotate(180deg);
}
/* The disclosed body: separated from the header by the section hairline,
 * inset to the header's text column. */
.dsh_vscodeSet_cardBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 16px;
  padding: 12px 0 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dsh_vscodeSet_foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 0;
  min-height: 30px;
}
.dsh_vscodeSet_footNote {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeSet_reset {
  flex: none;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.dsh_vscodeSet_reset:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_reset:disabled {
  opacity: 0.5;
  cursor: default;
}
.dsh_vscodeSet_readonly {
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-state-warn-tertiary);
  color: var(--dsw-alias-state-warn-label);
  font: var(--dsw-font-xxs-12);
}
.dsh_vscodeSet_rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}
.dsh_vscodeSet_row {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color 0.16s, background 0.16s;
}
.dsh_vscodeSet_row:hover {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_row--stack {
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 8px;
}
.dsh_vscodeSet_text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh_vscodeSet_title {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeSet_hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
.dsh_vscodeSet_control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh_vscodeSet_input {
  width: 96px;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 18px;
}
.dsh_vscodeSet_input--block {
  width: 100%;
}
.dsh_vscodeSet_input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh_vscodeSet_input[data-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh_vscodeSet_input[data-invalid='true']:focus-visible {
  outline-color: var(--dsw-alias-state-error-primary);
}
/* The blocklist row: existing extensions as removable tags, one inline
 * input (with a <datalist> of common suggestions) growing in their wrap.
 * Tag chrome mirrors the turn-tail chips over the same host tokens. */
.dsh_vscodeSet_tagWrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.dsh_vscodeSet_tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px 1px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsh_vscodeSet_tagX {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh_vscodeSet_tagX:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeSet_tagX:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh_vscodeSet_input--inline {
  flex: 1 1 88px;
  width: auto;
  min-width: 72px;
}
/* The switch row's control — the platform-standard switch shape (label +
 * visually-hidden checkbox input + track/thumb spans), so the card reads
 * as one design language with the host's own settings surfaces. */
.dsh_vscodeSet_switch {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.dsh_vscodeSet_switchInput {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.dsh_vscodeSet_switchTrack {
  display: inline-flex;
  align-items: center;
  width: 36px;
  height: 20px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dsh_vscodeSet_switchThumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  transition: transform 0.15s ease, background 0.15s ease;
}
.dsh_vscodeSet_switch:hover .dsh_vscodeSet_switchTrack {
  border-color: var(--dsw-alias-label-dimmed);
}
.dsh_vscodeSet_switchInput:checked + .dsh_vscodeSet_switchTrack {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
}
.dsh_vscodeSet_switchInput:checked + .dsh_vscodeSet_switchTrack .dsh_vscodeSet_switchThumb {
  transform: translateX(16px);
  background: var(--dsw-alias-bg-layer-3);
}
.dsh_vscodeSet_switchInput:focus-visible + .dsh_vscodeSet_switchTrack {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
`
			}
		};
		/**
		* Idempotently install the named stylesheets into `document.head`.
		* Tokens and layout variables are host globals, so the sheets stand alone.
		* @param ids - the sheets to install (any subset, any order).
		* @returns a disposer removing the adopted elements (safe to call twice).
		*/
		function adoptPluginStyles(...ids) {
			const owned = [];
			for (const id of ids) {
				const sheet = STYLE_SHEETS[id];
				const existing = document.getElementById(sheet.id);
				if (existing !== null) {
					owned.push(existing);
					continue;
				}
				const style = document.createElement("style");
				style.id = sheet.id;
				style.dataset.plugin = "dsh-sidebar-vscode";
				style.dataset.pluginCss = sheet.id;
				style.textContent = sheet.css;
				document.head.appendChild(style);
				owned.push(style);
			}
			return () => {
				for (const node of owned) node.remove();
			};
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Browser half of `dsh-sidebar-vscode`: a thin composition root over the
		* OFFICIAL right-Sidebar system. The plugin's client-side mechanisms live
		* in their own modules — the tab body (VscodeView.tsx and its
		* controllers), the reference pipeline (references.ts / composer.tsx /
		* referencePipeline.ts), the takeover family (takeovers.ts), the settings
		* card (settingsCard.tsx) — and this entry only wires them to the
		* services:
		*
		* - the `vscode` tab type, registered in the official two stages: the
		*   static definition into `ctx.sidebarRightTabs` (guide-page entry box
		*   included) and the body into the keyed `sidebar.right.pane.tab` seat
		*   under the definition's id — the embedded VS Code web workbench at the
		*   session's workspace;
		* - an `@`-trigger source named 'vscode-reference' whose codec serializes
		*   this plugin's occurrence chips back to their canonical mention at
		*   submit (the input machine routes serialization by source name);
		* - a reference lander shared by the clipboard bridge (tab component) and
		*   the paste fallback (composer dock): payload → chips on the addressed
		*   session's composer, plain-text mention as the degraded path;
		* - the takeover family (takeovers.ts): the official
		*   `ctx.sidebarRight.openResource` funnel, the collapsed column's expand
		*   button, and the settings page's「打开配置文件」button rerouted into
		*   the workbench tab, all behind the openAsDefault switch and the open
		*   blocklist;
		* - the configuration card (settingsCard.tsx) inside the official
		*   设置 → 插件 → 插件配置 tab, keyed by the `vscode-sidebar` namespace
		*   the Host half serves.
		*
		* @module dsh-sidebar-vscode/client
		*/
		/** Services required before mounting: the official right-Sidebar's tab
		* registry and navigation controller, the slot registry (the tab body,
		* the composer dock, and the settings card seats), the locale service,
		* the session registry, the conversation input service, the trigger
		* registry (chip serialization routing), the settings scope (the
		* `vscode-sidebar` namespace), and the connection service (the legacy
		* settings.openDocument seam). */
		const inject = [
			"sidebarRightTabs",
			"sidebarRight",
			"slots",
			"locale",
			"sessions",
			"conversation",
			"inputTriggers",
			"settingsScope",
			"connection"
		];
		/**
		* Whether the currently displayed conversation is the addressed session —
		* the gate for reading (and restoring) the displayed composer's caret on
		* its behalf: a composer showing another session holds another draft, so
		* its selection offsets would be meaningless for this landing.
		*/
		function composerDisplayedFor(sessions, sessionId) {
			if (sessionId === void 0) return false;
			return sessions?.list?.getSnapshot().current === sessionId;
		}
		/**
		* The addressed session's live composer caret, in the plane the machine
		* addresses edits in — the bridge path's insertion point.
		*
		* Lexical hosts answer through the input resolver's keyboard face
		* (`conversation.input.keyboard(id).caretSpan()`): the editor's own
		* selection projection, per-session correct and kept through focus loss
		* into the VS Code iframe. Hosts without the face fall back to the DOM
		* selection of the displayed composer (the modern contenteditable mapping,
		* or the old textarea), gated on the displayed session matching — only the
		* displayed conversation's surface is meaningful there.
		*/
		function readComposerPoint(client, sessionId) {
			if (sessionId === void 0) return void 0;
			const keyboard = client.conversation?.input.keyboard;
			if (keyboard !== void 0) try {
				return {
					point: keyboard(sessionId).caretSpan(),
					fromDom: false
				};
			} catch {}
			if (!composerDisplayedFor(client.sessions, sessionId)) return void 0;
			const fromSurface = readActiveComposerSelection();
			return fromSurface === void 0 ? void 0 : {
				point: fromSurface,
				fromDom: true
			};
		}
		/**
		* Client plugin body.
		* @param ctx - the client cordis context (the official sidebar services +
		* slots + locale + sessions + conversation + inputTriggers + settingsScope
		* + connection).
		*/
		function apply(ctx) {
			const client = ctx;
			client.effect(() => attachLocale(client.locale), "dsh-sidebar-vscode: dictionaries");
			const scope = client.settingsScope?.bind({ namespace: VSCODE_SIDEBAR_SETTINGS_NAMESPACE });
			const lander = (sessionId, payload, options, at) => {
				return (async () => {
					const ownPoint = at === void 0;
					const resolved = at === void 0 ? readComposerPoint(client, sessionId) : void 0;
					const point = at !== void 0 ? at : resolved?.point;
					const refs = isResourceList(payload) ? buildResourceRefsFromPayload(payload, {
						reverseRules: options.reverseRules,
						cwd: options.cwd
					}) : await buildRefsFromPayload(payload, {
						reverseRules: options.reverseRules,
						cwd: options.cwd,
						maxLines: options.maxLines,
						maxBytes: options.maxBytes
					});
					const outcome = await insertVscodeReferences(client.sessions, client.conversation, sessionId, refs, point);
					if (ownPoint && resolved?.fromDom === true && outcome.caret !== void 0) restoreActiveComposerCaret(outcome.caret);
					return outcome;
				})();
			};
			const pasteMentions = (sessionId, parts, selection) => {
				return pasteRecoveredMentions(client.sessions, client.conversation, sessionId, parts, selection);
			};
			const removeRef = (sessionId, ref) => {
				return removeVscodeReferences(client.sessions, client.conversation, sessionId, ref);
			};
			client.effect(() => {
				setReferenceLander(lander);
				return () => {
					setReferenceLander(void 0);
				};
			}, "dsh-sidebar-vscode: reference lander handle");
			client.effect(() => {
				const disposeStyles = adoptPluginStyles("rail");
				const stop = client.slots.inject("conversation.input.dock", () => client.slots.register({
					name: "conversation.input.dock",
					id: "dsh-sidebar-vscode-composer",
					order: 30,
					inject: () => ({
						lander,
						pasteMentions,
						removeRef
					})
				}, ComposerDock));
				return () => {
					stop();
					disposeStyles();
				};
			}, "dsh-sidebar-vscode: composer dock");
			const source = {
				trigger: "@",
				name: VSCODE_SOURCE,
				showGroupTitle: false,
				async candidates() {
					return [];
				},
				onPick() {},
				codec: {
					clipboardText: (ref) => ref,
					serialize: (ref) => Promise.resolve(ref)
				}
			};
			client.effect(() => {
				const stop = client.inputTriggers?.registerSource(source);
				return () => {
					stop?.();
				};
			}, "dsh-sidebar-vscode: @ source");
			const tabs = client.sidebarRightTabs;
			const sidebarRight = client.sidebarRight;
			if (tabs === void 0 || sidebarRight === void 0) return;
			client.effect(() => {
				const disposeStyles = adoptPluginStyles("tab");
				const stop = tabs.register(vscodeTabDefinition());
				return () => {
					stop();
					disposeStyles();
				};
			}, "dsh-sidebar-vscode: vscode tab type");
			client.effect(() => {
				const stop = client.slots.inject("sidebar.right.pane.tab", () => client.slots.register({
					name: "sidebar.right.pane.tab",
					key: VSCODE_ID,
					locale: NS,
					inject: () => ({ settings: scope })
				}, VscodeView));
				return () => {
					stop();
				};
			}, "dsh-sidebar-vscode: vscode tab body");
			client.effect(() => {
				return installTakeovers(client, scope);
			}, "dsh-sidebar-vscode: chat + expand + settings open takeover");
			client.effect(() => {
				const disposeStyles = adoptPluginStyles("settings");
				const stop = client.slots.inject("settings.plugin.item", () => client.slots.register({
					name: "settings.plugin.item",
					key: VSCODE_SIDEBAR_SETTINGS_NAMESPACE,
					locale: NS,
					inject: () => ({ scope })
				}, VscodeSettingsCard));
				return () => {
					stop();
					disposeStyles();
				};
			}, "dsh-sidebar-vscode: settings card");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map