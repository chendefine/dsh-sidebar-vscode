/**
 * `dsh-sidebar-vscode`, node half: the vscode-selection context boundary.
 *
 * Everything UI-shaped (the better-sidebar VS Code tab, the composer
 * chips, the reference rail) lives in the browser half. This half owns the
 * model-facing seam: for every live agent it listens at `agent/pre-step`,
 * expands canonical `dsh-vscode:` (editor selections) and `dsh-vscode-res:`
 * (explorer file/folder) mentions in the claimed user messages into
 * readable labels plus bounded `<text-selection>` context messages sourced
 * `{ kind: 'vscode-mention', … }` — or, for resources, content-less
 * `<file-selection>`/`<folder-selection>` markers sourced
 * `{ kind: 'vscode-resource', … }` (see `src/mention.ts`). File bytes are
 * read only to mark freshness; the snapshot content itself rides inside the
 * mention, so nothing here depends on filesystem availability.
 *
 * @module dsh-sidebar-vscode
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name (the Loader entry; matches the client bundle id). */
export declare const name = "dsh-sidebar-vscode";
/** Services required before load: the agent registry (agent/created events). */
export declare const inject: string[];
/**
 * Mount the vscode-selection pre-step boundary for every agent.
 * @param ctx - host cordis context.
 */
export declare function apply(ctx: Context): void;
