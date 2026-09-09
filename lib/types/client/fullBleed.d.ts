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
/** Padding of the mounting host, folded to one value per axis (the pane
 * bodies pad uniformly; asymmetric padding bleeds by its leading edge). */
export interface HostPadding {
    /** Horizontal padding (the host's padding-left). */
    readonly x: number;
    /** Vertical padding (the host's padding-top). */
    readonly y: number;
}
/**
 * Read a host's padding off a computed style. Unparsable, negative, or
 * absent values read as 0 — a host that cannot be measured is a host the
 * body simply sits inside at stylesheet sizing.
 */
export declare function readPadding(style: CSSStyleDeclaration): HostPadding;
/**
 * Whether a computed `display` generates no box of its own (the slot
 * machinery mounts seat bodies inside a `display: contents` wrapper).
 */
export declare function isBoxless(display: string): boolean;
/**
 * The inline style that makes the child cover the host's padding box
 * exactly: margins pulling each edge into the padding by its width, and a
 * box grown by both paddings per axis so its far edge lands on the padding
 * box's far edge (block `width: auto` cannot be used — the sheet keeps an
 * explicit `width`, so both dimensions are stated outright).
 */
export declare function bleedStyle(padding: HostPadding): Record<string, string>;
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
export declare function useFullBleed<T extends HTMLElement>(): {
    readonly ref: (node: T | null) => void;
    readonly style: Record<string, string> | undefined;
};
