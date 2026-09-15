/**
 * The persistent workbench host's rect projector.
 *
 * WHY PROJECTION AT ALL: the official right-Sidebar pane renders only the
 * ACTIVE tab's body, so switching to a sibling tab unmounts this plugin's
 * tab body — and an iframe element removed from its parent loses its
 * nested browsing context per the HTML spec ("The iframe HTML element
 * removing steps … are to destroy a child navigable"): every DOM move,
 * even one inside the same document, reloads the workbench (verified
 * against Chromium 151 — same-document re-parenting of the iframe AND of
 * its ancestor container both lose the frame's state). The VS Code
 * workbench has no snapshot/rehydrate path, so the only way it survives
 * a tab switch is for its iframe element to NEVER leave the DOM.
 *
 * The design this module serves (see `workbenchRuntime.ts`): the iframe
 * lives in a host `div` that is appended to `document.body` once and
 * re-parented never; the tab body renders a PLACEHOLDER element, and this
 * projector keeps the host's box glued to the placeholder's — one
 * `getBoundingClientRect` read and one style write per animation frame
 * while visible, so the projected frame follows everything the placeholder
 * goes through (the panel's slide transitions, the resize handle, a float
 * drag, fullscreen switches) without the iframe element itself moving.
 *
 * While the tab is not visible (sibling tab active, panel collapsed, body
 * unmounted) the loop stops and the host hides through `visibility` —
 * the last rect is KEPT (a zero-size host would resize the iframe to a
 * 0×0 viewport and make VS Code re-layout on every hide/show cycle; a
 * stale rect under `visibility: hidden` paints nothing and costs nothing).
 *
 * Stacking: the host is a sibling of the app root, so its level is stated
 * here against the levels the host UI owns — the fullscreen panel draws
 * at 40, the floating panels' host at 60, portalled menus at 70 (no
 * z-index token layer exists to draw from). Docked/fullscreen workbenches
 * sit at 45 (above the fullscreen panel they cover, below every float);
 * a FLOATED workbench — the placeholder inside the float host — must sit
 * at 61, above the float layer it belongs to and still below the menus.
 *
 * Everything DOM is injected (anchor, host, frame timing), so the whole
 * object unit-tests in a bare node environment.
 *
 * @module dsh-sidebar-vscode/client/projection
 */
/** The viewport-space box the host must occupy. */
export interface ProjectionRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}
/**
 * The placeholder the projection follows. Structural over `HTMLElement`:
 * the box read plus the presentation probe (the host panel's and float
 * host's data attributes); tests supply bare objects.
 */
export interface ProjectionAnchor {
    getBoundingClientRect(): ProjectionRect;
    /** Nearest ancestor matching a selector, or null; absent in tests. */
    closest?(selector: string): unknown;
}
/** The styled host the projection drives. Structural over `HTMLElement`. */
export interface ProjectionHost {
    readonly style: {
        left: string;
        top: string;
        width: string;
        height: string;
        zIndex: string;
        visibility: string;
    };
}
/** The frame timing the loop rides (injectable for tests). */
export interface ProjectorTiming {
    requestAnimationFrame(callback: () => void): unknown;
    cancelAnimationFrame(handle: unknown): void;
}
/** Stacking level while docked or fullscreen (between the panel's 40 and the float host's 60). */
export declare const OVERLAY_Z_DOCKED = "45";
/** Stacking level while the placeholder lives in the float host (60; above it, below menus at 70). */
export declare const OVERLAY_Z_FLOAT = "61";
/**
 * The stacking level for one anchor: the float host check decides, every
 * other presentation (docked push, fullscreen cover) shares the docked
 * level. Pure — unit-tested directly.
 * @param anchor - the placeholder the projection follows.
 * @returns the z-index the host should carry.
 */
export declare function overlayZIndex(anchor: ProjectionAnchor): string;
/**
 * The projector: one host box glued to one placeholder while visible.
 *
 * Idle states keep the host's last written box (hidden ⇒ nothing paints),
 * so `attach`/`setVisible`/`dispose` are all cheap and order-tolerant.
 */
export declare class OverlayProjector {
    private readonly host;
    private readonly timing;
    private anchor;
    private visible;
    private running;
    private handle;
    private disposed;
    constructor(host: ProjectionHost, timing?: ProjectorTiming);
    /**
     * Point the projection at a placeholder (null = none; the host hides).
     * A live projection continues onto the new anchor in-place.
     * @param anchor - the tab body's placeholder element, or null.
     */
    attach(anchor: ProjectionAnchor | null): void;
    /**
     * Show or hide the projection. Showing syncs once immediately (no
     * one-frame lag on reveal) and then tracks per frame; hiding stops the
     * loop and blanks the host's visibility, keeping its last box.
     * @param visible - whether the workbench should paint now.
     */
    setVisible(visible: boolean): void;
    /** One immediate sync (reveal path); a no-op while hidden or detached. */
    private resync;
    /** Start the per-frame tracking loop (idempotent). */
    private start;
    /** Stop the tracking loop (idempotent). */
    private stop;
    /** Final teardown: hidden and loopless. The host element itself is the runtime's to remove. */
    dispose(): void;
}
