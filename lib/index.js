import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { request as request$1 } from "node:https";
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
//#region src/openChannel.ts
/**
* Host half of the extension command channel: the /tmp spool the embedded
* workbench's `dsh.selection-reference` extension (≥ 0.1.1) polls.
*
* Layout: `<tmpdir>/dsh-sidebar-vscode/<slug(workspace folder)>/{cap,cmd}.json`
* — one directory per workspace folder, addressed by a filesystem-safe slug
* BOTH sides derive from the folder path they independently know (the client
* sends the mapped folder; the extension derives it from its own
* `workspaceFolders[0]`). `/tmp` is shared by the default same-container
* topology (serve-web runs beside dsh-runtime — see the plugin README's
* deployment section); a split deployment simply fails the capability probe
* and the client falls back to the URL-payload channel.
*
* - `cap.json` — the extension's liveness marker, refreshed on its poll
*   tick; the route only reports it fresh within a window, so a dead
*   extension stops being "capable" within seconds.
* - `cmd.json` — the last open command (atomic tmp+rename write; the
*   extension consumes it by monotonic nonce, so a lost read never replays
*   and a stale file never re-opens).
*
* The slug spec is pinned by `tests/openChannel.spec.ts`; the extension's
* plain-JS mirror (extension/extension.js `slugOf`) must stay in lockstep.
*
* @module dsh-sidebar-vscode/openChannel
*/
/** The spool root (same base the extension derives from `os.tmpdir()`). */
const OPEN_CHANNEL_BASE = join(tmpdir(), "dsh-sidebar-vscode");
/** How old the capability marker may be before "present" turns false. */
const CAPABILITY_MAX_AGE_MS = 12e4;
/**
* Filesystem-safe slug of one workspace folder: non [A-Za-z0-9_-] characters
* collapse to '_', capped at 64, plus a djb2-xor hex digest of the ORIGINAL
* string so distinct folders sharing a collapsed form cannot collide.
* Mirrored in extension/extension.js — keep both in lockstep (spec test).
*/
function slugOf(folder) {
	const clean = folder.trim();
	const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	let digest = 5381;
	for (let at = 0; at < clean.length; at += 1) digest = (digest * 33 ^ clean.charCodeAt(at)) >>> 0;
	return `${safe}-${digest.toString(16)}`;
}
/** Whether a path is absolute POSIX (the container is Linux — serve-web runs there). */
function isAbsolutePosix(path) {
	return path.startsWith("/");
}
/**
* Structurally validate one `open.request` payload. Returns null for
* anything malformed — foreign shapes must never reach the filesystem.
*/
function parseOpenCommand(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload;
	if (typeof record.folder !== "string" || !isAbsolutePosix(record.folder)) return null;
	if (typeof record.path !== "string" || !isAbsolutePosix(record.path)) return null;
	if (typeof record.nonce !== "number" || !Number.isFinite(record.nonce)) return null;
	const out = {
		folder: record.folder,
		path: record.path,
		nonce: record.nonce
	};
	if (typeof record.line === "number" && Number.isFinite(record.line) && record.line > 0) out.line = Math.floor(record.line);
	if (typeof record.column === "number" && Number.isFinite(record.column) && record.column > 0) out.column = Math.floor(record.column);
	return out;
}
/**
* Write one open command into the folder's spool (atomic tmp+rename, so the
* extension never observes a partial JSON document).
*/
async function writeOpenCommand(base, command, now = Date.now) {
	const dir = join(base, slugOf(command.folder));
	await mkdir(dir, { recursive: true });
	const file = join(dir, "cmd.json");
	const tmp = `${file}.tmp-${process.pid}-${now()}`;
	const document = JSON.stringify({
		...command,
		ts: now()
	});
	await writeFile(tmp, document, "utf8");
	await rename(tmp, file);
}
/**
* Whether the extension serving `folder` is alive: its capability marker
* must exist and be younger than {@link CAPABILITY_MAX_AGE_MS}. Any
* filesystem error simply answers false (degrade, never throw).
*/
async function readCapability(base, folder, maxAgeMs = CAPABILITY_MAX_AGE_MS, now = Date.now) {
	try {
		const info = await stat(join(base, slugOf(folder), "cap.json"));
		return now() - info.mtimeMs < maxAgeMs;
	} catch {
		return false;
	}
}
//#endregion
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one plugin route request may proceed.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/vscodeProxy.ts
/**
* The same-origin VS Code reverse proxy: mounts a `code serve-web`
* instance under the DSH web port itself (`/sidebar/vscode`), so the
* embedded workbench iframe is same-origin with the DSH shell without any
* external gateway — keeping the clipboard signal bridge intact on
* gateway-less deployments (Windows, LAN).
*
* Upstream selection, in priority order:
*
* 1. **The `serverUrl` setting carrying a full URL** (pushed by the
*    browser half through the fenced `/sidebar-vscode/api/proxy.config`
*    route — `configure()`): exactly what `code serve-web` printed,
*    origin + base path + query (the `?tkn=` token) included. The query
*    is appended to every proxied HTTP request (serve-web checks the
*    token on requests only — its `handleUpgrade` ignores it).
* 2. `DSH_SIDEBAR_VSCODE_UPSTREAM` (`off`-like sentinels disable; a full
*    URL, default `http://127.0.0.1:8000` — a bare local serve-web).
*
* Path mapping: the workbench bakes `serverBasePath` (from serve-web's own
* `--server-base-path`) into every absolute URL it renders, and connects
* its WebSocket at `<serverBasePath>/<quality>-<commit>`. The probe reads
* that baked base from the index HTML and RECONCILES the routing to it —
* the URL names the entry point, the HTML names the routing (a `/vscode`
* server answers `/` with the same `/vscode`-rooted page). For the
* resulting base path `P` the proxy registers:
*
* - the mount `/sidebar/vscode` rewriting `/sidebar/vscode<rest>` →
*   `P<rest>` (the page URL, bookmarks, the iframe target);
* - an identity mirror at `P` itself when `P` is neither `/` (the SPA
*   owns the root) nor the mount;
* - a discovered shim at `/<quality>-<commit>` when `P` is `/` (the
*   root-absolute resource URLs);
* - one exact upgrade route at `P/<quality>-<commit>` — the only path
*   the browser socket factory ever connects to.
*
* The browser's `Host` header is kept verbatim, so serve-web bakes
* `remoteAuthority` pointing at the DSH port and every workbench URL
* (resources, callbacks, WebSocket) flows back through this proxy. The
* index probe follows up to three redirects and adopts the final origin,
* so an upstream behind a redirecting reverse proxy (e.g. an enforced
* http→https hop) still discovers — and forwards — correctly.
*
* The `<quality>-<commit>` prefix is re-discovered (throttled) whenever
* the workbench HTML itself is served — awaited on the first page load,
* so a serve-web update swaps the routes before subresources fire.
* Registration is probe-gated for the env source (a silent default claims
* nothing) but immediate for the settings source (the user asked for this
* upstream — an unreachable one answers honest 502s). `status()` reports
* both shapes: `mounted` (routes claimed) and `serving` (probe succeeded
* and every planned route is live — the only state the iframe may target
* the mount in). A route owned by another plugin disables the feature
* with a warning.
*
* @module dsh-sidebar-vscode/vscodeProxy
*/
/** Environment key overriding the proxy upstream (full URL, path/query ok). */
const UPSTREAM_ENV = "DSH_SIDEBAR_VSCODE_UPSTREAM";
/** The subpath this proxy owns on the webserver (the browser-facing mount). */
const PROXY_MOUNT = "/sidebar/vscode";
/** Probe cadence while the upstream has not answered yet. */
const PROBE_INTERVAL_MS = 1e4;
/** Probe / reachability budget. */
const PROBE_TIMEOUT_MS = 3e3;
/** Bounded wait the page-GET handler grants a pending discovery. */
const DISCOVERY_WAIT_MS = 2e3;
/** Minimum spacing between HTML-triggered commit refreshes. */
const REFRESH_THROTTLE_MS = 3e4;
/** Cap on the fetched index HTML (real pages are a few hundred KB). */
const INDEX_CAP_BYTES = 1 << 20;
/** Redirect hops the index probe follows (a redirecting reverse proxy). */
const MAX_REDIRECTS = 3;
/**
* Time-to-headers budget for forwarded requests and upgrades: a hung
* upstream answers 502 (or drops the socket) instead of pinning it.
* Post-header streams are unlimited — the browser abort tears those down.
*/
const UPSTREAM_TIMEOUT_MS = 3e4;
/** How many consecutive upgrade prefixes stay registered. */
const MAX_UPGRADE_ROUTES = 3;
/** The off-like sentinels that disable the proxy entirely. */
function isDisabledValue(raw) {
	const lowered = (raw ?? "").trim().toLowerCase();
	return lowered === "off" || lowered === "0" || lowered === "false" || lowered === "disabled" || lowered === "no";
}
/**
* Parse one upstream URL — the full address `code serve-web` prints, base
* path and `?tkn=` token included. `http`/`https` with a host only; garbage,
* other schemes, and credential-bearing URLs return null (the caller decides
* what that means). Credentials are rejected rather than silently dropped:
* they could never ride along transparently, and serve-web does not use them.
*/
function parseUpstreamUrl(raw) {
	const value = (raw ?? "").trim();
	if (value === "") return null;
	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:" || url.hostname === "") return null;
	if (url.username !== "" || url.password !== "") return null;
	const port = url.port === "" ? "" : `:${url.port}`;
	const basePath = url.pathname.replace(/\/+$/, "");
	const extraQuery = [...url.searchParams.entries()];
	return {
		origin: `${url.protocol}//${url.hostname}${port}`,
		basePath,
		extraQuery
	};
}
/** Join a base path ('' = root) with a path that keeps its leading '/'. */
function joinUrl(base, rest) {
	return base === "" ? rest : `${base}${rest}`;
}
/**
* The static (discovery-independent) mounts for one upstream: the
* `/sidebar/vscode` rewrite mount, plus an identity mirror at the
* upstream's own base path when that base is neither root (unmountable —
* the SPA owns `/`) nor the mount itself.
*/
function staticMounts(config) {
	const mounts = [{
		prefix: PROXY_MOUNT,
		upstreamBase: config.basePath
	}];
	if (config.basePath !== "" && config.basePath !== "/sidebar/vscode") mounts.push({
		prefix: config.basePath,
		upstreamBase: config.basePath
	});
	return mounts;
}
/**
* The exact browser path the workbench's WebSocket connects to for one
* discovered `<quality>-<commit>`: the client joins the upstream's own
* serverBasePath with the resource prefix — root upstreams connect at
* `/<quality>-<commit>`, `/vscode` upstreams at `/vscode/<quality>-<commit>`.
*/
function upgradePathFor(config, qualityCommit) {
	return joinUrl(config.basePath, `/${qualityCommit}`);
}
/**
* Map one browser request URL through the mounts: longest matching prefix
* wins, the remainder is appended to the mount's upstream base, and the
* upstream query pairs (the token) are appended unless already present.
* Returns the upstream request target (path[?query]), or null when no
* mount matches.
*/
function mapRequestUrl(rawUrl, mounts, extraQuery) {
	const queryAt = rawUrl.indexOf("?");
	const path = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
	const search = queryAt === -1 ? "" : rawUrl.slice(queryAt + 1);
	let best = null;
	for (const mount of mounts) {
		if (path !== mount.prefix && !path.startsWith(`${mount.prefix}/`)) continue;
		if (best === null || mount.prefix.length > best.prefix.length) best = mount;
	}
	if (best === null) return null;
	const upstreamPath = joinUrl(best.upstreamBase, path.slice(best.prefix.length) || "/");
	const params = new URLSearchParams(search);
	for (const [key, value] of extraQuery) if (!params.has(key)) params.append(key, value);
	const query = params.toString();
	return query === "" ? upstreamPath : `${upstreamPath}?${query}`;
}
/** Delete hop-by-hop headers (and any the Connection header names). */
function stripHopByHop(headers) {
	const named = (typeof headers.connection === "string" ? headers.connection : "").toLowerCase().split(",").map((token) => token.trim()).filter((token) => token !== "");
	for (const name of /* @__PURE__ */ new Set([
		...named,
		"connection",
		"keep-alive",
		"upgrade",
		"proxy-connection",
		"te",
		"trailer",
		"transfer-encoding"
	])) delete headers[name];
}
/** Pick the request factory for one upstream origin. */
function requesterFor(origin) {
	return origin.startsWith("https://") ? request$1 : request;
}
/** Forward one ordinary HTTP request to the upstream, streaming both legs. */
function proxyHttp(config, target, req, res) {
	const headers = { ...req.headers };
	stripHopByHop(headers);
	const url = new URL(config.origin);
	const upstream = requesterFor(config.origin)({
		hostname: url.hostname,
		port: url.port === "" ? void 0 : Number.parseInt(url.port, 10),
		method: req.method,
		path: target,
		headers
	});
	const timer = setTimeout(() => {
		upstream.destroy(/* @__PURE__ */ new Error("upstream headers timeout"));
	}, UPSTREAM_TIMEOUT_MS);
	upstream.on("response", (upstreamRes) => {
		clearTimeout(timer);
		const outHeaders = { ...upstreamRes.headers };
		stripHopByHop(outHeaders);
		res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
		upstreamRes.pipe(res);
	});
	upstream.on("error", () => {
		clearTimeout(timer);
		if (res.headersSent) {
			res.destroy();
			return;
		}
		res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
		res.end(`dsh-sidebar-vscode: vscode upstream ${config.origin}${config.basePath || "/"} unreachable`);
	});
	req.on("aborted", () => {
		clearTimeout(timer);
		upstream.destroy();
	});
	res.on("close", () => {
		clearTimeout(timer);
		upstream.destroy();
	});
	req.pipe(upstream);
}
/** Serialize one header map back to wire format (arrays joined). */
function renderHead(statusLine, headers) {
	const lines = [statusLine];
	for (const [name, value] of Object.entries(headers)) {
		if (value === void 0) continue;
		lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
	}
	lines.push("", "");
	return Buffer.from(`${lines.join("\r\n")}`, "ascii");
}
/**
* Forward one WebSocket upgrade to the upstream: re-issue the browser's
* handshake verbatim (same path+query+headers — upgrade paths are always
* identity-mapped, and serve-web's handleUpgrade ignores the connection
* token), relay the 101 (or the refusal), then pipe the two raw sockets
* both ways until either closes.
*/
function proxyUpgrade(config, req, socket, head) {
	const url = new URL(config.origin);
	const upstream = requesterFor(config.origin)({
		hostname: url.hostname,
		port: url.port === "" ? void 0 : Number.parseInt(url.port, 10),
		method: "GET",
		path: req.url,
		headers: { ...req.headers }
	});
	const drop = () => {
		clearTimeout(timer);
		upstream.destroy();
		socket.destroy();
	};
	const timer = setTimeout(() => {
		upstream.destroy(/* @__PURE__ */ new Error("upstream upgrade timeout"));
	}, UPSTREAM_TIMEOUT_MS);
	upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
		clearTimeout(timer);
		socket.write(renderHead("HTTP/1.1 101 Switching Protocols", upstreamRes.headers));
		if (upstreamHead.length > 0) socket.write(upstreamHead);
		if (head.length > 0) upstreamSocket.write(head);
		upstreamSocket.pipe(socket);
		socket.pipe(upstreamSocket);
		upstreamSocket.on("error", drop);
		socket.on("error", drop);
		upstreamSocket.on("close", () => {
			socket.destroy();
		});
		socket.on("close", () => {
			upstreamSocket.destroy();
		});
	});
	upstream.on("response", (upstreamRes) => {
		clearTimeout(timer);
		socket.write(renderHead(`HTTP/1.1 ${upstreamRes.statusCode ?? 502} ${upstreamRes.statusMessage ?? ""}`.trimEnd(), upstreamRes.headers));
		upstreamRes.pipe(socket);
		upstreamRes.on("end", () => {
			socket.end();
		});
		upstreamRes.on("error", drop);
	});
	upstream.on("error", drop);
	socket.on("error", drop);
	upstream.end();
}
/**
* Extract the workbench resource prefix (`<quality>-<commit>`, e.g.
* `stable-08d4889f…`) from the serve-web index HTML: the first
* `/<quality>-<40-hex>/` path segment any referenced resource carries.
*/
function discoverResourcePrefix(html) {
	const match = /\/([A-Za-z0-9][A-Za-z0-9-]*)-([0-9a-f]{40})\//.exec(html);
	return match === null ? null : `${match[1]}-${match[2]}`;
}
/**
* Extract the `serverBasePath` serve-web baked into the index HTML (the
* workbench's own absolute URLs are all rooted there — ground truth for
* routing, whatever path the probe URL carried). Accepts both the plain
* JSON spelling and the `&quot;`-escaped `data-settings` attribute form;
* root servers bake `/` or nothing — normalized to ''.
*/
function discoverServerBasePath(html) {
	const baked = /serverBasePath(?:&quot;|")\s*:\s*(?:&quot;|")([^"&]+)(?:&quot;|")/.exec(html)?.[1];
	if (baked === void 0) return "";
	const path = baked.trim().replace(/\/+$/, "");
	return path === "/" ? "" : path;
}
/** Fetch one hop of the index page, capped and timed out. */
async function fetchIndexHop(origin, target, timeoutMs) {
	return await new Promise((resolve, reject) => {
		const url = new URL(origin);
		const upstream = requesterFor(origin)({
			hostname: url.hostname,
			port: url.port === "" ? void 0 : Number.parseInt(url.port, 10),
			method: "GET",
			path: target,
			headers: { accept: "text/html" }
		});
		const timer = setTimeout(() => {
			upstream.destroy(/* @__PURE__ */ new Error("probe timeout"));
		}, timeoutMs);
		const chunks = [];
		let size = 0;
		upstream.on("response", (upstreamRes) => {
			const status = upstreamRes.statusCode ?? 0;
			if (status >= 300 && status < 400) {
				const location = upstreamRes.headers.location;
				upstream.destroy();
				if (typeof location !== "string" || location === "") {
					reject(/* @__PURE__ */ new Error(`upstream answered ${status} without a location`));
					return;
				}
				resolve({
					kind: "redirect",
					url: new URL(location, `${origin}${target}`)
				});
				return;
			}
			if (status >= 400) {
				upstream.destroy(/* @__PURE__ */ new Error(`upstream answered ${status}`));
				return;
			}
			upstreamRes.on("data", (chunk) => {
				size += chunk.length;
				if (size > INDEX_CAP_BYTES) {
					upstream.destroy(/* @__PURE__ */ new Error("index too large"));
					return;
				}
				chunks.push(chunk);
			});
			upstreamRes.on("end", () => {
				clearTimeout(timer);
				resolve({
					kind: "page",
					html: Buffer.concat(chunks).toString("utf8")
				});
			});
			upstreamRes.on("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		upstream.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		upstream.end();
	});
}
/**
* Fetch one upstream's index HTML (following up to {@link MAX_REDIRECTS}
* redirects within one shared time budget) and report the final origin.
*/
async function fetchIndex(config, timeoutMs = PROBE_TIMEOUT_MS) {
	const deadline = Date.now() + timeoutMs;
	let origin = config.origin;
	let target = mapRequestUrl(`/sidebar/vscode/`, staticMounts(config), config.extraQuery) ?? "/";
	for (let hop = 0;; hop += 1) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("probe timeout");
		const outcome = await fetchIndexHop(origin, target, remaining);
		if (outcome.kind === "page") return {
			html: outcome.html,
			origin
		};
		if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
		if (outcome.url.protocol !== "http:" && outcome.url.protocol !== "https:") throw new Error(`redirect to unsupported scheme "${outcome.url.protocol}"`);
		const port = outcome.url.port === "" ? "" : `:${outcome.url.port}`;
		origin = `${outcome.url.protocol}//${outcome.url.hostname}${port}`;
		target = `${outcome.url.pathname}${outcome.url.search}`;
	}
}
/**
* Install the `/vscode` proxy machinery on the webserver. Nothing is
* claimed until an upstream is known (settings `configure()` or the
* env/default probe loop); see the module doc for the routing plan.
* @param ctx - host cordis context (structural face, see index.ts).
*/
function createVscodeProxy(ctx) {
	const envRaw = process.env[UPSTREAM_ENV];
	const envConfig = isDisabledValue(envRaw) ? null : parseUpstreamUrl(envRaw ?? "http://127.0.0.1:8000");
	if (envConfig === null && envRaw !== void 0 && !isDisabledValue(envRaw)) ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: ${UPSTREAM_ENV} is set but is not a usable http(s) URL (embedded credentials are unsupported) — proxy idle`);
	let disposed = false;
	let settingsConfig = null;
	let active = null;
	let disabledByConflict = false;
	let qualityCommit = null;
	let lastRefresh = 0;
	let inflightProbe = null;
	/** Index page the settings route already fetched for the pending config. */
	let pendingSeed = null;
	/** Bumped by every activate(): in-flight probes discard stale discovery. */
	let generation = 0;
	const mounts = /* @__PURE__ */ new Map();
	const upgradeRoutes = /* @__PURE__ */ new Map();
	/**
	* The config routing is planned from: `active` until the first probe,
	* then RECONCILED — serve-web bakes its own `serverBasePath` (from
	* `--server-base-path`) into the index HTML, and the workbench's
	* absolute URLs follow THAT, whatever path the probe URL carried (a
	* server at `/vscode` answers `/` with the same `/vscode`-rooted
	* page); a redirecting entry adopts the final origin the same way. The
	* URL names the entry point; the HTML names the routing.
	*/
	let routingBasePath = null;
	let routingOrigin = null;
	const routing = () => {
		if (active === null) return null;
		const basePath = routingBasePath === null || routingBasePath === active.basePath ? active.basePath : routingBasePath;
		const origin = routingOrigin === null || routingOrigin === active.origin ? active.origin : routingOrigin;
		return basePath === active.basePath && origin === active.origin ? active : {
			...active,
			basePath,
			origin
		};
	};
	const face = () => ctx.webServer;
	/** Registered mount prefixes → their current rewrite targets. */
	const mountTargets = /* @__PURE__ */ new Map();
	/** Every registered mount, longest-prefix order is mapRequestUrl's job. */
	const currentMounts = () => [...mounts.keys()].map((prefix) => ({
		prefix,
		upstreamBase: mountTargets.get(prefix) ?? prefix
	}));
	const handleHttp = async (req, res) => {
		const config = routing();
		if (config === null) {
			res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
			res.end("dsh-sidebar-vscode: proxy reconfiguring");
			return;
		}
		const target = mapRequestUrl(req.url ?? "/", currentMounts(), config.extraQuery);
		if (target === null) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("dsh-sidebar-vscode: no mount matches");
			return;
		}
		await maybeRefresh(req, target);
		proxyHttp(config, target, req, res);
	};
	/** On page GETs: await a pending discovery (first boot race), else a
	* throttled background re-probe picks up serve-web version changes. */
	const maybeRefresh = async (req, target) => {
		if (req.method !== "GET" && req.method !== "HEAD") return;
		if (target.split("?")[0] !== joinUrl(routing()?.basePath ?? "", "/")) return;
		const now = Date.now();
		const pending = !fullyRegistered();
		if (!pending && now - lastRefresh < REFRESH_THROTTLE_MS) return;
		lastRefresh = now;
		if (!pending) {
			probe();
			return;
		}
		await Promise.race([probe(), new Promise((resolve) => {
			setTimeout(resolve, DISCOVERY_WAIT_MS);
		})]);
	};
	const registerMount = (mount) => {
		if (mounts.has(mount.prefix)) {
			mountTargets.set(mount.prefix, mount.upstreamBase);
			return;
		}
		if (disabledByConflict) return;
		const webServer = face();
		if (webServer === void 0) {
			disabledByConflict = true;
			ctx.logger.warn("[dsh-sidebar-vscode] vscode proxy: webserver service absent — feature off");
			return;
		}
		try {
			const stop = webServer.register({
				kind: "prefix",
				path: mount.prefix,
				handler: handleHttp
			});
			mounts.set(mount.prefix, stop);
			mountTargets.set(mount.prefix, mount.upstreamBase);
			ctx.effect(() => stop, `dsh-sidebar-vscode: ${mount.prefix} proxy route`);
		} catch (error) {
			disabledByConflict = true;
			ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: route ${mount.prefix} already owned — feature off:`, error);
		}
	};
	/** Dispose one registered mount (leaves foreign keys untouched). */
	const dropMount = (prefix) => {
		const stop = mounts.get(prefix);
		if (stop === void 0) return;
		mounts.delete(prefix);
		mountTargets.delete(prefix);
		try {
			stop();
		} catch {}
	};
	/**
	* Bring the registered static mounts in line with one routing config:
	* add or re-point what it wants, drop what it no longer lists (mirror
	* removal on base-path changes) — the discovery shim is pruned too.
	*/
	const syncStaticMounts = (config) => {
		const wanted = staticMounts(config);
		for (const mount of wanted) registerMount(mount);
		for (const prefix of [...mounts.keys()]) {
			if (wanted.some((mount) => mount.prefix === prefix)) continue;
			if (qualityCommit !== null && prefix === `/${qualityCommit}`) continue;
			dropMount(prefix);
		}
	};
	const registerUpgrade = (path) => {
		if (disabledByConflict || upgradeRoutes.has(path)) return;
		const webServer = face();
		if (webServer === void 0) return;
		if (active === null) return;
		try {
			const configAtRegistration = active;
			const stop = webServer.registerUpgrade({
				path,
				handler: (req, socket, head) => {
					proxyUpgrade(routing() ?? configAtRegistration, req, socket, head);
				}
			});
			upgradeRoutes.set(path, stop);
			ctx.effect(() => stop, `dsh-sidebar-vscode: ${path} WebSocket proxy`);
			while (upgradeRoutes.size > MAX_UPGRADE_ROUTES) {
				const oldest = upgradeRoutes.keys().next().value;
				const dispose = upgradeRoutes.get(oldest);
				upgradeRoutes.delete(oldest);
				try {
					dispose?.();
				} catch {}
			}
		} catch (error) {
			ctx.logger.warn(`[dsh-sidebar-vscode] vscode proxy: upgrade route ${path} taken — WebSocket passthrough off:`, error);
		}
	};
	const fullyRegistered = () => {
		const config = routing();
		if (config === null || qualityCommit === null) return false;
		for (const mount of staticMounts(config)) if (!mounts.has(mount.prefix)) return false;
		if (!upgradeRoutes.has(upgradePathFor(config, qualityCommit))) return false;
		if (config.basePath === "" && !mounts.has(`/${qualityCommit}`)) return false;
		return true;
	};
	const stopAll = () => {
		for (const stop of mounts.values()) try {
			stop();
		} catch {}
		mounts.clear();
		mountTargets.clear();
		for (const stop of upgradeRoutes.values()) try {
			stop();
		} catch {}
		upgradeRoutes.clear();
		qualityCommit = null;
		routingBasePath = null;
		routingOrigin = null;
		lastRefresh = 0;
	};
	const activate = () => {
		stopAll();
		generation += 1;
		active = settingsConfig ?? envConfig;
		if (active === null) {
			ctx.logger.info("[dsh-sidebar-vscode] vscode proxy idle (no upstream configured)");
			return;
		}
		if (settingsConfig !== null) syncStaticMounts(active);
	};
	const probe = () => {
		if (inflightProbe !== null) return inflightProbe;
		const promise = (async () => {
			if (disposed || disabledByConflict || active === null) return false;
			const config = active;
			const observedGeneration = generation;
			try {
				let fetched;
				if (pendingSeed !== null) {
					fetched = pendingSeed;
					pendingSeed = null;
				} else {
					fetched = await fetchIndex(config);
					if (disposed || observedGeneration !== generation) return false;
				}
				const html = fetched.html;
				const discovered = discoverResourcePrefix(html);
				if (discovered === null) return false;
				qualityCommit = discovered;
				routingBasePath = discoverServerBasePath(html);
				routingOrigin = fetched.origin;
				const reconciled = routing() ?? config;
				syncStaticMounts(reconciled);
				if (reconciled.basePath === "") registerMount({
					prefix: `/${discovered}`,
					upstreamBase: `/${discovered}`
				});
				else dropMount(`/${discovered}`);
				registerUpgrade(upgradePathFor(reconciled, discovered));
				return true;
			} catch {
				return false;
			}
		})();
		inflightProbe = promise;
		promise.finally(() => {
			if (inflightProbe === promise) inflightProbe = null;
		});
		return promise;
	};
	const timer = setInterval(() => {
		if (active !== null && !fullyRegistered()) probe();
	}, PROBE_INTERVAL_MS);
	timer.unref?.();
	ctx.effect(() => () => {
		disposed = true;
		clearInterval(timer);
		stopAll();
	}, "dsh-sidebar-vscode: vscode proxy lifecycle");
	activate();
	return {
		configure(config, seed) {
			settingsConfig = config;
			pendingSeed = config === null || seed === void 0 ? null : seed;
			activate();
			if (active !== null) probe();
		},
		status() {
			const mounted = !disposed && active !== null && mounts.has("/sidebar/vscode");
			const serving = mounted && fullyRegistered();
			return {
				mounted,
				prefix: mounted ? PROXY_MOUNT : null,
				serving
			};
		},
		async probeUpstream(config) {
			if (disposed) return null;
			try {
				return await fetchIndex(config);
			} catch {
				return null;
			}
		},
		ready: probe().then((ok) => {
			if (ok && !disposed) {
				const config = routing();
				if (config !== null) ctx.logger.info(`[dsh-sidebar-vscode] proxy live: ${PROXY_MOUNT}/ → ${config.origin}${config.basePath || "/"} (upgrade ${upgradePathFor(config, qualityCommit ?? "?")})`);
			}
			return ok;
		}, () => false)
	};
}
//#endregion
//#region src/index.ts
/** Cordis plugin name (the Loader entry; matches the client bundle id). */
const name = "dsh-sidebar-vscode";
/** Services required before load: the agent registry (agent/created
* events), the webserver (command-channel routes), and the web runtime
* (the trust fence's live trustedHosts). */
const inject = [
	"agents",
	"webServer",
	"webRuntime"
];
/** One JSON answer over the response stream. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
/** Read one request body as JSON, capped (the payloads are tiny). */
async function readJsonBody(req, limit = 4096) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > limit) throw new Error("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return null;
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
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
	const proxy = createVscodeProxy(ctx);
	const host = ctx;
	ctx.effect(() => host.webServer.register({
		kind: "prefix",
		path: "/sidebar-vscode/api",
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, host.webRuntime.trustedHosts)) {
				writeJson(res, 403, {
					ok: false,
					error: {
						code: "forbidden",
						message: "forbidden"
					}
				});
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, {
					ok: false,
					error: {
						code: "method-error",
						message: "method not allowed"
					}
				});
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith("/sidebar-vscode/api/") ? pathname.slice(20) : void 0;
			if (method === void 0 || method.includes("/")) {
				writeJson(res, 404, {
					ok: false,
					error: {
						code: "not-found",
						message: "unknown method"
					}
				});
				return;
			}
			if (method === "settings.document") {
				const settings = host.get("settings");
				if (settings === void 0) {
					writeJson(res, 500, {
						ok: false,
						error: {
							code: "settings-absent",
							message: "settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition"
						}
					});
					return;
				}
				let path;
				try {
					path = await settings.prepareDocument();
				} catch (error) {
					writeJson(res, 500, {
						ok: false,
						error: {
							code: "internal",
							message: `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`
						}
					});
					return;
				}
				if (path === void 0 || path === "") {
					writeJson(res, 500, {
						ok: false,
						error: {
							code: "no-document",
							message: "settings provider has no local document to open"
						}
					});
					return;
				}
				writeJson(res, 200, {
					ok: true,
					value: { path }
				});
				return;
			}
			try {
				const payload = await readJsonBody(req);
				if (method === "proxy.status") {
					const { mounted, prefix, serving } = proxy.status();
					writeJson(res, 200, {
						ok: true,
						value: {
							mounted,
							prefix,
							serving
						}
					});
					return;
				}
				if (method === "proxy.config") {
					const record = payload;
					if (record !== null && record.reset === true) {
						proxy.configure(null);
						writeJson(res, 200, {
							ok: true,
							value: { mounted: null }
						});
						return;
					}
					if (record === null || typeof record.url !== "string" || record.url.trim() === "") {
						writeJson(res, 400, {
							ok: false,
							error: {
								code: "bad-request",
								message: "url must be a non-empty string (or {\"reset\":true})"
							}
						});
						return;
					}
					const config = parseUpstreamUrl(record.url);
					if (config === null) {
						writeJson(res, 400, {
							ok: false,
							error: {
								code: "bad-upstream",
								message: "url must be an http(s) URL without embedded credentials — the full address code serve-web prints, base path and query included"
							}
						});
						return;
					}
					const fetched = await proxy.probeUpstream(config);
					proxy.configure(config, fetched ?? void 0);
					writeJson(res, 200, {
						ok: true,
						value: {
							mounted: `${PROXY_MOUNT}/`,
							reachable: fetched !== null
						}
					});
					return;
				}
				if (method === "open.capability") {
					const record = payload;
					if (record === null || typeof record.folder !== "string" || record.folder === "") {
						writeJson(res, 400, {
							ok: false,
							error: {
								code: "bad-request",
								message: "folder must be a non-empty string"
							}
						});
						return;
					}
					writeJson(res, 200, {
						ok: true,
						value: { present: await readCapability(OPEN_CHANNEL_BASE, record.folder) }
					});
					return;
				}
				if (method === "open.request") {
					const command = parseOpenCommand(payload);
					if (command === null) {
						writeJson(res, 400, {
							ok: false,
							error: {
								code: "bad-request",
								message: "malformed open request"
							}
						});
						return;
					}
					await writeOpenCommand(OPEN_CHANNEL_BASE, command);
					writeJson(res, 200, { ok: true });
					return;
				}
				writeJson(res, 404, {
					ok: false,
					error: {
						code: "not-found",
						message: `unknown method "${method}"`
					}
				});
			} catch (error) {
				writeJson(res, 500, {
					ok: false,
					error: {
						code: "internal",
						message: error instanceof Error ? error.message : String(error)
					}
				});
			}
		}
	}), "dsh-sidebar-vscode: /sidebar-vscode/api routes");
}
//#endregion
export { apply, inject, name };
