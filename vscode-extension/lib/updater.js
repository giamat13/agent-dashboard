'use strict';
// Finds a newer Claude Dashboard in the latest GitHub release, and checks the download. Pure logic only (no VS Code calls, no
// network), so it can be tested with plain node. The network part is in http.js and the install part is in extension.js.
const crypto = require('crypto');
const fs = require('fs');
const semver = require('./semver');

const NAME = 'agent-dashboard';
const RELEASES_URL = 'https://api.github.com/repos/GIAMAT13/agent-dashboard/releases/latest';
// Only these hosts are used: the release list, and the download (GitHub sends the file from its storage host).
const HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com'];

// The version of a release, from its tag ("v0.4.0" -> "0.4.0"). null when the tag is not a version.
function releaseVersion(release) {
  const p = semver.parse(release && release.tag_name);
  return p ? p.join('.') : null;
}

// The .vsix and its .sha256 for this version, by file name. null when the release does not have both.
function pickAssets(release, version) {
  const assets = (release && release.assets) || [];
  const vsix = assets.find((a) => a.name === NAME + '-' + version + '.vsix');
  const sum = assets.find((a) => a.name === NAME + '-' + version + '.vsix.sha256');
  return vsix && sum ? { vsix, sha256: sum } : null;
}

// Only https links to those hosts are followed.
function allowedUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && HOSTS.includes(x.hostname);
  } catch {
    return false;
  }
}

// The hash from a .sha256 file ("<hex>  <file name>", or the hash alone). null when there is no hash in the text.
function parseSha256(text) {
  const m = /\b([a-f0-9]{64})\b/i.exec(String(text || ''));
  return m ? m[1].toLowerCase() : null;
}

function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

// What to do with the latest release:
//   { action: 'none', version, reason? }  (reason: 'no-assets' or 'bad-url' when a newer version cannot be used)
//   { action: 'install', version, vsix, sha256 }  (the two download links)
function plan(release, currentVersion) {
  const version = releaseVersion(release);
  if (!version || !semver.isNewer(version, currentVersion)) return { action: 'none', version };
  const a = pickAssets(release, version);
  if (!a) return { action: 'none', version, reason: 'no-assets' };
  if (!allowedUrl(a.vsix.browser_download_url) || !allowedUrl(a.sha256.browser_download_url)) return { action: 'none', version, reason: 'bad-url' };
  return { action: 'install', version, vsix: a.vsix.browser_download_url, sha256: a.sha256.browser_download_url };
}

module.exports = { NAME, RELEASES_URL, HOSTS, releaseVersion, pickAssets, allowedUrl, parseSha256, fileSha256, plan };
