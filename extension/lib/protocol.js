'use strict'
/**
 * Protocol mirror of `src/shared/protocol.ts` — every constant and pure
 * function that crosses the DSH ↔ extension boundary, hand-copied because
 * vsce packages only this directory. `tests/protocolLockstep.spec.ts`
 * loads both modules and asserts the full table (and `slugOf` over a
 * vector of folders) is equal: CI fails the moment the two drift, so a
 * protocol change always lands in BOTH files or neither.
 *
 * Keep this file dependency-free plain CJS (the extension host loads it
 * through plain `require`).
 */

/** Mirror of src/shared/protocol.ts — do not edit one side alone. */
module.exports = {
  SELECTION_MARKER: '@@DSH_REF::',
  PROXY_MOUNT: '/sidebar/vscode',
  OPEN_CHANNEL_DIR: 'dsh-sidebar-vscode',
  CHANNEL_FILES: {
    cmd: 'cmd.json',
    cap: 'cap.json',
    bootreq: 'bootreq.json',
    boot: 'boot.json',
    editors: 'editors.json',
    last: 'last.json',
    embed: 'embed.json',
    interact: 'interact.json',
  },
  NONCE_MAX_LENGTH: 128,
  CHANNEL_CAP_V: 5,
  CAPABILITY_MIN_V: 2,
  CAPABILITY_MAX_AGE_MS: 120000,
  CHANNEL_CMD_TTL_MS: 600000,
  slugOf: function (folder) {
    const clean = String(folder).trim()
    const safe = clean.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    let digest = 5381
    for (let i = 0; i < clean.length; i++) {
      digest = ((digest * 33) ^ clean.charCodeAt(i)) >>> 0
    }
    return safe + '-' + digest.toString(16)
  },
}
