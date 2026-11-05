'use strict';
// Version numbers "major.minor.patch", with an optional leading "v" (as in the git tag v0.4.0). This project does not use pre-release tags.

// [major, minor, patch] or null when the text is not a version.
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// -1 when a is older than b, 0 when they are the same, 1 when a is newer. A text that is not a version is older than any version.
function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

function isNewer(latest, current) {
  return compare(latest, current) > 0;
}

module.exports = { parse, compare, isNewer };
