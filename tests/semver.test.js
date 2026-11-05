// Tests for version numbers (vscode-extension/lib/semver.js). Run: node tests/semver.test.js
'use strict';
const assert = require('assert');
const semver = require('../vscode-extension/lib/semver');

assert.deepStrictEqual(semver.parse('0.4.0'), [0, 4, 0]);
assert.deepStrictEqual(semver.parse('v10.2.13'), [10, 2, 13]);
assert.strictEqual(semver.parse('0.4'), null);
assert.strictEqual(semver.parse('0.4.0-beta'), null);
assert.strictEqual(semver.parse(''), null);
assert.strictEqual(semver.parse(undefined), null);
console.log('ok - versions are read, with or without the v');

assert.strictEqual(semver.compare('0.3.31', '0.4.0'), -1);
assert.strictEqual(semver.compare('0.4.0', '0.3.31'), 1);
assert.strictEqual(semver.compare('v0.4.0', '0.4.0'), 0);
assert.strictEqual(semver.compare('0.10.0', '0.9.9'), 1, 'numbers are compared as numbers, not as text');
assert.strictEqual(semver.compare('1.0.0', '0.99.99'), 1);
assert.strictEqual(semver.compare('nonsense', '0.0.1'), -1, 'a text that is not a version is older');
assert.strictEqual(semver.compare('0.0.1', 'nonsense'), 1);
assert.strictEqual(semver.compare('x', 'y'), 0);
console.log('ok - versions are compared by their numbers');

assert.strictEqual(semver.isNewer('0.4.0', '0.3.31'), true);
assert.strictEqual(semver.isNewer('0.3.31', '0.3.31'), false);
assert.strictEqual(semver.isNewer('0.3.30', '0.3.31'), false);
assert.strictEqual(semver.isNewer(undefined, '0.3.31'), false);
console.log('ok - a newer version is detected; the same or older is not');

console.log('all semver tests passed');
