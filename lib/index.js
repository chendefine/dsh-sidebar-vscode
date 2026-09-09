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
* @returns readable text plus payloads (strict matches first, then recovered copies).
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
	if (headLen === 0) return {
		head: "",
		tail: payload.text
	};
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
	const open = `<${TAG_NAME}`;
	const close = `</${TAG_NAME}>`;
	if (body.includes(close)) {
		const salt = payload.hash.slice(0, 8);
		const saltedOpen = `<${TAG_NAME}-${salt}`;
		const saltedClose = `</${TAG_NAME}-${salt}>`;
		if (/^[0-9a-f]{8}$/.test(salt) && !body.includes(saltedClose) && !body.includes(saltedOpen)) return `${guidance}\n${saltedOpen} ${attrs.join(" ")}>\n${body}\n${saltedClose}`;
		const escaped = body.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
		return `${guidance}\n${open} ${attrs.join(" ")}>\n${escaped}\n${close}`;
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
* Production {@link RangeReader}: resolves the path under the session cwd —
* confining every resolution (absolute or relative: an absolute path is a
* legitimate wire form, honored exactly when it lands inside the workspace)
* and rejecting `..` escapes, so the freshness check can never read outside
* the workspace — then bounds the read size and returns the exact
* LF-joined range.
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
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
//#endregion
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
* - `openAsDefault` gates the two file-open takeovers (chat-originated
*   opens through `ctx.sidebarRight.openResource`, and the settings
*   page's「打开配置文件」button). The better-sidebar-era meaning —
*   swapping a fresh session's seeded Files tab — is gone with that
*   system (the official sidebar seeds the guide page and keeps layout
*   in memory only); the switch keeps its takeover roles.
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
//#region src/settingsSection.ts
/**
* The section's schema. Defaults mirror {@link VSCODE_SIDEBAR_SETTINGS_BASE}
* exactly (the composition base wins for unset fields anyway; the schema
* defaults are the same values so a section resolved from defaults alone
* equals the base). Numeric caps carry their declared bounds here, so a
* hand-edited document section outside them is refused at write time by
* the settings provider itself.
*/
function vscodeSidebarSettingsSchema() {
	return Schema.object({
		openAsDefault: Schema.boolean().default(VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault),
		openBlocklist: Schema.array(Schema.string().max(16)).max(64).default([...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist]),
		serverUrl: Schema.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.serverUrl),
		pathMap: Schema.string().default(VSCODE_SIDEBAR_SETTINGS_BASE.pathMap),
		maxLines: Schema.number().step(1).min(1).max(MAX_LINES_MAX).default(200),
		maxBytes: Schema.number().step(1).min(MAX_BYTES_MIN).max(MAX_BYTES_MAX).default(MAX_BYTES_DEFAULT)
	});
}
/**
* Register the `vscode-sidebar` section on the settings provider, for the
* caller's lifetime (the provider unregisters with the plugin's fiber).
*
* The host half reads nothing from the section itself — every consumer is
* browser-side — so `setSource` parks on a no-op and `onChange` is one
* too; the section is `live` (the browser reads per call / per render).
*
* @param ctx - the plugin's host context (the section's owner).
* @param settings - the settings service the provider mounted (structural;
* a foreign shape installs nothing).
*/
function installVscodeSidebarSettings(ctx, settings) {
	const service = settings;
	if (service === null || typeof service.installSection !== "function") return;
	service.installSection(ctx, VSCODE_SIDEBAR_SETTINGS_NAMESPACE, vscodeSidebarSettingsSchema(), {
		openAsDefault: VSCODE_SIDEBAR_SETTINGS_BASE.openAsDefault,
		openBlocklist: [...VSCODE_SIDEBAR_SETTINGS_BASE.openBlocklist],
		serverUrl: VSCODE_SIDEBAR_SETTINGS_BASE.serverUrl,
		pathMap: VSCODE_SIDEBAR_SETTINGS_BASE.pathMap,
		maxLines: VSCODE_SIDEBAR_SETTINGS_BASE.maxLines,
		maxBytes: VSCODE_SIDEBAR_SETTINGS_BASE.maxBytes
	}, {
		setSource: () => {},
		onChange: () => {}
	});
}
//#endregion
//#region src/shared/protocol.ts
/**
* The subpath the host half's reverse proxy owns on the DSH web port —
* the browser-facing mount every same-origin workbench URL flows through
* (host: `src/vscodeProxy.ts`; client: `src/client/paths.ts`).
*/
const PROXY_MOUNT = "/sidebar/vscode";
/** Spool directory name under the platform tmpdir (both halves derive it). */
const OPEN_CHANNEL_DIR = "dsh-sidebar-vscode";
/**
* The per-workspace spool files of the extension command channel. One
* directory `<tmpdir>/dsh-sidebar-vscode/<slug(folder)>/` holds them all;
* the host half writes, the extension polls:
*
* - `cmd` — the last open command (one-shot; the consumer deletes it).
* - `cap` — the extension's liveness+version marker (`{v, at}`).
* - `bootreq` — the boot nonce the client parks BEFORE the iframe loads.
* - `boot` — the extension's post-reconcile receipt echoing that nonce.
* - `editors` — the editor ledger the reconcile restores from.
* - `last` — the persisted consumed-nonce watermark (replay firewall).
* - `embed` — the embedded-boot stamp (fresh = an EMBEDDED boot).
* - `interact` — the user-interaction stamp of a boot (`{nonce, ts}`):
*   written once the REVEALED workbench sees its first user gesture, read
*   by the reconcile's close loop and the ghost passes to stand down — a
*   boot whose user is already interacting must never have a tab they
*   opened closed out from under them as a restore ghost.
*/
const CHANNEL_FILES = {
	cmd: "cmd.json",
	cap: "cap.json",
	bootreq: "bootreq.json",
	boot: "boot.json",
	editors: "editors.json",
	last: "last.json",
	embed: "embed.json",
	interact: "interact.json"
};
/** How old the capability marker may be before "present" turns false (host). */
const CAPABILITY_MAX_AGE_MS = 12e4;
/**
* Filesystem-safe slug of one workspace folder: non `[A-Za-z0-9_-]`
* characters collapse to '_', capped at 64, plus a djb2-xor hex digest of
* the ORIGINAL string so distinct folders sharing a collapsed form cannot
* collide. BOTH sides derive the spool path from the folder they
* independently know, so the function must stay byte-identical — pinned by
* `tests/protocolLockstep.spec.ts` (vectors) and `tests/openChannel.spec.ts`
* (behavior).
*/
function slugOf(folder) {
	const clean = folder.trim();
	const safe = clean.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	let digest = 5381;
	for (let at = 0; at < clean.length; at += 1) digest = (digest * 33 ^ clean.charCodeAt(at)) >>> 0;
	return `${safe}-${digest.toString(16)}`;
}
//#endregion
//#region src/openChannel.ts
/**
* Host half of the extension command channel: the /tmp spool the embedded
* workbench's `dsh.selection-reference` extension (≥ 0.1.1) polls.
*
* Layout: `<tmpdir>/dsh-sidebar-vscode/<slug(workspace folder)>/<file>.json`
* — one directory per workspace folder, addressed by a filesystem-safe slug
* BOTH sides derive from the folder path they independently know (the client
* sends the mapped folder; the extension derives it from its own
* `workspaceFolders[0]`). The directory name, the file names, the version
* bounds, and the slug function all live in the shared protocol plane
* (`src/shared/protocol.ts`, mirrored in `extension/lib/protocol.js` and
* pinned by `tests/protocolLockstep.spec.ts`). `/tmp` is shared by the
* default same-container topology (serve-web runs beside dsh-runtime — see
* the plugin README's deployment section); a split deployment simply fails
* the capability probe and the client falls back to the URL-payload channel.
*
* - `cap.json` — the extension's liveness marker (`{v,at}`, written by
*   builds ≥ 0.1.2 and refreshed on its poll tick whenever older than a
*   minute); the route only reports it fresh AND versioned within
*   {@link CAPABILITY_MAX_AGE_MS}, so a dead extension stops being
*   "capable" within that window after its last write — and a deployment
*   still carrying the pre-0.1.2 build (whose bare-timestamp marker fails
*   the version parse) is never handed commands at all: that build
*   replayed the last command on every extension-host restart.
* - `cmd.json` — the last open command (atomic tmp+rename write). The
*   consuming extension (≥ 0.1.2) deletes it once acted on, drops entries
*   older than its command TTL, and keeps a monotonic nonce watermark in
*   `last.json` — three independent guards against the same replay: a
*   sidebar tab close/reopen tears down and reboots the workbench, and a
*   fresh extension host reading a leftover cmd.json re-opened the file
*   the user had just closed.
*
* All persistence flows through one {@link SpoolStore}: the atomic
* tmp+rename write discipline, the tmp-name sequencing, and the fail-soft
* JSON read exist exactly once.
*
* @module dsh-sidebar-vscode/openChannel
*/
/** The spool root (same base the extension derives from `os.tmpdir()`). */
const OPEN_CHANNEL_BASE = join(tmpdir(), OPEN_CHANNEL_DIR);
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
	if (typeof record.boot === "string" && record.boot !== "") out.boot = record.boot.slice(0, 128);
	return out;
}
/** Process-lifetime sequence for tmp names (same-millisecond writes collide otherwise). */
let tmpSequence = 0;
/**
* The per-folder JSON spool: one place for the atomic tmp+rename write and
* the fail-soft read every channel file shares. A write is never observed
* half-formed (the extension polls at any instant); a read of a missing or
* corrupt file answers null instead of throwing, so every caller degrades
* rather than breaks.
*/
var SpoolStore = class {
	base;
	/** @param base - the spool root (usually {@link OPEN_CHANNEL_BASE}). */
	constructor(base) {
		this.base = base;
	}
	/** The folder's spool directory (created lazily by {@link write}). */
	dirOf(folder) {
		return join(this.base, slugOf(folder));
	}
	/** Atomically write one JSON document into the folder's spool. */
	async write(folder, file, document, now = Date.now) {
		const dir = this.dirOf(folder);
		await mkdir(dir, { recursive: true });
		const target = join(dir, file);
		const tmp = `${target}.tmp-${process.pid}-${tmpSequence++}-${now()}`;
		await writeFile(tmp, JSON.stringify(document), "utf8");
		await rename(tmp, target);
	}
	/** Read one JSON document; null when absent, unreadable, or corrupt. */
	async readJson(folder, file) {
		try {
			return JSON.parse(await readFile(join(this.dirOf(folder), file), "utf8"));
		} catch {
			return null;
		}
	}
	/** File facts for freshness checks; null when the file is absent. */
	async statFile(folder, file) {
		try {
			return { mtimeMs: (await stat(join(this.dirOf(folder), file))).mtimeMs };
		} catch {
			return null;
		}
	}
};
/**
* Write one open command into the folder's spool (atomic tmp+rename, so the
* extension never observes a partial JSON document).
*/
async function writeOpenCommand(base, command, now = Date.now) {
	await new SpoolStore(base).write(command.folder, CHANNEL_FILES.cmd, {
		...command,
		ts: now()
	}, now);
}
/**
* Stamp the embedded-boot marker for `folder`: the sidebar's client calls
* the `open.embedded` route on every workbench iframe load, and the
* extension reads the marker at activation to tell its EMBEDDED boots (a
* fresh stamp) from standalone windows (no stamp) — only embedded boots
* start with a clean editor area, because their iframe teardown skips
* VS Code's unload lifecycle and its editor-state restore would otherwise
* replay files the user closed seconds before closing the tab.
*/
async function writeEmbeddedBoot(base, folder, now = Date.now) {
	await new SpoolStore(base).write(folder, CHANNEL_FILES.embed, { ts: now() }, now);
}
/**
* Park one boot nonce in `bootreq.json` BEFORE the client mounts the
* workbench iframe: the extension (≥ 0.1.2) reads it at activation and
* echoes it back in its `boot.json` receipt after the editor reconcile,
* so the client can tell THIS boot's receipt from a previous one without
* trusting cross-process clocks. The nonce is client-generated randomness
* (bounded here to a sane printable length); a failed write simply leaves
* the previous nonce, which the fresh echo cannot match — the client's
* reveal timeout covers it.
*/
async function writeBootRequest(base, folder, nonce) {
	await new SpoolStore(base).write(folder, CHANNEL_FILES.bootreq, { nonce });
}
/**
* Stamp one user interaction for a boot (`interact.json`, `{nonce, ts}`):
* the client writes it when the REVEALED workbench sees its first user
* gesture, and the extension's reconcile close loop and ghost passes read
* it to stand down — the reveal racer can hand the user an interactive
* workbench while the reconcile is still settling against a ledger that
* predates their open, and a tab the user opened in that window must
* never be closed as a restore ghost. The nonce scoping keeps a stale
* stamp from disarming a later boot.
*/
async function writeUserInteract(base, folder, nonce, now = Date.now) {
	await new SpoolStore(base).write(folder, CHANNEL_FILES.interact, {
		nonce,
		ts: now()
	}, now);
}
/**
* Whether the extension's `boot.json` receipt for `folder` echoes exactly
* this boot's nonce — i.e. the editor reconcile already ran for the
* workbench the client is keeping invisible. Any missing file, parse
* error, or nonce mismatch answers false (keep waiting; the client's
* timeout reveals regardless).
*/
async function readBootStatus(base, folder, nonce) {
	const parsed = await new SpoolStore(base).readJson(folder, CHANNEL_FILES.boot);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
	return parsed.nonce === nonce;
}
/**
* The boot LEDGER (`editors.json`) as it stands at nonce-park time: the
* open-editor set the extension's reconcile will diff the restored window
* against (same file, same shape the extension's `readLedger` parses —
* `v: 1` with an `editors` array of absolute POSIX paths). Answered
* alongside `boot.begin`'s park so the CLIENT's DOM-quiet reveal racer can
* tell "the strip is quiet because it is settled" from "the strip is
* quiet-but-wrong while the reconcile's close is still in flight" — a
* quiet-but-mismatched strip must keep the frame hidden. Null when absent
* or malformed: a first-ever boot has no ledger (the reconcile then
* touches nothing) and an unreadable one gates nothing.
*/
async function readBootLedger(base, folder) {
	const parsed = await new SpoolStore(base).readJson(folder, CHANNEL_FILES.editors);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed;
	if (record.v !== 1 || !Array.isArray(record.editors)) return null;
	if (!record.editors.every((entry) => typeof entry === "string" && entry.startsWith("/"))) return null;
	return record.editors;
}
/**
* The capability probe's full answer: `present` (same contract as
* {@link readCapability}) plus the marker's build `version` when present
* (null otherwise) — the client tags open commands with the workbench's
* boot nonce only from version 4 up (the boot-tag-aware build); an older
* extension ignores the field, so tagging would be pointless there.
*/
async function readCapabilityMarker(base, folder, maxAgeMs = CAPABILITY_MAX_AGE_MS, now = Date.now) {
	const store = new SpoolStore(base);
	const info = await store.statFile(folder, CHANNEL_FILES.cap);
	if (info === null || now() - info.mtimeMs >= maxAgeMs) return {
		present: false,
		version: null
	};
	const parsed = await store.readJson(folder, CHANNEL_FILES.cap);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {
		present: false,
		version: null
	};
	const version = parsed.v;
	if (!(version === 2 || typeof version === "number" && version > 2)) return {
		present: false,
		version: null
	};
	return {
		present: true,
		version: typeof version === "number" ? version : 2
	};
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
* Both legs (the HTTP mount and the WebSocket upgrade route) sit behind
* the same browser-trust fence as every other plugin route
* (`isTrustedApiRequest`, see trust-fence.ts): the DSH page, its iframe,
* and direct bookmark navigations pass; cross-site pages are refused —
* WebSocket handshakes are not CORS-checked by browsers, and serve-web's
* `handleUpgrade` ignores the connection token, so an unfenced upgrade
* leg would be a cross-site-hijack tunnel into the workbench.
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
	/**
	* The live webRuntime face the browser-trust fence reads (structural;
	* an absent service leaves an empty trustedHosts list, which fences to
	* loopback only — the same fail-closed default the /api routes use).
	*/
	const runtime = () => ctx.webRuntime;
	/**
	* The browser-trust gate for BOTH proxy legs: cross-site pages must not
	* reach the workbench through this mount — firing an HTTP request needs
	* no CORS (and serve-web's side-effectful callbacks ride the token the
	* mount itself appends), and WebSocket handshakes are not CORS-checked
	* at all, so an unfenced upgrade leg is a cross-site-hijack tunnel into
	* the victim's VS Code server (serve-web's `handleUpgrade` ignores the
	* connection token). Same fence as every other plugin route (index.ts);
	* the same-origin page, the embedded iframe, and direct bookmark
	* navigations (`sec-fetch-site: none`, no Origin) all pass.
	*/
	const fenceOk = (req) => isTrustedApiRequest(req, runtime()?.trustedHosts ?? []);
	/** Registered mount prefixes → their current rewrite targets. */
	const mountTargets = /* @__PURE__ */ new Map();
	/** Every registered mount, longest-prefix order is mapRequestUrl's job. */
	const currentMounts = () => [...mounts.keys()].map((prefix) => ({
		prefix,
		upstreamBase: mountTargets.get(prefix) ?? prefix
	}));
	const handleHttp = async (req, res) => {
		if (!fenceOk(req)) {
			res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
			res.end("dsh-sidebar-vscode: cross-site request refused");
			return;
		}
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
		const finalConfig = routing() ?? config;
		proxyHttp(finalConfig, mapRequestUrl(req.url ?? "/", currentMounts(), finalConfig.extraQuery) ?? target, req, res);
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
					if (!fenceOk(req)) {
						socket.destroy();
						return;
					}
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
			inflightProbe = null;
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
/** The route family this half owns on the webserver. */
const API_PREFIX = "/sidebar-vscode/api/";
/** One JSON answer over the response stream. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
/** The error answer every route failure renders as. */
function errorBody(code, message) {
	return {
		ok: false,
		error: {
			code,
			message
		}
	};
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
/** A client-error answer the dispatcher renders with its status and code. */
var ApiError = class extends Error {
	status;
	code;
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
};
/** The request body as a record (a non-object body reads as empty). */
function asRecord(payload) {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
	return payload;
}
/** The `folder` field of one open-channel probe (non-empty string). */
function folderField(payload) {
	const folder = asRecord(payload).folder;
	if (typeof folder !== "string" || folder === "") throw new ApiError(400, "bad-request", "folder must be a non-empty string");
	return folder;
}
/** The `folder` + `nonce` pair the boot-gate routes both require. */
function bootFields(payload) {
	const { folder, nonce } = asRecord(payload);
	if (typeof folder !== "string" || !folder.startsWith("/")) throw new ApiError(400, "bad-request", "folder must be an absolute path");
	if (typeof nonce !== "string" || nonce === "" || nonce.length > 128) throw new ApiError(400, "bad-request", `nonce must be a non-empty string of at most 128 characters`);
	return {
		folder,
		nonce
	};
}
/** The absolute `folder` field of the embedded-boot stamp. */
function absoluteFolderField(payload) {
	const folder = asRecord(payload).folder;
	if (typeof folder !== "string" || !folder.startsWith("/")) throw new ApiError(400, "bad-request", "folder must be an absolute path");
	return folder;
}
/**
* The method table. See the module doc for the route family's purpose;
* each body is the exact behavior of the long if-chain it replaces.
*/
const METHODS = {
	"proxy.status": async (_payload, { proxy }) => proxy.status(),
	"proxy.config": async (payload, { proxy }) => {
		const record = asRecord(payload);
		if (record.reset === true) {
			proxy.configure(null);
			return { mounted: null };
		}
		if (typeof record.url !== "string" || record.url.trim() === "") throw new ApiError(400, "bad-request", "url must be a non-empty string (or {\"reset\":true})");
		const config = parseUpstreamUrl(record.url);
		if (config === null) throw new ApiError(400, "bad-upstream", "url must be an http(s) URL without embedded credentials — the full address code serve-web prints, base path and query included");
		const fetched = await proxy.probeUpstream(config);
		proxy.configure(config, fetched ?? void 0);
		return {
			mounted: `${PROXY_MOUNT}/`,
			reachable: fetched !== null
		};
	},
	"settings.document": async (_payload, { settings }) => {
		if (settings === void 0) throw new ApiError(500, "settings-absent", "settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) in its composition");
		let path;
		try {
			path = await settings.prepareDocument();
		} catch (error) {
			throw new ApiError(500, "internal", `settings document preparation failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (path === void 0 || path === "") throw new ApiError(500, "no-document", "settings provider has no local document to open");
		return { path };
	},
	"open.capability": async (payload) => {
		const folder = folderField(payload);
		const marker = await readCapabilityMarker(OPEN_CHANNEL_BASE, folder);
		return {
			present: marker.present,
			version: marker.version
		};
	},
	"open.embedded": async (payload) => {
		const folder = absoluteFolderField(payload);
		await writeEmbeddedBoot(OPEN_CHANNEL_BASE, folder);
	},
	"open.request": async (payload) => {
		const command = parseOpenCommand(payload);
		if (command === null) throw new ApiError(400, "bad-request", "malformed open request");
		await writeOpenCommand(OPEN_CHANNEL_BASE, command);
	},
	"boot.begin": async (payload) => {
		const { folder, nonce } = bootFields(payload);
		await writeBootRequest(OPEN_CHANNEL_BASE, folder, nonce);
		return { editors: await readBootLedger(OPEN_CHANNEL_BASE, folder) };
	},
	"boot.status": async (payload) => {
		const { folder, nonce } = bootFields(payload);
		return { matched: await readBootStatus(OPEN_CHANNEL_BASE, folder, nonce) };
	},
	"boot.interact": async (payload) => {
		const { folder, nonce } = bootFields(payload);
		await writeUserInteract(OPEN_CHANNEL_BASE, folder, nonce);
	}
};
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
	ctx.inject(["settings"], (settingsCtx) => {
		installVscodeSidebarSettings(ctx, settingsCtx.get("settings"));
	});
	const proxy = createVscodeProxy(ctx);
	const host = ctx;
	ctx.effect(() => host.webServer.register({
		kind: "prefix",
		path: "/sidebar-vscode/api",
		handler: async (req, res) => {
			if (!isTrustedApiRequest(req, host.webRuntime.trustedHosts)) {
				writeJson(res, 403, errorBody("forbidden", "forbidden"));
				return;
			}
			if (req.method !== "POST") {
				writeJson(res, 405, errorBody("method-error", "method not allowed"));
				return;
			}
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			const method = pathname.startsWith(API_PREFIX) ? pathname.slice(20) : void 0;
			if (method === void 0 || method.includes("/")) {
				writeJson(res, 404, errorBody("not-found", "unknown method"));
				return;
			}
			const entry = METHODS[method];
			if (entry === void 0) {
				writeJson(res, 404, errorBody("not-found", `unknown method "${method}"`));
				return;
			}
			try {
				const value = await entry(method === "settings.document" ? null : await readJsonBody(req), {
					proxy,
					settings: host.get("settings")
				});
				writeJson(res, 200, value === void 0 ? { ok: true } : {
					ok: true,
					value
				});
			} catch (error) {
				if (error instanceof ApiError) {
					writeJson(res, error.status, errorBody(error.code, error.message));
					return;
				}
				writeJson(res, 500, errorBody("internal", error instanceof Error ? error.message : String(error)));
			}
		}
	}), "dsh-sidebar-vscode: /sidebar-vscode/api routes");
}
//#endregion
export { apply, inject, name };
