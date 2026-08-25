/**
 * Settings-inventory icon for the VSCode tab: the Visual Studio Code mark,
 * drawn with currentColor so it follows the active theme.
 *
 * @module dsh-sidebar-vscode/client/icons
 */

import type { ReactNode } from 'react'

/**
 * The VS Code logo (simple-icons geometry, 24×24 viewBox) at the requested
 * pixel size.
 * @param size - square edge length in CSS pixels.
 */
export function VscodeIcon(size: number): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .325 8.74L3.899 12 .325 15.26a1 1 0 0 0 .002 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

/**
 * The document glyph of one composer reference chip (16×16 viewBox,
 * stroked) — the file icon of a vscode-selection chip.
 */
export function FileRefIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="dsh_vscodeRef_icon">
      <path
        d="M3 2.5A1.5 1.5 0 0 1 4.5 1h3l3 3v9.5A1.5 1.5 0 0 1 9 15H4.5A1.5 1.5 0 0 1 3 13.5v-11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M7.5 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M13 4.5v8A1.5 1.5 0 0 1 11.5 14H5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/**
 * The folder glyph of one composer resource chip (16×16 viewBox, stroked) —
 * the icon of a vscode file/folder reference citing a directory.
 */
export function FolderRefIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="dsh_vscodeRef_icon">
      <path
        d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/**
 * The close (×) glyph of one reference chip's remove button (16×16
 * viewBox, stroked).
 */
export function XIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
