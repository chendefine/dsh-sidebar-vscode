window.__ModuleLoader__.load({
	id: "dsh-sidebar-vscode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/settings.ts
		/**
		* Reads this tab's persisted pluginSettings blob. The gear popup on the
		* VSCode card (侧边卡片 → VSCode → 功能设置) renders this plugin's own
		* settings panel (settingsRows.tsx — stacked rows: description on top,
		* full-width input below), which writes `serverUrl` / `pathMap` (and the
		* cap keys) into `pluginSettings['dsh-sidebar-vscode:vscode']` in the
		* better-sidebar prefs document; the tab component reads the same keys
		* each render.
		*
		* Also owns the numeric capture-cap contract (`maxLines` / `maxBytes`):
		* the code defaults, the UI bounds, and the pure display/commit helpers
		* the cap settings panel (settingsRows.tsx) and the read side
		* (references.ts) share — one source of truth so the field, the store,
		* and the truncation pipeline can never disagree.
		*
		* @module dsh-sidebar-vscode/client/settings
		*/
		/** The better-sidebar tab descriptor id this plugin registers. */
		const TAB_ID = "dsh-sidebar-vscode:vscode";
		const MAX_LINES_MAX = 2e3;
		/** Default / bounds of the `maxBytes` cap (rendered reference UTF-8 bytes). */
		const MAX_BYTES_DEFAULT = 2e4;
		const MAX_BYTES_MIN = 1e3;
		const MAX_BYTES_MAX = 2e5;
		/** The cap rows, in settings-popup order. */
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
		* untouched field never writes anything — the old auto-fill-min bug).
		*/
		function commitCap(raw, effective, min, max) {
			if (raw.trim() === "") return null;
			const parsed = Number(raw);
			if (!Number.isFinite(parsed)) return null;
			const clamped = clampCap(parsed, min, max);
			return clamped === effective ? null : clamped;
		}
		/**
		* Read one string setting from this tab's pluginSettings blob.
		* Returns '' when absent or not a string (callers treat '' as "not set").
		*/
		function readSetting(store, key) {
			if (store === void 0) return "";
			const value = store.getSnapshot().prefs.pluginSettings[TAB_ID]?.[key];
			return typeof value === "string" ? value : "";
		}
		/**
		* Read one raw setting value from this tab's pluginSettings blob (switches
		* write booleans, number rows write numbers; text rows write strings).
		* Returns undefined when absent or when the store is unavailable.
		*/
		function readSettingValue(store, key) {
			if (store === void 0) return void 0;
			return store.getSnapshot().prefs.pluginSettings[TAB_ID]?.[key];
		}
		//#endregion
		//#region src/client/paths.ts
		/** The built-in default mapping used when the setting is empty/invalid. */
		const DEFAULT_PATH_MAP = "/data/workspace=/data/workspace;/opt=/opt";
		/** The built-in default VS Code server base URL (same-origin gateway subpath). */
		const DEFAULT_SERVER_URL = "/vscode";
		/** Normalize one directory prefix: trim, ensure a single leading '/', drop trailing '/'. */
		function normalizePrefix(raw) {
			let value = raw.trim();
			if (value === "") return "";
			value = value.replace(/\/+/g, "/").replace(/^\/?/, "/");
			while (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
			return value;
		}
		/**
		* Parse the user-facing `pathMap` setting (`src=dst;src2=dst2`). Empty or
		* fully-malformed input falls back to {@link DEFAULT_PATH_MAP}. Malformed
		* single entries are skipped (the rest still apply). Rules are returned
		* longest-source-prefix first (stable among equals) so the most specific
		* rule wins in {@link mapPath}.
		*/
		function parsePathMap(spec) {
			const text = spec === void 0 ? "" : spec.trim();
			const source = text === "" ? DEFAULT_PATH_MAP : text;
			const rules = [];
			for (const part of source.split(";")) {
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
			if (rules.length === 0) return parsePathMap(DEFAULT_PATH_MAP);
			return [...rules].sort((a, b) => b.from.length - a.from.length);
		}
		/** Whether `path` is `prefix` itself or a path segment under it. */
		function under(path, prefix) {
			if (prefix === "/") return path.startsWith("/");
			return path === prefix || path.startsWith(`${prefix}/`);
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
		function mapPath(path, rules) {
			const clean = path.trim();
			if (clean === "" || !clean.startsWith("/")) return null;
			for (const rule of rules) {
				if (!under(clean, rule.from)) continue;
				const suffix = rule.from === "/" ? clean : clean.slice(rule.from.length);
				return `${rule.to}${suffix}`;
			}
			for (const rule of rules) if (under(clean, rule.to)) return clean;
			return null;
		}
		/**
		* Map one DSH-side path for a FILE OPEN: {@link mapPath} when a rule
		* matches, else the path itself passed through unchanged.
		*
		* Rationale: unmapped ≠ unopenable. DSH and the VS Code server share one
		* filesystem in the default same-container deployment, so any absolute
		* path the session can read the workbench can open; whether the file
		* actually exists is the open channel's call (the extension stats and
		* warns "file not found", the URL-payload channel lets VS Code report
		* it). Refusing the open client-side just because no rule matched — the
		* old behavior — turned perfectly readable out-of-map files (e.g.
		* `/app`, `/tmp`) into the「文件路径无法映射到 VSCode 容器」error.
		*
		* Returns null only for input nothing sensible can be done with: empty
		* or non-absolute paths (the open channels all address POSIX absolute
		* paths).
		*/
		function mapPathForOpen(path, rules) {
			const clean = path.trim();
			if (clean === "" || !clean.startsWith("/")) return null;
			return mapPath(clean, rules) ?? clean;
		}
		/**
		* The inverse of {@link mapPath}: translate one VS Code-server-side path
		* back into the DSH session's view of the same file (longest destination
		* prefix wins; a path already sitting under a SOURCE prefix is DSH-side
		* already and passes through). Used when a selection reference arrives from
		* the embedded VS Code and must name the file the way the DSH session (and
		* the agent's tools) see it.
		*/
		function reverseMapPath(path, rules) {
			const clean = path.trim();
			if (clean === "" || !clean.startsWith("/")) return null;
			const byDest = [...rules].sort((a, b) => b.to.length - a.to.length);
			for (const rule of byDest) {
				if (!under(clean, rule.to)) continue;
				const suffix = rule.to === "/" ? clean : clean.slice(rule.to.length);
				return `${rule.from}${suffix}`;
			}
			for (const rule of rules) if (under(clean, rule.from)) return clean;
			return null;
		}
		/**
		* Normalize the `serverUrl` setting into a usable base: empty → the
		* same-origin gateway subpath ({@link DEFAULT_SERVER_URL}); trailing slashes
		* dropped; a value with neither a URL scheme nor a leading '/' is treated as
		* a subpath and anchored to the page root.
		*/
		function normalizeBaseUrl(raw) {
			const value = (raw ?? "").trim();
			if (value === "") return DEFAULT_SERVER_URL;
			const anchored = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith("/") ? value : `/${value}`;
			return anchored.replace(/\/+$/, "") === "" ? "/" : anchored.replace(/\/+$/, "");
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
				return typeof s.startLine === "number" && typeof s.endLine === "number" && typeof s.text === "string" && Number.isFinite(s.startLine) && Number.isFinite(s.endLine) && s.startLine >= 1 && s.endLine >= s.startLine;
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
		* same gateway origin (the `/vscode` subpath), so this plugin — running in the
		* top window — has full same-origin access to the iframe's window. And the
		* extension-host clipboard chain is
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
		* host) cannot be bridged — the install call simply no-ops there, leaving
		* the composer-side paste fallback as the only path.
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
			const clip = win?.navigator?.clipboard;
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
		* Insertion goes through the session's `SessionInput.insertReference` with a
		* revision-CAS'd span at the caller's addressed point — the composer's caret
		* (a selected range replaces it), the point just past the previous reference
		* for a batch, or the end-of-draft zero-width span when no point is
		* addressable — the same machine transaction the trigger-menu pipeline uses,
		* so every chip is an atomic occurrence:
		* backspace deletes it whole, submit serializes it through this plugin's
		* trigger-source codec, and the draft text (not any side table) is the single
		* store of what will be injected at `agent/pre-step`.
		*
		* @module dsh-sidebar-vscode/client/references
		*/
		/** The occurrence/source name this plugin registers in the trigger registry. */
		const VSCODE_SOURCE = "vscode-reference";
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
		/**
		* Insert references as atomic chips on the addressed session's composer,
		* at the caller's addressed point: the first reference replaces the `at`
		* range (a bare caret is the zero-width case), every following one splices
		* at the point just past its predecessor, and a missing `at` keeps the
		* historical end-of-draft append. Whenever the input machine refuses the
		* chip transaction (mid-submit phases, CAS loss after retry) the canonical
		* mention lands as plain text over the same point — paste geometry when one
		* was addressed, the separator-aware tail append otherwise. The host
		* boundary parses plain-text mentions identically, so the text path
		* degrades only the chip affordance — never the context.
		*
		* @param sessions - the sessions service (scope resolution).
		* @param conversation - the conversation service (input resolver).
		* @param sessionId - the addressed session.
		* @param refs - references to land, in order.
		* @param at - the draft range the references replace (usually the composer
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
						start: snapshot.draft.length,
						end: snapshot.draft.length
					} : clampSpan(next, snapshot.draft.length);
					const beforeLen = snapshot.draft.length;
					landed = input.insertReference(ref, {
						...span,
						draftRev: snapshot.draftRev
					});
					if (landed) {
						const afterLen = input.state.getSnapshot().draft.length;
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
					const draft = appendMention(snapshot.draft, ref.ref);
					input.setDraft(draft);
					caret = draft.length;
				} else {
					const point = clampSpan(next, snapshot.draft.length).start;
					const tail = snapshot.draft.slice(point);
					const gap = tail.length === 0 || tail[0] !== " " ? " " : "";
					const replacement = `${ref.ref}${gap}`;
					input.setDraft(`${snapshot.draft.slice(0, point)}${replacement}${snapshot.draft.slice(point)}`, {
						start: point,
						end: point,
						insertedLength: replacement.length
					});
					caret = point + replacement.length;
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
		/** Chip display text — the exact range an occurrence occupies in the draft. */
		function chipDisplay(ref) {
			return `@${ref.label}`;
		}
		/**
		* Land one parsed paste on the addressed session's composer at the paste
		* selection: the prose inserts verbatim and every mention becomes an atomic
		* chip, in ONE draft write followed by per-chip upgrades from the LAST chip
		* backwards (earlier spans keep their offsets while later ones mutate the
		* draft). A chip upgrade the machine refuses (transient phases, CAS loss)
		* degrades that one mention to its canonical plain-text mention over the
		* same range — the host boundary parses it identically, so only the chip
		* affordance is lost, never the context.
		*
		* @param sessions - the sessions service (scope resolution).
		* @param conversation - the conversation service (input resolver).
		* @param sessionId - the addressed session.
		* @param parts - the parsed paste (see {@link parseRecoveredPaste}).
		* @param selection - the draft range the paste replaces (usually the caret).
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
			settingServerUrl: "VSCode 服务地址",
			settingServerUrlDesc: "VS Code 服务器基地址：同域网关子路径（默认 /vscode）或完整地址（如 http://127.0.0.1:8000/vscode，绕过网关本机直连，需保留 /vscode 基路径）",
			settingServerUrlPlaceholder: "/vscode",
			settingPathMap: "工作区路径映射",
			settingPathMapDesc: "DSH 路径前缀 → VSCode 容器路径前缀，格式 源=目标，多条用 ; 分隔；留空用默认 /data/workspace=/data/workspace;/opt=/opt",
			settingPathMapPlaceholder: "/data/workspace=/data/workspace;/opt=/opt",
			loading: "正在打开 VSCode …",
			loadHint: "长时间空白？请检查「功能设置」里的服务地址是否可达，或用「在新窗口打开」排查",
			reload: "刷新",
			openNewWindow: "在新窗口打开",
			workspace: "工作区",
			unmapped: "当前工作区路径无法映射到 VSCode 容器，已打开默认界面；可在「功能设置」里配置路径映射",
			cwdFailed: "无法获取会话工作目录，已打开 VSCode 默认界面",
			settingMaxLines: "引用最大行数",
			settingMaxLinesDesc: "单次引用注入的代码行数上限，超出时保留首尾两半、省略中间并标注省略区间；未设置时默认 200，可填范围 1–2000",
			settingMaxBytes: "引用最大字节数",
			settingMaxBytesDesc: "单次引用注入的 UTF-8 字节上限（防止压缩成一行的超大文件），超出时同样保留首尾、省略中间；未设置时默认 20000，可填范围 1000–200000",
			settingRangeHint: "超出可填范围，确认时将自动改为最近的边界值",
			settingOpenAsDefault: "侧边栏默认打开 VSCode",
			settingOpenAsDefaultDesc: "新会话的侧边栏默认打开本 VSCode 标签（替换默认的「文件」标签）；同时接管对话里的文件点击（变更文件标签、工具行路径、正文文件引用）和设置页的「打开配置文件」按钮——点击后在本标签的 VS Code 中打开，而不是内置文件标签或系统打开器；关闭后全部恢复默认行为，且已打开过的会话保持各自布局",
			openUnmapped: "文件路径不是容器内绝对路径，未能在 VS Code 中打开（绝对路径不再要求命中映射规则，未匹配时按原路径打开）",
			injectedAsText: "已注入为文本引用（输入框暂不可写入，提交效果相同）",
			injectFailed: "未能注入：当前没有可用的对话输入框",
			produced: "本次产出",
			producedOpen: "在 VS Code 中打开",
			railReferences: "VS Code 代码引用",
			removeReference: "移除引用"
		};
		/** English dictionary. */
		const en = {
			title: "VSCode",
			settingServerUrl: "VSCode server URL",
			settingServerUrlDesc: "VS Code server base URL: same-origin gateway subpath (/vscode by default) or a full address (e.g. http://127.0.0.1:8000/vscode to bypass the gateway locally; keep the /vscode base path)",
			settingServerUrlPlaceholder: "/vscode",
			settingPathMap: "Workspace path mapping",
			settingPathMapDesc: "DSH path prefix → VSCode container prefix, as src=dst pairs joined by \";\" ; empty uses the default /data/workspace=/data/workspace;/opt=/opt",
			settingPathMapPlaceholder: "/data/workspace=/data/workspace;/opt=/opt",
			loading: "Opening VS Code …",
			loadHint: "Blank for long? Check the server URL in the gear settings, or open in a new window to diagnose",
			reload: "Reload",
			openNewWindow: "Open in new window",
			workspace: "Workspace",
			unmapped: "The current workspace path cannot be mapped into the VS Code container; the default view was opened. Configure the path mapping in the gear settings.",
			cwdFailed: "Could not resolve the session working directory; the VS Code default view was opened",
			settingMaxLines: "Reference line cap",
			settingMaxLinesDesc: "Maximum code lines kept per reference; beyond it the head and tail halves are kept, the middle is omitted and marked inline. Defaults to 200 when unset; allowed range 1–2000",
			settingMaxBytes: "Reference byte cap",
			settingMaxBytesDesc: "UTF-8 byte cap per reference (guards single-line minified files); overflow omits the middle the same way. Defaults to 20000 when unset; allowed range 1000–200000",
			settingRangeHint: "Out of the allowed range; it will snap to the nearest bound when confirmed",
			settingOpenAsDefault: "Open VSCode as the sidebar default tab",
			settingOpenAsDefaultDesc: "Brand-new sessions open this VSCode tab instead of the seeded Files tab; the switch also takes over chat-side file clicks (produced-file chips, tool-row paths, prose mentions) and the settings page's \"Open configuration file\" button, so they open in this tab's VS Code instead of the built-in Files tab or the Host OS opener; turning it off restores all defaults, and existing conversations keep their own layouts",
			openUnmapped: "The file path is not an absolute container path; it was not opened in VS Code (absolute paths no longer need a matching mapping rule — unmatched ones open as-is)",
			injectedAsText: "Injected as a text reference (composer briefly unwritable; submitting works the same)",
			injectFailed: "Could not inject: no composer is available",
			produced: "Produced",
			producedOpen: "Open in VS Code",
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
		* @returns the disposer cordis holds via `ctx.effect`.
		*/
		function attachLocale(service) {
			localeService = service;
			service.register(NS, {
				zh: { ...zh },
				en: { ...en }
			});
			return () => {
				localeService = void 0;
			};
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
		//#region src/client/composer.tsx
		/**
		* Composer dock: the reference rail and the paste fallbacks — the DSH-side
		* landing of VS Code selections that did not come through the iframe bridge.
		*
		* The rail projects the input machine's occurrence table (`input.occurrences`,
		* refreshed on every machine change) into one closable tag per distinct
		* vscode-selection reference. Closing a tag removes every chip citing that
		* reference from the draft through `inputActions.setDraft` — the machine's
		* diff-scan reconciles the occurrence table, and once no canonical mention
		* remains in the draft there is nothing for the host boundary to inject.
		*
		* Two paste fallbacks cover what the bridge cannot: a clipboard envelope
		* (cross-origin or standalone editor windows) pasted into the composer
		* textarea decodes back into the same reference chips the bridge path
		* produces — landing at the paste caret, like any paste — and a copied
		* reference item — the `@ [ label ]( dsh-vscode: … )` text a rendered chip
		* yields on copy, mangled or canonical — is recovered into chips at the
		* caret with its surrounding prose kept verbatim.
		*
		* @module dsh-sidebar-vscode/client/composer
		*/
		/** Idempotency id of the injected rail <style> element. */
		const RAIL_STYLE_ID = "dsh-sidebar-vscode-composer-css";
		/**
		* The rail's stylesheet. Class names carry the `dsh_vscodeRef_` prefix; the
		* rules follow the composer's reference-chip geometry (rail layout, 28px
		* pill rows, 13px labels, 20px round remove button) using the host's
		* `--dsw-alias-*` design tokens and `--dsh-composer-*` layout variables.
		* The two extra rules (`[data-invalid='true']`) render this plugin's
		* lost-owner state.
		*/
		const RAIL_CSS = `
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
`;
		/**
		* Idempotently install the rail stylesheet into `document.head`. Tokens and
		* layout variables are host globals, so the stylesheet stands alone.
		* @returns a disposer that removes the element (safe to call twice).
		*/
		function adoptRailStyles() {
			const existing = document.getElementById(RAIL_STYLE_ID);
			if (existing !== null) {
				const node = existing;
				return () => {
					node.remove();
				};
			}
			const style = document.createElement("style");
			style.id = RAIL_STYLE_ID;
			style.dataset.plugin = "dsh-sidebar-vscode";
			style.dataset.pluginCss = RAIL_STYLE_ID;
			style.textContent = RAIL_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/**
		* The dock entry: renders the reference rail over the live occurrence table
		* and runs the paste fallbacks.
		*/
		function ComposerDock(props) {
			const { sessionId, input, inputActions, lander, pasteMentions } = props;
			const tags = groupRailTags(input.occurrences);
			(0, react.useEffect)(() => {
				const onPaste = (event) => {
					if (event.defaultPrevented) return;
					const target = event.target;
					if (!(target instanceof HTMLTextAreaElement)) return;
					const clipboard = event.clipboardData;
					if (clipboard === null) return;
					if (clipboard.items !== void 0 && clipboard.items.length > 0 && Array.from(clipboard.items).some((item) => item.kind === "File")) return;
					const text = clipboard.getData("text/plain");
					if (text === "") return;
					/**
					* A handled paste is swallowed whole: preventDefault alone does NOT
					* stop the composer's React onPaste (it machine-pastes the raw text,
					* duplicating whatever this handler lands), so the capture-phase
					* stopPropagation keeps that handler from firing at all — verified
					* against React 18's root delegation.
					*/
					const swallow = () => {
						event.preventDefault();
						event.stopPropagation();
					};
					const payload = parseClipboardEnvelope(text);
					if (payload !== null) {
						swallow();
						const el = target;
						const selection = {
							start: target.selectionStart ?? 0,
							end: target.selectionEnd ?? target.selectionStart ?? 0
						};
						(async () => {
							const outcome = await lander(sessionId, payload, fallbackOptions, selection);
							if (outcome.caret !== void 0) {
								const caret = outcome.caret;
								requestAnimationFrame(() => {
									el.setSelectionRange(caret, caret);
								});
							}
						})();
						return;
					}
					const recovered = parseRecoveredPaste(text);
					if (recovered === null) return;
					swallow();
					const selection = {
						start: target.selectionStart ?? 0,
						end: target.selectionEnd ?? target.selectionStart ?? 0
					};
					const el = target;
					(async () => {
						const outcome = await pasteMentions(sessionId, recovered.parts, selection);
						if (outcome.caret !== void 0) {
							const caret = outcome.caret;
							requestAnimationFrame(() => {
								el.setSelectionRange(caret, caret);
							});
						}
					})();
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
							inputActions.setDraft(removeRefRanges(input.draft, input.occurrences, tag.ref));
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(XIcon, {})
					})]
				}, tag.ref))
			});
		}
		/** Module-level paste-fallback options (set by the plugin body / tab render). */
		let fallbackOptions = {};
		/** Refresh the paste-fallback options (VSCode tab render path). */
		function setFallbackOptions(options) {
			fallbackOptions = options;
		}
		/** Module-level lander handle (set by the plugin body; cleared on dispose). */
		let lander;
		/** Install the module-level lander handle (plugin body). */
		function setReferenceLander(instance) {
			lander = instance;
		}
		/** The lander installed by the plugin body (undefined before apply). */
		function getReferenceLander() {
			return lander;
		}
		/** Locate the displayed conversation's composer textarea, when addressable. */
		function activeComposerTextarea() {
			const el = document.querySelector("[data-composer-card] textarea");
			return el instanceof HTMLTextAreaElement && !el.disabled ? el : null;
		}
		/**
		* Read the displayed composer's selection — the user's last caret or range,
		* which a textarea keeps through focus loss into the VS Code iframe.
		* Undefined whenever the composer is absent or not addressable; the caller
		* then falls back to the draft tail.
		*/
		function readActiveComposerSelection() {
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
		* frame out — the controlled textarea's value propagates first. Selection
		* only, never focus: the user's focus stays wherever they were working
		* (typically inside the VS Code iframe).
		*/
		function restoreActiveComposerCaret(caret) {
			if (activeComposerTextarea() === null) return;
			requestAnimationFrame(() => {
				const el = activeComposerTextarea();
				if (el !== null) el.setSelectionRange(caret, caret);
			});
		}
		//#endregion
		//#region src/client/openIntercept.ts
		/**
		* Structurally read the openRequest off a tab meta. Returns null for absent
		* or malformed shapes — a foreign meta (another plugin's, or a hand-edited
		* layout) must never crash the consumer.
		*/
		function extractOpenRequest(meta) {
			if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
			const record = meta.openRequest;
			if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
			const req = record;
			if (typeof req.nonce !== "number" || !Number.isFinite(req.nonce)) return null;
			if (typeof req.path !== "string" || req.path === "") return null;
			const out = {
				nonce: req.nonce,
				path: req.path
			};
			if (typeof req.line === "number" && Number.isFinite(req.line) && req.line > 0) out.line = Math.floor(req.line);
			if (typeof req.column === "number" && Number.isFinite(req.column) && req.column > 0) out.column = Math.floor(req.column);
			return out;
		}
		/**
		* Merge one openRequest into an existing tab meta, preserving sibling keys
		* (any other plugin-owned fields on the same meta object survive verbatim).
		*/
		function mergeOpenRequest(meta, request) {
			const base = meta !== null && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
			base.openRequest = { ...request };
			return base;
		}
		/** The last minted nonce (module state — one monotonic sequence per page). */
		let lastNonce = 0;
		/**
		* Mint the next nonce: wall-clock based so sequences survive reloads, but
		* strictly monotonic within a page (two clicks in the same millisecond must
		* still produce increasing values, or the second would be swallowed).
		*/
		function nextNonce(now = Date.now) {
			const current = now();
			lastNonce = current > lastNonce ? current : lastNonce + 1;
			return lastNonce;
		}
		/**
		* Find one tab's meta in a sidebar state (both trees — splits and
		* bottomSplits — are searched). Structural and throw-free: a malformed state
		* simply yields undefined, and `updateTab` on a missing tab is a documented
		* no-op, so a walk failure can never break the reroute.
		*/
		function findTabMeta(state, tabId) {
			if (state === null || typeof state !== "object") return void 0;
			const record = state;
			const top = walkTab(record.splits, tabId);
			if (top !== void 0) return top;
			return walkTab(record.bottomSplits, tabId);
		}
		function walkTab(node, tabId) {
			if (node === null || typeof node !== "object") return void 0;
			const record = node;
			if (record.kind === "leaf" && Array.isArray(record.tabs)) {
				for (const tab of record.tabs) if (tab !== null && typeof tab === "object" && tab.id === tabId) return tab.meta;
				return;
			}
			if (Array.isArray(record.children)) for (const child of record.children) {
				const found = walkTab(child, tabId);
				if (found !== void 0) return found;
			}
		}
		/** Whether a path is absolute (POSIX root, drive letter, or UNC share). */
		function isAbsoluteLike(path) {
			if (path.startsWith("/")) return true;
			if (path.startsWith("\\\\")) return true;
			return /^[a-zA-Z]:[\\/]/.test(path);
		}
		/**
		* Resolve a (possibly relative) path against the session cwd. The two seams
		* differ here: `workspaces.openPath` callers already resolve to absolute
		* (ui-conversation's apply.ts does), while turn-tail produced paths come
		* straight from tool callView `locations` and may be workspace-relative —
		* better-sidebar's own `openSidebarFile` resolves them against the session
		* cwd the same way. Mirrors its `resolveSidebarPath` semantics.
		*/
		function resolveAgainst(cwd, path) {
			if (isAbsoluteLike(path)) return path;
			const base = cwd ?? "";
			if (base === "") return path;
			const separator = base.includes("\\") ? "\\" : "/";
			return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
		}
		/**
		* The reroute driver both seams share: land the VSCode tab (content seed →
		* panel auto-expansion + single-instance focus) and stamp the openRequest
		* meta. The `openTab` call lands on the real service untouched — neither
		* seam wraps openTab (option I was rolled back), and the openPath wrapper
		* is not on this path.
		*/
		function rerouteChatOpen(service, tabId, path) {
			service.openTab({
				type: tabId,
				path
			});
			const state = service.getSnapshot().state;
			service.updateTab(tabId, { meta: mergeOpenRequest(findTabMeta(state, tabId), {
				nonce: nextNonce(),
				path
			}) });
		}
		/**
		* Wrap `workspaces.openPath` — the client runtime's chat file-open funnel —
		* with the SAME takeover gate and reroute as the turn-tail claim (option II).
		*
		* Why this second seam is needed: better-sidebar declines BOTH of its own
		* interceptions whenever its built-in editor tab is disabled in the side
		* card settings (`tabsEnabled['editor'] === false` gates the turn-tail row
		* AND its openPath wrapper — see its intercept.tsx). The open then falls
		* through to the Host OS opener, which on a headless container dies with
		* `spawn xdg-open ENOENT`. Wrapping openPath here keeps chat file opens
		* landing in the VSCode tab even when the user disabled better-sidebar's
		* Files tab (a natural pairing: files belong in VS Code, not the built-in
		* editor).
		*
		* Chain-safety: better-sidebar wraps the same method with the identical
		* RAW-reference restore contract, so the two wrappers compose in any
		* install/dispose order. With both active and the switch on, THIS wrapper
		* (installed later, runs first) intercepts and the call never reaches
		* better-sidebar's — same destination either way.
		*
		* @param workspaces - the client workspaces service to wrap.
		* @param deps - per-call takeover decisions (the same gate as the turn-tail claim's).
		* @returns the disposer restoring the original method (HMR-safe).
		*/
		function wrapWorkspacesOpenPath(workspaces, deps) {
			const original = workspaces.openPath;
			workspaces.openPath = (path) => {
				if (deps.takeoverEnabled() && typeof path === "string" && path !== "") {
					deps.reroute(path);
					return Promise.resolve();
				}
				return original.call(workspaces, path);
			};
			return () => {
				workspaces.openPath = original;
			};
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
		* The routes are fence-protected by the node half (same-origin GUI only),
		* same trust model as better-sidebar's `/sidebar/api`. Both helpers are
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
		* a short TTL so a burst of clicks does not hammer the probe.
		*/
		const CAPABILITY_TTL_MS = 5e3;
		let capabilityCache = null;
		async function probeCapability(folder, fetchLike = defaultFetch, now = Date.now) {
			if (capabilityCache !== null && capabilityCache.folder === folder && now() - capabilityCache.at < CAPABILITY_TTL_MS) return capabilityCache.present;
			const parsed = await postJson("open.capability", { folder }, fetchLike);
			const present = parsed !== null && parsed.value !== null && typeof parsed.value === "object" && parsed.value.present === true;
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
		* The VSCode tab component: resolves the session's authoritative working
		* directory, maps it into the embedded VS Code server's filesystem view
		* (identity in the default same-container deployment), and embeds the
		* VS Code workbench in a same-origin iframe
		* (`<base>/?folder=<mapped cwd>`).
		*
		* Design notes:
		* - The iframe is NOT sandboxed and NOT keyed away on `visible === false`:
		*   the default deployment serves the VS Code server behind the same gateway
		*   (cookies flow, WebSocket terminal works) and the VS Code session should
		*   survive tab switches inside the sidebar.
		* - The authoritative cwd comes from better-sidebar's `/sidebar/api`
		* (`session.cwd`); the scope's optional cwd is used as a fast path.
		* - Settings (`serverUrl`, `pathMap`) are read from the store's prefs
		*   snapshot each render, so gear-popup edits apply on the next render.
		* - All chrome follows the DSH appearance (light / dark / system) through
		*   the host's `--dsw-alias-*` tokens — see `adoptTabStyles` below.
		*
		* @module dsh-sidebar-vscode/client/VscodeView
		*/
		/** Idempotency id of the injected tab <style> element. */
		const TAB_STYLE_ID = "dsh-sidebar-vscode-tab-css";
		/**
		* The tab's stylesheet. Every surface follows the host appearance (light /
		* dark / system) through the shell's `--dsw-alias-*` design tokens — the
		* same palette better-sidebar's own panels, strips, and banners use — so
		* the toolbar reads as native chrome instead of a hard-coded dark bar:
		* the strip sits on `bg-layer-1` with an `border-l1` hairline, labels use
		* the label ramp, the workbench well uses `bg-base` (what better-sidebar
		* paints behind its own iframes), and notices reuse the warn banner pair
		* (`state-warn-label` on `state-warn-tertiary`).
		*/
		const TAB_CSS = `
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
`;
		/**
		* Idempotently install the tab stylesheet into `document.head`. The tokens
		* are host globals maintained by the theme presenter (they flip with the
		* appearance preference, `system` included), so the stylesheet needs no
		* theme awareness of its own.
		* @returns a disposer that removes the element (safe to call twice).
		*/
		function adoptTabStyles() {
			const existing = document.getElementById(TAB_STYLE_ID);
			if (existing !== null) {
				const node = existing;
				return () => {
					node.remove();
				};
			}
			const style = document.createElement("style");
			style.id = TAB_STYLE_ID;
			style.dataset.plugin = "dsh-sidebar-vscode";
			style.dataset.pluginCss = TAB_STYLE_ID;
			style.textContent = TAB_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/**
		* Render the VS Code workbench for the scope's workspace.
		* @param props - the tab component props (scope + the sidebar store).
		*/
		function VscodeView(props) {
			const { scope, store } = props;
			const serverUrl = normalizeBaseUrl(readSetting(store, "serverUrl"));
			const pathMap = parsePathMap(readSetting(store, "pathMap"));
			const [cwd, setCwd] = (0, react.useState)(scope.cwd);
			const [cwdFailed, setCwdFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (scope.cwd !== void 0 && scope.cwd !== "") {
					setCwd(scope.cwd);
					setCwdFailed(false);
					return;
				}
				let cancelled = false;
				const controller = new AbortController();
				setCwd(void 0);
				(async () => {
					try {
						const response = await fetch("/sidebar/api/session.cwd", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ sessionId: scope.sessionId }),
							signal: controller.signal
						});
						const parsed = await response.json().catch(() => null);
						if (cancelled) return;
						if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === void 0) {
							setCwdFailed(true);
							return;
						}
						const value = parsed.value;
						if (typeof value.cwd !== "string" || value.cwd === "") {
							setCwdFailed(true);
							return;
						}
						setCwd(value.cwd);
						setCwdFailed(false);
					} catch {
						if (!cancelled) setCwdFailed(true);
					}
				})();
				return () => {
					cancelled = true;
					controller.abort();
				};
			}, [scope.sessionId, scope.cwd]);
			const mapped = cwd === void 0 ? void 0 : mapPath(cwd, pathMap);
			const unmapped = cwd !== void 0 && mapped === null;
			const openRequest = extractOpenRequest(props.tab?.meta);
			const lastNonce = (0, react.useRef)(Number.NEGATIVE_INFINITY);
			const nonceInitialized = (0, react.useRef)(false);
			const [pendingOpen, setPendingOpen] = (0, react.useState)(null);
			const [flash, setFlash] = (0, react.useState)(null);
			const openInputs = (0, react.useRef)({
				serverUrl,
				pathMap,
				cwd
			});
			openInputs.current = {
				serverUrl,
				pathMap,
				cwd
			};
			const executeOpen = (0, react.useCallback)(async (request) => {
				const { serverUrl: base, pathMap: rules, cwd: workdir } = openInputs.current;
				const workspace = workdir !== void 0 ? mapPath(workdir, rules) : void 0;
				const file = mapPathForOpen(request.path, rules);
				if (file === null) {
					setFlash(`${t("openUnmapped")}: ${request.path}`);
					return;
				}
				if (workspace != null) {
					if (await probeCapability(workspace)) {
						if (await sendOpenCommand({
							folder: workspace,
							path: file,
							nonce: request.nonce,
							line: request.line,
							column: request.column
						})) return;
					}
				}
				let authority = window.location.host;
				try {
					authority = new URL(base, window.location.href).host || authority;
				} catch {}
				setPendingOpen({
					basis: `${base}#${workspace ?? ""}`,
					url: buildVscodeUrl(base, workspace ?? null, {
						file,
						authority,
						line: request.line,
						column: request.column
					})
				});
			}, []);
			(0, react.useEffect)(() => {
				if (!nonceInitialized.current) {
					nonceInitialized.current = true;
					lastNonce.current = openRequest?.nonce ?? Number.NEGATIVE_INFINITY;
					return;
				}
				if (openRequest === null || openRequest.nonce <= lastNonce.current) return;
				lastNonce.current = openRequest.nonce;
				executeOpen(openRequest);
			}, [openRequest?.nonce, executeOpen]);
			const targetBasis = `${serverUrl}#${mapped ?? ""}`;
			const effectivePending = pendingOpen !== null && pendingOpen.basis === targetBasis ? pendingOpen : null;
			const target = effectivePending !== null ? effectivePending.url : buildVscodeUrl(serverUrl, mapped ?? null);
			const ready = cwd !== void 0 || cwdFailed;
			const [loaded, setLoaded] = (0, react.useState)(false);
			const [nonce, setNonce] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				setLoaded(false);
			}, [target]);
			const maxLinesSetting = readSettingValue(store, "maxLines");
			const maxLines = typeof maxLinesSetting === "number" && Number.isFinite(maxLinesSetting) && maxLinesSetting > 0 ? Math.floor(maxLinesSetting) : void 0;
			const maxBytesSetting = readSettingValue(store, "maxBytes");
			const maxBytes = typeof maxBytesSetting === "number" && Number.isFinite(maxBytesSetting) && maxBytesSetting > 0 ? Math.floor(maxBytesSetting) : void 0;
			const iframeRef = (0, react.useRef)(null);
			const bridgeDisposer = (0, react.useRef)(null);
			const bridgeInputs = (0, react.useRef)({
				pathMap,
				maxLines,
				maxBytes,
				cwd,
				sessionId: scope.sessionId
			});
			bridgeInputs.current = {
				pathMap,
				maxLines,
				maxBytes,
				cwd,
				sessionId: scope.sessionId
			};
			setFallbackOptions({
				reverseRules: pathMap,
				cwd,
				maxLines,
				maxBytes
			});
			(0, react.useEffect)(() => {
				if (flash === null) return;
				const timer = window.setTimeout(() => {
					setFlash(null);
				}, 3e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [flash]);
			const handlePayload = (0, react.useCallback)((payload) => {
				const { pathMap: rules, maxLines: lines, maxBytes: bytes, cwd: workdir, sessionId } = bridgeInputs.current;
				return (async () => {
					const lander = getReferenceLander();
					if (lander === void 0) {
						setFlash(t("injectFailed"));
						return false;
					}
					const outcome = await lander(sessionId, payload, {
						reverseRules: rules,
						cwd: workdir,
						maxLines: lines,
						maxBytes: bytes
					});
					if (outcome.failed) {
						setFlash(t("injectFailed"));
						return false;
					}
					if (outcome.textFallback > 0) setFlash(t("injectedAsText"));
					return true;
				})();
			}, []);
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeTab_root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								onClick: () => {
									setLoaded(false);
									setNonce(nonce + 1);
								},
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
					}),
					(unmapped || cwdFailed) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh_vscodeTab_notice",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeTab_noticeText",
							children: cwdFailed ? t("cwdFailed") : t("unmapped")
						})
					}),
					flash !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh_vscodeTab_notice",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh_vscodeTab_noticeText",
							children: flash
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh_vscodeTab_surface",
						children: [ready ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
							ref: iframeRef,
							src: target,
							title: "VSCode",
							onLoad: () => {
								setLoaded(true);
								installBridge();
							},
							className: "dsh_vscodeTab_frame"
						}, `${target}#${nonce}`) : null, !ready || !loaded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh_vscodeTab_loading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("loading") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh_vscodeTab_loadingHint",
								children: t("loadHint")
							})]
						}) : null]
					})
				]
			});
		}
		//#endregion
		//#region src/client/defaultTab.ts
		/**
		* The "sidebar opens VSCode by default" behavior (`openAsDefault`, the
		* switch at the top of this tab's 功能设置 panel).
		*
		* better-sidebar hardcodes every brand-new session's seed: ONE empty
		* 'Files' editor tab (upstream `state.ts` `makeDefaultState`'s
		* 'editor-home' — there is no preference for the seeded tab type). This
		* module is the plugin-side companion the upstream service suggests for
		* exactly that gap: watch the sidebar store, and while the switch is on
		* and the active session still carries its pristine seed, swap that seed
		* for THIS plugin's tab —
		*
		*   service.openTab({ type: TAB_ID })   lands the VSCode tab in the active
		*                                       pane and makes it the pane's
		*                                       active tab (a type-only open never
		*                                       forces the panel open, so a
		*                                       collapsed sidebar stays collapsed:
		*                                       the tab is simply what the user
		*                                       sees on the next expansion);
		*   service.closeTab(<seed id>)         removes the seeded 'Files' tab so
		*                                       the swap is a replacement, not an
		*                                       addition.
		*
		* Safety rails:
		* - PRISTINE GATE: the swap only runs on an untouched seed state (single
		*   pane, at most the one path-less editor tab, no minted counters, no
		*   expansions, no bottom tabs, no floats). Any user or agent activity
		*   makes the state non-pristine and the session keeps its own layout —
		*   the same contract as better-sidebar's own `openByDefault` pref
		*   ("已存在的会话保持各自布局").
		* - ONCE MARKER: `dsh-sidebar-vscode:v1:default-tab:<sessionId>` in
		*   localStorage records that a session already received the swap.
		*   Without it, closing the VSCode tab of a fresh session would leave an
		*   empty pristine-looking seed and the next store notification would
		*   re-open it — the user could never close the tab. The marker also
		*   makes plugin reload / HMR re-apply idempotent.
		* - ENABLE GATE: a disabled tab type never swaps (the seed must not be
		*   removed to make room for a tab that cannot open), and a refused open
		*   (the tab never landed) never closes the seed either.
		*
		* @module dsh-sidebar-vscode/client/defaultTab
		*/
		/** The pluginSettings key of the "sidebar opens VSCode by default" switch. */
		const OPEN_AS_DEFAULT_KEY = "openAsDefault";
		/** localStorage marker prefix: one swap per session, ever (best-effort). */
		const MARKER_PREFIX = "dsh-sidebar-vscode:v1:default-tab";
		/** Depth-first tabs of a split tree. */
		function tabsOf(node) {
			return node.kind === "leaf" ? node.tabs : node.children.flatMap(tabsOf);
		}
		/** Whether a tab is better-sidebar's hardcoded seed (the path-less Files window). */
		function isEditorHomeSeed(tab) {
			return tab.type === "editor" && tab.path === void 0;
		}
		/**
		* Whether the state is an UNTOUCHED fresh-session seed: one pane holding
		* at most the one path-less 'Files' editor tab, and no counter bump
		* anywhere (a minted terminal/browser id, an expanded directory, a
		* bottom-panel tab, a bottom-panel expansion, or a float each prove the
		* session was already used).
		*/
		function isPristineSeed(state) {
			if (state.floats.length > 0) return false;
			if (state.bottomOpenedOnce) return false;
			if (state.nextTerminal !== 1 || state.nextBrowser !== 1) return false;
			if (state.expanded.length > 0) return false;
			if (tabsOf(state.bottomSplits).length > 0) return false;
			if (state.splits.kind !== "leaf") return false;
			const tabs = state.splits.tabs;
			if (tabs.length === 0) return true;
			return tabs.length === 1 && isEditorHomeSeed(tabs[0]);
		}
		/**
		* The seed tab id a pristine state carries (undefined when the seed was
		* empty — the editor tab type disabled, or every tab already closed).
		* Only meaningful on a state {@link isPristineSeed} already accepted.
		*/
		function seedTabIdOf(state) {
			if (state.splits.kind !== "leaf") return void 0;
			const first = state.splits.tabs[0];
			return first !== void 0 && isEditorHomeSeed(first) ? first.id : void 0;
		}
		/** Whether this session already received its swap (best-effort storage). */
		function wasMarked(sessionId) {
			try {
				return localStorage.getItem(`${MARKER_PREFIX}:${sessionId}`) !== null;
			} catch {
				return false;
			}
		}
		/** Record the swap for this session (best-effort; storage may be absent). */
		function markSession(sessionId) {
			try {
				localStorage.setItem(`${MARKER_PREFIX}:${sessionId}`, "1");
			} catch {}
		}
		/**
		* Swap the active session's pristine seed for this plugin's tab: gates on
		* the marker / pristine shape / tab enablement, then opens the VSCode tab
		* and removes the seeded Files tab — but only when the open really landed
		* (a refused open must never cost the sidebar its seed).
		* @returns whether the swap ran.
		*/
		function applyDefaultTab(service) {
			const snapshot = service.getSnapshot();
			const sessionId = snapshot.sessionId;
			const state = snapshot.state;
			if (sessionId === void 0 || state === void 0) return false;
			if (wasMarked(sessionId)) return false;
			if (!isPristineSeed(state)) return false;
			if (!service.isTabEnabled("dsh-sidebar-vscode:vscode")) return false;
			markSession(sessionId);
			service.openTab({ type: TAB_ID });
			const seedTabId = seedTabIdOf(state);
			if (seedTabId === void 0) return true;
			const after = service.getSnapshot().state;
			if (after !== void 0 && tabsOf(after.splits).concat(tabsOf(after.bottomSplits)).some((tab) => tab.type === "dsh-sidebar-vscode:vscode")) service.closeTab(seedTabId);
			return true;
		}
		/**
		* Watch the sidebar store for the default-tab swap. Evaluates once at
		* startup (a session may already be active and pristine) and on every
		* store notification — session switches, state changes, and prefs writes.
		* The prefs path matters twice: the settings document resolves AFTER the
		* store's defaults at boot, and the switch's own write re-triggers this
		* evaluation, so flipping it on applies to a still-pristine active
		* session without any extra plumbing (used sessions keep their layouts).
		* @returns the disposer.
		*/
		function watchDefaultTab(service) {
			const evaluate = () => {
				if (readSettingValue(service, "openAsDefault") !== true) return;
				applyDefaultTab(service);
			};
			evaluate();
			return service.subscribeState(evaluate);
		}
		//#endregion
		//#region src/client/producedFiles.ts
		/**
		* Pure derivation of one turn's produced files from finalized conversation
		* nodes — a structural REPLICA of dsh-better-sidebar's produced-files.ts
		* (itself a replica of ui-deliverables' `producedForClosing`: the mutation
		* tools' follow-along `locations`, by render intent — a diff card or a
		* generic edit card; reads/deletes/failures produce nothing). Replicated
		* here (not imported from the peer) so this plugin's turn-tail takeover
		* stays self-contained in the client bundle and unit-testable without the
		* peer installed; keep in sync when the upstream drifts.
		*
		* Used by the turn-tail interception (turnTail.tsx) to claim the
		* produced-files row — the "changed files" chips at the end of a turn —
		* and reroute their clicks into the VSCode tab.
		*
		* @module dsh-sidebar-vscode/client/producedFiles
		*/
		/** Paths a tool-result view reports as produced, by render intent. */
		function producedPaths(view) {
			if (view === null || typeof view !== "object") return [];
			const record = view;
			if (!(record.card === "diff" || record.card === "generic" && record.kind === "edit")) return [];
			if (!Array.isArray(record.locations)) return [];
			const paths = [];
			for (const location of record.locations) if (location !== null && typeof location === "object" && typeof location.path === "string") paths.push(location.path);
			return paths;
		}
		/**
		* Files produced by the turn the assistant at `seq` closes. Accumulation
		* resets on turn boundaries (a user message, or a node reporting a different
		* turn number); paths keep first-seen order and appear once.
		* @param nodes - snapshot nodes in surface order (structural, unknown-safe).
		* @param seq - the closing assistant's seq (the render site's anchor).
		* @returns produced paths; empty when the turn wrote nothing.
		*/
		function producedForClosing(nodes, seq) {
			let pending = [];
			let seen = /* @__PURE__ */ new Set();
			let turn;
			for (const node of nodes) {
				if (node === null || typeof node !== "object") continue;
				const record = node;
				if (record.kind === "tool-result") {
					if (record.isError === true) continue;
					for (const path of producedPaths(record.callView)) {
						if (seen.has(path)) continue;
						seen.add(path);
						pending.push(path);
					}
					continue;
				}
				if (record.kind === "user") {
					turn = void 0;
					pending = [];
					seen = /* @__PURE__ */ new Set();
				} else if (typeof record.turn === "number") {
					if (turn !== void 0 && record.turn !== turn) {
						pending = [];
						seen = /* @__PURE__ */ new Set();
					}
					turn = record.turn;
				}
				if (record.kind === "assistant" && record.seq === seq) return pending;
			}
			return [];
		}
		/**
		* Claim the turn-tail chain only when the closing turn produced files —
		* the slot `select` body of the takeover (see turnTail.tsx).
		* @param owner - the turn-tail owner currency ({nodes, seq}).
		* @returns produced paths as the matched value, or null to decline.
		*/
		function selectProducedFiles(owner) {
			const record = owner;
			if (record === null || typeof record !== "object") return null;
			if (!Array.isArray(record.nodes) || typeof record.seq !== "number") return null;
			const paths = producedForClosing(record.nodes, record.seq);
			return paths.length === 0 ? null : paths;
		}
		/**
		* The slot gate as a pure function (unit-tested): claims the turn-tail chain
		* only while the takeover is enabled AND the closing turn produced files.
		* Declining returns null so the chain falls through (dsh-better-sidebar's
		* -1 entry, then the default deliverables row).
		*/
		function makeTurnTailSelect(takeoverEnabled) {
			return (owner) => {
				if (!takeoverEnabled()) return null;
				return selectProducedFiles(owner);
			};
		}
		//#endregion
		//#region src/client/turnTail.tsx
		/** Idempotency id of the injected turn-tail <style> element. */
		const TURN_TAIL_STYLE_ID = "dsh-sidebar-vscode-turn-tail-css";
		/**
		* The chips row's stylesheet — a visual twin of better-sidebar's produced
		* row (its sidebar.module.css `.producedRow` family), namespaced under this
		* plugin's prefix and driven by the same host `--dsw-alias-*` tokens.
		*/
		const TURN_TAIL_CSS = `
.dsh_vscodeTurnTail_row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.dsh_vscodeTurnTail_label {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
.dsh_vscodeTurnTail_chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  overflow: hidden;
}
.dsh_vscodeTurnTail_chip:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh_vscodeTurnTail_chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh_vscodeTurnTail_more {
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
}
`;
		/** Idempotently install the row stylesheet into `document.head`. */
		function adoptTurnTailStyles() {
			const existing = document.getElementById(TURN_TAIL_STYLE_ID);
			if (existing !== null) {
				const node = existing;
				return () => {
					node.remove();
				};
			}
			const style = document.createElement("style");
			style.id = TURN_TAIL_STYLE_ID;
			style.dataset.plugin = "dsh-sidebar-vscode";
			style.dataset.pluginCss = TURN_TAIL_STYLE_ID;
			style.textContent = TURN_TAIL_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/** The chip's small code glyph (an inline twin of the primitives' outline icon). */
		function CodeGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "12",
				height: "12",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});
		}
		/** The file name of a path (both separators). */
		function baseNameOf(path) {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		}
		/** The intercepted produced-files row (visual twin of the deliverables chips). */
		function TurnTailProducedFiles(props) {
			const { matched, openInVscode } = props;
			const shown = matched.slice(0, 6);
			const hidden = matched.length - shown.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeTurnTail_row",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh_vscodeTurnTail_label",
						children: t("produced")
					}),
					shown.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsh_vscodeTurnTail_chip",
						title: t("producedOpen"),
						onClick: () => {
							openInVscode(path);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeGlyph, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: baseNameOf(path) })]
					}, path)),
					hidden > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dsh_vscodeTurnTail_more",
						children: ["+", hidden]
					})
				]
			});
		}
		/**
		* Register the turn-tail takeover (returns the disposer).
		*
		* @param slots - the client slots service.
		* @param takeoverEnabled - the gate (the openAsDefault switch AND the VSCode
		* tab type enabled — evaluated per render/claim, so flipping the switch
		* applies to the next row render).
		* @param openInVscode - the chip click handler (reroutes into the VSCode tab).
		*/
		function registerTurnTailVscode(slots, takeoverEnabled, openInVscode) {
			return slots.inject("conversation.chat.turnTail", () => slots.register({
				name: "conversation.chat.turnTail",
				priority: -2,
				registrant: "dsh-sidebar-vscode",
				select: makeTurnTailSelect(takeoverEnabled),
				inject: (sessionId) => ({ openInVscode: (path) => {
					openInVscode(sessionId, path);
				} })
			}, TurnTailProducedFiles));
		}
		//#endregion
		//#region src/client/settingsTakeover.ts
		/**
		* Wrap `connection.api.settings.openDocument` with the settings-button
		* takeover.
		*
		* Chain-safety: the disposer restores the RAW original reference (the same
		* contract as wrapWorkspacesOpenPath), so this wrapper composes with any
		* other patch of the same member in any install/dispose order, and HMR
		* re-apply cannot strand a stale closure.
		*
		* @param api - the client connection's settings API member (mutated in place).
		* @param deps - per-call takeover decisions (the same gate as the chat seams').
		* @returns the disposer restoring the original method.
		*/
		function wrapSettingsOpenDocument(api, deps) {
			const settings = api.settings;
			const original = settings.openDocument;
			settings.openDocument = (payload, signal) => {
				if (!deps.takeoverEnabled()) return original.call(settings, payload, signal);
				return (async () => {
					const path = await deps.resolvePath();
					if (path === null || path === "") return original.call(settings, payload, signal);
					deps.reroute(path);
					deps.closeDialog?.();
					return {
						rpcId: "",
						result: {
							ok: true,
							value: { opened: true }
						}
					};
				})();
			};
			return () => {
				settings.openDocument = original;
			};
		}
		/**
		* Close the host settings dialog after a taken-over open.
		*
		* The settings shell keeps its open state component-local — no service or
		* store exposes a close — but its modal panel mounts a document-level
		* Escape listener whose lifetime is exactly the panel's (see
		* SettingsRoot.tsx's SettingsPanel). A synthetic Escape keydown is therefore
		* the one externally reachable close path, and it rides the dialog's own
		* semantics: the listener exists only while the dialog is open, so this can
		* never close anything else, and an already-closed dialog makes it a no-op.
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
		//#region src/client/settingsRows.tsx
		/**
		* This tab's settings panel (`settings.render` of the tab descriptor),
		* owning every row end-to-end instead of the better-sidebar declarative
		* `pluginToggles` rows:
		*
		* - the serverUrl / pathMap TEXT rows: the declarative row always lays
		*   its control out to the RIGHT of the title/description (a fixed
		*   left-right split with a 200px input), which cramps these two long
		*   free-form values; here each renders stacked — title/description on
		*   top, the input alone on its own full-width line below;
		* - the maxLines / maxBytes NUMBER rows, which the declarative row
		*   cannot express anyway:
		*   - pre-filled defaults: an unset field shows the effective code
		*     default (200 lines / 20000 bytes) as its value, and merely
		*     focusing and blurring it writes nothing (the declarative row
		*     committed '' → 0 → clamped to the MINIMUM, silently storing
		*     1 / 1000);
		*   - input-time range enforcement: an edit below the declared minimum
		*     or above the maximum is flagged the moment it is typed (red field
		*     plus an inline hint; the native min/max bound the spinners and
		*     arrow stepping) and snaps to the nearest bound, visibly, when it
		*     commits (blur / Enter) — what the field shows at rest is exactly
		*     what is stored, so a saved value can never resurface changed on
		*     reopen.
		*
		* The draft is local state that is null at rest (the input mirrors the
		* effective value) and the raw text only while editing, so external
		* store updates never clobber a mid-edit draft and an unchanged draft
		* never produces a write.
		*
		* @module dsh-sidebar-vscode/client/settingsRows
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
		/** The stacked text rows, in panel order (above the cap rows — the same
		* order the declarative rows used when they preceded the render panel). */
		const TEXT_SPECS = [{
			key: "serverUrl",
			title: "settingServerUrl",
			desc: "settingServerUrlDesc",
			placeholder: "settingServerUrlPlaceholder"
		}, {
			key: "pathMap",
			title: "settingPathMap",
			desc: "settingPathMapDesc",
			placeholder: "settingPathMapPlaceholder"
		}];
		/** Idempotency id of the injected settings <style> element. */
		const SETTINGS_STYLE_ID = "dsh-sidebar-vscode-settings-css";
		/**
		* The panel's stylesheet: the same row chrome and geometry as the
		* better-sidebar settings popup rows (l2 hairline, 12px radius, layer-3
		* fill) over the host's `--dsw-alias-*` design tokens, plus the
		* `[data-invalid]` range-enforcement state. Cap rows keep the popup's
		* left-right split (76px-class numeric input right); text rows stack —
		* the title/description block on top, the input alone full-width below.
		* No top margin: since the text rows moved in, this panel is the popup's
		* ONLY body (there is no declarative row list above it to separate from).
		*/
		const SETTINGS_CSS = `
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
/* The switch row's control — the same visual switch better-sidebar's
 * settings popup uses (label + visually-hidden checkbox input + track /
 * thumb spans), so the popup reads as one design language. */
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
`;
		/**
		* Idempotently install the panel stylesheet into `document.head`.
		* @returns a disposer that removes the element (safe to call twice).
		*/
		function adoptSettingsStyles() {
			const existing = document.getElementById(SETTINGS_STYLE_ID);
			if (existing !== null) {
				const node = existing;
				return () => {
					node.remove();
				};
			}
			const style = document.createElement("style");
			style.id = SETTINGS_STYLE_ID;
			style.dataset.plugin = "dsh-sidebar-vscode";
			style.dataset.pluginCss = SETTINGS_STYLE_ID;
			style.textContent = SETTINGS_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		/**
		* One switch row (the panel's boolean settings): title/description left,
		* the popup-standard switch right. Flipping ON persists the value AND (when
		* the service is available) offers the default-tab swap to the active
		* session immediately — see defaultTab.ts; flipping OFF only affects
		* future sessions and never touches any open layout.
		*/
		function SwitchRow(props) {
			const { title, desc, checked, onWrite } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_row",
				"data-vscode-switch-row": OPEN_AS_DEFAULT_KEY,
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
		* default); commits the raw text on blur/Enter exactly like the
		* declarative text row did — as-is, including '' when cleared — but only
		* when it actually changed.
		*/
		function TextRow(props) {
			const { spec, raw, onWrite } = props;
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
		* One numeric cap row: title/desc left, a bounded number input right.
		* Displays the stored value, or the code default when unset; flags
		* out-of-range drafts live; commits clamped on blur/Enter.
		*/
		function CapRow(props) {
			const { spec, raw, onWrite } = props;
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
		* The settings panel body: the default-tab switch, the stacked text rows
		* (serverUrl / pathMap), then one {@link CapRow} per declared cap spec,
		* reading and writing this descriptor's own pluginSettings blob.
		*/
		function CapSettingsPanel(props) {
			const { pluginSettings, updatePluginSetting, service } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh_vscodeSet_rows",
				"data-vscode-settings": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SwitchRow, {
						title: t("settingOpenAsDefault"),
						desc: t("settingOpenAsDefaultDesc"),
						checked: pluginSettings[OPEN_AS_DEFAULT_KEY] === true,
						onWrite: (next) => {
							updatePluginSetting(OPEN_AS_DEFAULT_KEY, next);
							if (next && service !== void 0) applyDefaultTab(service);
						}
					}),
					TEXT_SPECS.map((spec) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextRow, {
						spec,
						raw: pluginSettings[spec.key],
						onWrite: (value) => {
							updatePluginSetting(spec.key, value);
						}
					}, spec.key)),
					CAP_SPECS.map((spec) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapRow, {
						spec,
						raw: pluginSettings[spec.key],
						onWrite: (value) => {
							updatePluginSetting(spec.key, value);
						}
					}, spec.key))
				]
			});
		}
		//#endregion
		//#region src/client/index.tsx
		/** Services required before mounting: the sidebar service, the slot registry
		* (the turn-tail claim), the locale service, the session registry, the
		* conversation input service, the trigger registry (chip serialization
		* routing), the client workspaces service (the openPath seam), and the
		* connection service (the settings.openDocument seam). */
		const inject = [
			"betterSidebar",
			"slots",
			"locale",
			"sessions",
			"conversation",
			"inputTriggers",
			"workspaces",
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
		/** The tab descriptor this plugin registers. */
		function vscodeTab() {
			return {
				id: "dsh-sidebar-vscode:vscode",
				title: () => t("title"),
				icon: (size) => VscodeIcon(size),
				order: 55,
				single: true,
				settings: { render: (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapSettingsPanel, {
					pluginSettings: props.pluginSettings,
					updatePluginSetting: props.updatePluginSetting,
					service: props.service
				}) },
				component: (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VscodeView, { ...props })
			};
		}
		/**
		* Client plugin body.
		* @param ctx - the client cordis context (sidebar + slots + locale + sessions
		* + conversation + inputTriggers services).
		*/
		function apply(ctx) {
			const client = ctx;
			client.effect(() => attachLocale(client.locale), "dsh-sidebar-vscode: dictionaries");
			const lander = (sessionId, payload, options, at) => {
				return (async () => {
					const ownPoint = at === void 0 && composerDisplayedFor(client.sessions, sessionId);
					const point = at !== void 0 ? at : ownPoint ? readActiveComposerSelection() : void 0;
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
					if (ownPoint && outcome.caret !== void 0 && composerDisplayedFor(client.sessions, sessionId)) restoreActiveComposerCaret(outcome.caret);
					return outcome;
				})();
			};
			const pasteMentions = (sessionId, parts, selection) => {
				return pasteRecoveredMentions(client.sessions, client.conversation, sessionId, parts, selection);
			};
			client.effect(() => {
				setReferenceLander(lander);
				return () => {
					setReferenceLander(void 0);
				};
			}, "dsh-sidebar-vscode: reference lander handle");
			client.effect(() => {
				const disposeStyles = adoptRailStyles();
				const disposeSettingsStyles = adoptSettingsStyles();
				const stop = client.slots.inject("conversation.input.dock", () => client.slots.register({
					name: "conversation.input.dock",
					id: "dsh-sidebar-vscode-composer",
					order: 30,
					inject: () => ({
						lander,
						pasteMentions
					})
				}, ComposerDock));
				return () => {
					stop();
					disposeSettingsStyles();
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
			const betterSidebar = client.betterSidebar;
			if (betterSidebar === void 0) return;
			const descriptor = vscodeTab();
			client.effect(() => {
				const disposeStyles = adoptTabStyles();
				const stop = betterSidebar.registerTab(descriptor);
				return () => {
					stop();
					disposeStyles();
				};
			}, "dsh-sidebar-vscode: vscode tab");
			client.effect(() => {
				const stop = watchDefaultTab(betterSidebar);
				return () => {
					stop();
				};
			}, "dsh-sidebar-vscode: default tab watcher");
			client.effect(() => {
				const features = betterSidebar.features;
				if (features !== void 0 && (!features.includes("tabMeta") || !features.includes("updateTab"))) {
					console.info("[dsh-sidebar-vscode] better-sidebar lacks tabMeta/updateTab; chat-open takeover stays off");
					return () => {};
				}
				const takeoverEnabled = () => readSettingValue(betterSidebar, "openAsDefault") === true && betterSidebar.isTabEnabled("dsh-sidebar-vscode:vscode");
				const currentCwd = () => {
					const snapshot = client.sessions?.list?.getSnapshot();
					const id = snapshot?.current;
					return id !== void 0 ? snapshot?.byId?.[id]?.cwd : void 0;
				};
				const openInVscode = (sessionId, path) => {
					const cwd = sessionId !== "" ? client.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.cwd : currentCwd();
					rerouteChatOpen(betterSidebar, TAB_ID, resolveAgainst(cwd, path));
				};
				const disposeStyles = adoptTurnTailStyles();
				const stopTurnTail = registerTurnTailVscode(client.slots, takeoverEnabled, openInVscode);
				const workspaces = client.workspaces;
				const stopOpenPath = workspaces === void 0 ? void 0 : wrapWorkspacesOpenPath(workspaces, {
					takeoverEnabled,
					reroute: (path) => {
						openInVscode("", path);
					}
				});
				const connection = client.connection;
				const stopSettingsOpen = connection === void 0 ? void 0 : wrapSettingsOpenDocument(connection.api, {
					takeoverEnabled,
					resolvePath: () => fetchSettingsDocumentPath(),
					reroute: (path) => {
						rerouteChatOpen(betterSidebar, TAB_ID, path);
					},
					closeDialog: () => {
						closeSettingsDialog();
					}
				});
				return () => {
					stopSettingsOpen?.();
					stopOpenPath?.();
					stopTurnTail();
					disposeStyles();
				};
			}, "dsh-sidebar-vscode: chat + settings open takeover");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.vscodeTab = vscodeTab;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map