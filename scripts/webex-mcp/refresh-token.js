#!/usr/bin/env node
// Reads .webex-tokens.json, refreshes the access_token if it's close to expiry,
// writes updated tokens back, and prints the valid access_token to stdout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const CLIENT_ID = env.WEBEX_CLIENT_ID;
const CLIENT_SECRET = env.WEBEX_CLIENT_SECRET;
const tokensPath = path.join(__dirname, '.webex-tokens.json');

if (!fs.existsSync(tokensPath)) {
  console.error('No .webex-tokens.json found. Run `node oauth-setup.js` first.');
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
const ageSec = (Date.now() - tokens.obtained_at) / 1000;
const remaining = tokens.expires_in - ageSec;
// Refresh if less than 1 day remaining, or always if --force is passed
const force = process.argv.includes('--force');
const shouldRefresh = force || remaining < 86400;

if (!shouldRefresh) {
  process.stdout.write(tokens.access_token);
  process.exit(0);
}

const res = await fetch('https://webexapis.com/v1/access_token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
  }).toString(),
});
const data = await res.json();
if (!res.ok) {
  console.error('Refresh failed:', data);
  process.exit(1);
}
const updated = {
  access_token: data.access_token,
  refresh_token: data.refresh_token || tokens.refresh_token,
  expires_in: data.expires_in,
  refresh_token_expires_in: data.refresh_token_expires_in || tokens.refresh_token_expires_in,
  obtained_at: Date.now(),
};
fs.writeFileSync(tokensPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
process.stdout.write(updated.access_token);
