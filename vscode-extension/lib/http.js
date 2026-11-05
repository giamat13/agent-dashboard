'use strict';
// Small HTTPS helpers for the updater: read JSON or text, and download a file. Only the GitHub hosts in updater.js are used,
// and every redirect is checked the same way. The user's Claude login is never sent here.
const https = require('https');
const fs = require('fs');
const updater = require('./updater');

// Opens a GET request and resolves to the response (status 200 only). Follows up to 5 redirects.
function open(url, accept, hops) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    if (!updater.allowedUrl(url)) return reject(new Error('address not allowed'));
    const req = https.get(url, { headers: { 'User-Agent': 'agent-dashboard', Accept: accept }, timeout: 20000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        return open(new URL(res.headers.location, url).toString(), accept, hops + 1).then(resolve, reject);
      }
      if (code !== 200) {
        res.resume();
        return reject(Object.assign(new Error('http ' + code), { status: code }));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Reads a whole response, and stops when it is larger than the limit (bytes).
function readAll(res, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (d) => {
      size += d.length;
      if (size > limit) {
        res.destroy();
        return reject(new Error('response too large'));
      }
      chunks.push(d);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

async function getJson(url) {
  const res = await open(url, 'application/vnd.github+json', 0);
  return JSON.parse((await readAll(res, 2 * 1024 * 1024)).toString('utf8'));
}

async function getText(url) {
  const res = await open(url, 'text/plain', 0);
  return (await readAll(res, 100 * 1024)).toString('utf8');
}

// Saves the file at url into path. Resolves to the path.
async function download(url, file) {
  const res = await open(url, 'application/octet-stream', 0);
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve(file));
    res.pipe(out);
  });
}

module.exports = { getJson, getText, download };
