CREATE TABLE IF NOT EXISTS oauth_pending (
  nonce TEXT PRIMARY KEY,
  request_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  requests INTEGER NOT NULL
);
