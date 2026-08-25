/**
 * Settings-inventory icon for the VSCode tab: the Visual Studio Code mark,
 * drawn with currentColor so it follows the active theme.
 *
 * @module dsh-sidebar-vscode/client/icons
 */
import type { ReactNode } from 'react';
/**
 * The VS Code logo (simple-icons geometry, 24×24 viewBox) at the requested
 * pixel size.
 * @param size - square edge length in CSS pixels.
 */
export declare function VscodeIcon(size: number): ReactNode;
/**
 * The document glyph of one composer reference chip (16×16 viewBox,
 * stroked) — the file icon of a vscode-selection chip.
 */
export declare function FileRefIcon(): ReactNode;
/**
 * The folder glyph of one composer resource chip (16×16 viewBox, stroked) —
 * the icon of a vscode file/folder reference citing a directory.
 */
export declare function FolderRefIcon(): ReactNode;
/**
 * The close (×) glyph of one reference chip's remove button (16×16
 * viewBox, stroked).
 */
export declare function XIcon(): ReactNode;
