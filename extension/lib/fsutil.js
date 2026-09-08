'use strict'
/**
 * Filesystem plumbing of the extension side: the atomic marker write and
 * the spool-directory derivation every other module (channel.js, boot.js)
 * shares. The spool layout itself is defined by the shared protocol plane
 * (lib/protocol.js ↔ src/shared/protocol.ts, lockstep-pinned).
 */

const nodeFs = require('fs')
const nodeOs = require('os')
const nodePath = require('path')
const protocol = require('./protocol')

/** Best-effort atomic marker write (tmp + rename); failures are silent. */
function writeMarker (file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  nodeFs.writeFileSync(tmp, value)
  nodeFs.renameSync(tmp, file)
}

/** The spool directory one workspace folder's channel lives in. */
function channelDirOf (folderPath) {
  return nodePath.join(nodeOs.tmpdir(), protocol.OPEN_CHANNEL_DIR, protocol.slugOf(folderPath))
}

module.exports = { writeMarker, channelDirOf }
