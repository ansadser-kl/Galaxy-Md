"use strict";

// Small bridge so plugins can ask index.js to create/stop/list live sockets
// without a circular require (index.js fills these in at startup).

module.exports = {};
