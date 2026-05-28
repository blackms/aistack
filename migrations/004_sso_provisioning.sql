-- Migration 004: SSO + SCIM provisioning
-- AIG-646: Enterprise SSO (SAML 2.0 + OIDC) and SCIM v2 provisioning
--
-- Adds:
--   - sso_identities: link users to external IdP identities (SAML/OIDC subject)
--   - sso_sessions: short-lived SSO session metadata (for logout + audit)
--   - sso_replay_cache: persistent replay-protection for SAML assertion IDs and OIDC nonces
--   - scim_groups + scim_group_members: SCIM v2 group provisioning storage
--
-- All tables use TEXT primary keys to align with existing users table convention.

CREATE TABLE IF NOT EXISTS sso_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- 'saml' | 'oidc'
  provider_name TEXT NOT NULL,       -- arbitrary IdP label, e.g. 'okta', 'azure-ad'
  external_id TEXT NOT NULL,         -- SAML NameID or OIDC sub
  attributes_json TEXT,              -- raw normalized attributes from IdP
  groups_json TEXT,                  -- array of group/role names from IdP
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (provider, provider_name, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_identities_user ON sso_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_identities_lookup
  ON sso_identities(provider, provider_name, external_id);

CREATE TABLE IF NOT EXISTS sso_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_index TEXT,                -- SAML SessionIndex for SLO
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (identity_id) REFERENCES sso_identities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_sessions_user ON sso_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires ON sso_sessions(expires_at);

CREATE TABLE IF NOT EXISTS sso_replay_cache (
  -- key is a composite of provider+scope+id, stored as TEXT
  -- e.g. 'saml:assertion:<id>', 'oidc:nonce:<value>', 'saml:inresponseto:<id>'
  key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sso_replay_expires ON sso_replay_cache(expires_at);

CREATE TABLE IF NOT EXISTS scim_groups (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  external_id TEXT,
  attributes_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (display_name)
);

CREATE INDEX IF NOT EXISTS idx_scim_groups_external ON scim_groups(external_id);

CREATE TABLE IF NOT EXISTS scim_group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES scim_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scim_group_members_user
  ON scim_group_members(user_id);
