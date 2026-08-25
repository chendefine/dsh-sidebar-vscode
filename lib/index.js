import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
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
/** Reverse {@link escapeLabel}. */
function unescapeLabel(label) {
	return label.replace(/\\(.)/gu, "$1");
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
/**
* Extract Markdown mentions and bare canonical URIs from one text value,
* replacing each with its readable label prefixed by `@` — the outgoing
* message keeps the familiar `@path L10-L12` (selections) / `@path`
* (resources) reference shape. Both schemes match: `dsh-vscode:` for
* selections and `dsh-vscode-res:` for explorer file/folder references (the
* two prefixes are mutually exclusive — a `:` must directly follow the
* scheme name, so neither alternative can over-match the other).
*
* A second, fail-soft pass then recovers *rendered-mention copies*: text
* pasted back from a rendered chip (conversation bubble, context row,
* external editor) where the Markdown sigils drift apart with whitespace —
* `@ [ label ]( dsh-vscode: payload )` — or the mention lost its wrapper
* and only the bare (possibly padded) URI survives. Every recovered
* candidate must still decode as a canonical URI; anything else is left
* untouched (recovery never throws, mirroring how such text was silently
* ignored before the shapes were recognized).
*
* Mirrors the dsh-session discipline: an explicit Markdown mention fails on
* any malformed URI; bare text counts as a reference only when a base64url
* shape follows the scheme, and still fails when that candidate is not
* canonical. The replacement exists only inside the per-turn pre-step model
* view; the persisted transcript keeps the canonical `@[…](dsh-vscode:…)`
* markdown, so the rewrite never leaks into stored history.
*
* @param text - text to normalize.
* @returns readable text plus payloads in appearance order.
* @throws VscodeMentionError on malformed explicit mentions.
*/
function parseVscodeMentions(text) {
	const references = [];
	let rendered = text.replace(/@\[((?:\\.|[^\\\]])*)\]\((dsh-vscode(?:-res)?:[^\s)]*)\)|(dsh-vscode(?:-res)?:[A-Za-z0-9_-]+)/gu, (_match, rawLabel, markdownUri, bareUri) => {
		const uri = markdownUri ?? bareUri;
		/* v8 ignore next -- the two-alternative regex always captures exactly one URI group. */
		if (uri === void 0) throw new VscodeMentionError("vscode-selection URI is missing");
		if (uri.startsWith("dsh-vscode-res:")) {
			const resource = decodeVscodeResourceUri(uri);
			const label = rawLabel === void 0 ? resourceLabel(resource) : unescapeLabel(rawLabel);
			references.push(resource);
			return `@${label}`;
		}
		const payload = decodeVscodeRefUri(uri);
		const label = rawLabel === void 0 ? referenceLabel(payload) : unescapeLabel(rawLabel);
		references.push(payload);
		return `@${label}`;
	});
	const recovered = scanRecoveredMentions(rendered);
	if (recovered.length > 0) {
		let out = "";
		let cursor = 0;
		for (const mention of recovered) {
			out += `${rendered.slice(cursor, mention.start)}@${mention.label}`;
			cursor = mention.end;
			references.push(mention.payload);
		}
		rendered = `${out}${rendered.slice(cursor)}`;
	}
	return {
		text: rendered,
		references
	};
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
/** First {@link HASH_HEX_LENGTH} hex chars of a sha-256 digest hex string. */
function hashPrefix(hexDigest) {
	return hexDigest.slice(0, 16);
}
//#endregion
//#region src/mention.ts
/**
* The Host-side vscode-selection context: recognizes canonical
* `dsh-vscode:` (editor selections) and `dsh-vscode-res:` (explorer
* file/folder references) mentions in outgoing user messages, replaces each
* with its readable label (preserving the message id), and injects one
* bounded `<text-selection>` context message — or, for resources, one
* content-less `<file-selection>`/`<folder-selection>` path marker —
* immediately after the
* first message that cited it. The selection snapshot content rides inside
* the mention, so injection never depends on filesystem state; the
* filesystem is consulted only to mark freshness (`stale`) when the on-disk
* range no longer matches the capture. Resources carry no content at all:
* the model is told the path and kind and reads the file when needed.
*
* Only `source.kind === 'user'` text is scanned, matching the
* dsh-session-reference boundary. Duplicate references within one step are
* collapsed per kind — selections by (path, range), resources by
* (path, kind) — with the newest capture (last mention) winning; distinct
* content under the same range replaces — never joins — the older snapshot.
*
* @module dsh-sidebar-vscode/mention
*/
/** The model-facing context tag name for editor text selections. */
const TAG_NAME = "text-selection";
/** The model-facing context tag name for explorer file references. */
const FILE_TAG_NAME = "file-selection";
/** The model-facing context tag name for explorer folder references. */
const FOLDER_TAG_NAME = "folder-selection";
/** One-line guidance riding above every injected tag (capture semantics). */
const GUIDANCE = "<!-- User-captured VS Code selection (capture-time snapshot); re-read the file before editing. -->";
/** Extra guidance riding above the tag when capture-time truncation removed content. */
const TRUNCATION_NOTICE = "<!-- Selection exceeded the size limit: the middle is omitted, marked by \"... (N lines omitted, L1-L2) ...\"; read the file for the full text. -->";
/** Escape one XML-like attribute value. */
function escapeAttribute(value) {
	return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/** UTF-8 byte length of a string. */
function byteLength(value) {
	return new TextEncoder().encode(value).length;
}
/** sha-256 hex digest of a string (host side; the browser side uses crypto.subtle). */
function sha256Hex(text) {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
/** The kept head and tail halves of a truncated snapshot (`tail` '' when none). */
function splitTruncated(payload) {
	const headLen = payload.headLen !== void 0 && payload.headLen <= payload.text.length ? payload.headLen : payload.text.length;
	const tail = headLen < payload.text.length ? payload.text.slice(headLen + 1) : "";
	return {
		head: payload.text.slice(0, headLen),
		tail
	};
}
/** Render the inline omission marker naming what was dropped and where. */
function omissionMarker(payload) {
	const parts = [];
	if (payload.omitLines !== void 0 && payload.omitLines > 0) {
		parts.push(`${payload.omitLines} line${payload.omitLines === 1 ? "" : "s"} omitted`);
		const { head } = splitTruncated(payload);
		const firstOmitted = payload.start + head.split("\n").length;
		parts.push(rangeLabel(firstOmitted, firstOmitted + payload.omitLines - 1));
	}
	if (payload.omitBytes !== void 0 && payload.omitBytes > 0) parts.push(`${payload.omitBytes} byte${payload.omitBytes === 1 ? "" : "s"} omitted`);
	return parts.length > 0 ? `... (${parts.join(", ")}) ...` : "... (truncated) ...";
}
/**
* Render one injected context message body: the guidance comment plus the
* `<text-selection>` tag. A truncated snapshot renders as head + omission
* marker + tail so the model sees both ends of the selection and knows
* exactly where the gap sits. When the snapshot itself contains the literal
* closing tag, both tags carry a deterministic hash salt so the body cannot
* forge the terminator (content changes ⇒ salt changes).
* @param payload - the unique winning reference.
* @param stale - filesystem freshness verdict.
* @returns the complete model-facing text.
*/
function renderSelectionTag(payload, stale) {
	const attrs = [`path="${escapeAttribute(payload.path)}"`, `line="${rangeLabel(payload.start, payload.end)}"`];
	if (payload.lang !== void 0 && payload.lang !== "") attrs.push(`lang="${escapeAttribute(payload.lang)}"`);
	if (payload.truncated === true) attrs.push("truncated=\"true\"");
	if (payload.dirty === true) attrs.push("dirty=\"true\"");
	if (stale) attrs.push("stale=\"true\"");
	const guidance = payload.truncated === true ? `${GUIDANCE}\n${TRUNCATION_NOTICE}` : GUIDANCE;
	const { head, tail } = splitTruncated(payload);
	const body = payload.truncated === true ? [
		head,
		omissionMarker(payload),
		tail
	].filter((part) => part !== "").join("\n") : payload.text;
	let open = `<${TAG_NAME}`;
	let close = `</${TAG_NAME}>`;
	if (body.includes(close)) {
		const salt = payload.hash.slice(0, 8);
		if (/^[0-9a-f]{8}$/.test(salt)) {
			open = `<${TAG_NAME}-${salt}`;
			close = `</${TAG_NAME}-${salt}>`;
		} else {
			const escaped = body.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
			return `${guidance}\n${open} ${attrs.join(" ")}>\n${escaped}\n${close}`;
		}
	}
	return `${guidance}\n${open} ${attrs.join(" ")}>\n${body}\n${close}`;
}
/**
* Render one injected explorer-resource context body: a single self-closing
* `<file-selection path="…"/>` or `<folder-selection path="…"/>` marker and
* nothing else. By design there is no guidance comment and no content — the
* reference only names a path, with the tag itself carrying the file/folder
* kind; the model reads the file (or lists the folder) when it actually
* needs the bytes.
* @param payload - the unique winning resource reference.
* @returns the complete model-facing text.
*/
function renderResourceTag(payload) {
	return `<${payload.type === "folder" ? FOLDER_TAG_NAME : FILE_TAG_NAME} path="${escapeAttribute(payload.path)}"/>`;
}
/** Group key for within-step deduplication: kind-aware — same shape of reference ⇒ one context. */
function groupKey(payload) {
	return isVscodeResourcePayload(payload) ? `res\u0000${payload.path}\u0000${payload.type}` : `${payload.path}\u0000${payload.start}\u0000${payload.end}`;
}
/** Verify one unique reference against the live filesystem range. */
async function freshnessOf(cwd, readFileRange, payload, signal) {
	if (cwd === void 0 || !isAbsolute(cwd)) return "unknown";
	const text = await readFileRange(cwd, payload.path, payload.start, payload.end, signal);
	if (text === null) return "unknown";
	const disk = normalizeForHash(text);
	if (payload.truncated === true) {
		const { head, tail } = splitTruncated(payload);
		const headOk = disk === head || disk.startsWith(head);
		const tailOk = tail === "" || disk === tail || disk.endsWith(tail);
		return headOk && tailOk && disk.length >= head.length + tail.length + 1 ? "fresh" : "stale";
	}
	if (payload.hash === "") return "unknown";
	return hashPrefix(sha256Hex(disk)) === payload.hash ? "fresh" : "stale";
}
/**
* Build one unique selection reference's context message: freshness-check
* against the live filesystem, then render the bounded `<text-selection>`
* tag with its durable source record.
*/
async function selectionContext(payload, cwd, readFileRange, signal) {
	const stale = await freshnessOf(cwd, readFileRange, payload, signal) === "stale";
	return createUserMessage({
		content: [{
			type: "text",
			text: renderSelectionTag(payload, stale)
		}],
		source: {
			kind: "vscode-mention",
			form: "notice",
			version: 1,
			path: payload.path,
			startLine: payload.start,
			endLine: payload.end,
			...payload.lang !== void 0 && payload.lang !== "" ? { language: payload.lang } : {},
			contentHash: payload.hash,
			bytes: byteLength(payload.text),
			truncated: payload.truncated === true,
			dirty: payload.dirty === true,
			stale
		}
	});
}
/**
* Rewrite canonical mentions (either kind) in direct user messages and place
* each unique reference's context immediately after the first message that
* cited it.
* @param messages - messages accepted by downstream pre-step listeners.
* @param cwd - the session's workspace directory.
* @param readFileRange - injected range reader for freshness checks
* (selections only; resources verify nothing).
* @param signal - active turn cancellation.
* @returns the expanded message list (the input instance when nothing matched).
*/
async function expandVscodeMentions(messages, cwd, readFileRange, signal) {
	const rewritten = /* @__PURE__ */ new Map();
	const cited = [];
	for (const [index, message] of messages.entries()) {
		if (message.source.kind !== "user") continue;
		let parsedAny = false;
		const references = [];
		const content = message.content.map((block) => {
			if (block.type !== "text") return block;
			const parsed = parseVscodeMentions(block.text);
			if (parsed.references.length === 0) return block;
			parsedAny = true;
			references.push(...parsed.references);
			return {
				type: "text",
				text: parsed.text
			};
		});
		if (!parsedAny) continue;
		rewritten.set(index, freezeMessage({
			...message,
			content
		}));
		for (const payload of references) cited.push({
			payload,
			index
		});
	}
	if (cited.length === 0) return messages;
	const uniques = /* @__PURE__ */ new Map();
	for (const { payload, index } of cited) {
		const key = groupKey(payload);
		const existing = uniques.get(key);
		if (existing === void 0) uniques.set(key, {
			payload,
			firstIndex: index
		});
		else uniques.set(key, {
			payload,
			firstIndex: existing.firstIndex
		});
	}
	const injections = /* @__PURE__ */ new Map();
	for (const { payload, firstIndex } of uniques.values()) {
		signal.throwIfAborted();
		const context = isVscodeResourcePayload(payload) ? createUserMessage({
			content: [{
				type: "text",
				text: renderResourceTag(payload)
			}],
			source: {
				kind: "vscode-resource",
				form: "notice",
				version: 1,
				path: payload.path,
				type: payload.type
			}
		}) : await selectionContext(payload, cwd, readFileRange, signal);
		const bucket = injections.get(firstIndex);
		if (bucket === void 0) injections.set(firstIndex, [context]);
		else bucket.push(context);
	}
	return messages.flatMap((message, index) => {
		const direct = rewritten.get(index) ?? message;
		const extra = injections.get(index);
		return extra === void 0 ? [direct] : [direct, ...extra];
	});
}
/**
* The `agent/pre-step` listener body: expand mentions in the accepted step
* messages. Extracted so the boundary logic is unit-testable without an
* assembled agent scope.
* @param cwd - the session's workspace directory.
* @param readFileRange - injected range reader for freshness checks.
* @param messages - the claimed messages (the user's own words).
* @param signal - caller lifetime.
* @param next - the downstream waterfall.
* @returns the decision with rewrites and injections, or the downstream decision.
*/
async function vscodeMentionPreStep(cwd, readFileRange, messages, signal, next) {
	const decision = await next();
	if (decision.kind === "reject") return decision;
	const expanded = await expandVscodeMentions(decision.messages, cwd, readFileRange, signal);
	if (expanded === decision.messages) return decision;
	return {
		kind: "enter",
		messages: expanded
	};
}
/** Default freshness file-size cap: ranges inside larger files stay 'unknown'. */
const FRESHNESS_MAX_FILE_BYTES = 8388608;
/**
* Production {@link RangeReader}: resolves the path under the session cwd
* (rejecting absolute tokens and `..` escapes so the freshness check can
* never read outside the workspace), bounds the read size, and returns the
* exact LF-joined range.
* @returns the range text, or null when it cannot be verified.
*/
function createFileRangeReader(maxFileBytes = FRESHNESS_MAX_FILE_BYTES) {
	return async (cwd, path, start, end, signal) => {
		if (!isAbsolute(cwd)) return null;
		const absolute = resolve(isAbsolute(path) ? path : resolve(cwd, path));
		const confined = relative(cwd, absolute);
		if (confined === ".." || confined.startsWith(`..${sep}`) || isAbsolute(confined)) return null;
		signal.throwIfAborted();
		try {
			const info = await stat(absolute);
			if (!info.isFile() || info.size > maxFileBytes) return null;
			signal.throwIfAborted();
			const lines = (await readFile(absolute, "utf8")).replace(/\r\n?/g, "\n").split("\n");
			if (end > lines.length) return null;
			return lines.slice(start - 1, end).join("\n");
		} catch {
			return null;
		}
	};
}
//#endregion
//#region src/index.ts
/** Cordis plugin name (the Loader entry; matches the client bundle id). */
const name = "dsh-sidebar-vscode";
/** Services required before load: the agent registry (agent/created events). */
const inject = ["agents"];
/**
* Mount the vscode-selection pre-step boundary for every agent.
* @param ctx - host cordis context.
*/
function apply(ctx) {
	const readFileRange = createFileRangeReader();
	/* v8 ignore start -- agent-scoped registration glue; the boundary behavior is vscodeMentionPreStep (unit-tested) and the event plumbing is harness-owned. */
	ctx.on("agent/created", ({ agent }) => {
		agent.ctx.effect(() => {
			const stop = agent.ctx.on("agent/pre-step", async ({ messages, signal }, next) => {
				return vscodeMentionPreStep(agent.session.header.cwd, readFileRange, messages, signal, next);
			});
			return () => {
				stop();
			};
		}, "dsh-sidebar-vscode: vscode-mention contexts");
	});
	/* v8 ignore stop */
}
//#endregion
export { apply, inject, name };
