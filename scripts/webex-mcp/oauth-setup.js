#!/usr/bin/env node
import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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
const REDIRECT_URI = env.WEBEX_REDIRECT_URI;
const SCOPES = env.WEBEX_SCOPES;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !SCOPES) {
  console.error('Missing required env vars in .env');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');
const authUrl = new URL('https://webexapis.com/v1/authorize');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('state', state);

const port = new URL(REDIRECT_URI).port || 8765;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  console.log(`[callback] ${req.method} ${req.url}`);
  console.log('[callback] params:', Object.fromEntries(url.searchParams));
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description') || '';
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>OAuth error: ${error}</h2><pre>${desc}</pre>`);
    console.error('OAuth error:', error, desc);
    return;
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>Missing code</h2><pre>Received params: ${JSON.stringify(Object.fromEntries(url.searchParams), null, 2)}</pre>`);
    return;
  }
  if (returnedState !== state) {
    res.writeHead(400);
    res.end('State mismatch');
    return;
  }
  try {
    const tokenRes = await fetch('https://webexapis.com/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      res.writeHead(500);
      res.end('Token exchange failed: ' + JSON.stringify(data));
      console.error('Token exchange failed:', data);
      process.exit(1);
    }
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      refresh_token_expires_in: data.refresh_token_expires_in,
      obtained_at: Date.now(),
    };
    fs.writeFileSync(
      path.join(__dirname, '.webex-tokens.json'),
      JSON.stringify(tokens, null, 2),
      { mode: 0o600 },
    );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Webex OAuth success</h2><p>Tokens saved. You can close this tab.</p>');
    console.log('Tokens saved to .webex-tokens.json');
    console.log(`access_token valid for ${data.expires_in}s (~${Math.round(data.expires_in / 86400)}d)`);
    console.log(`refresh_token valid for ${data.refresh_token_expires_in}s (~${Math.round(data.refresh_token_expires_in / 86400)}d)`);
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.writeHead(500);
    res.end('Error: ' + e.message);
    console.error(e);
    process.exit(1);
  }
});

server.listen(port, () => {
  console.log(`\nOpen this URL in your browser to authorize:\n`);
  console.log(authUrl.toString());
  console.log(`\nWaiting for callback on ${REDIRECT_URI} ...`);
});
