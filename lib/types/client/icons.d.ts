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
/** The props face the official right-Sidebar's guide entry icon accepts. */
export interface GuideIconProps {
    /** Square edge in px; the glyph defaults to 16 when absent. */
    readonly size?: number | undefined;
    /** Extra class for layout placement; color rides currentColor. */
    readonly className?: string | undefined;
}
/**
 * The guide-entry glyph: {@link VscodeIcon} dressed as the component the
 * official `SidebarRightGuideEntry.icon` seat expects
 * (`ComponentType<IconProps>`), drawn at the sidebar's own 16px scale.
 */
export declare function VscodeGuideIcon({ size, className }: GuideIconProps): ReactNode;
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
