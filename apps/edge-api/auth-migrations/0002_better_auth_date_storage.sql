-- Better Auth's native D1/Kysely adapter writes date fields as ISO text.
-- The original staging schema used STRICT INTEGER timestamps, which rejects
-- those writes with SQLITE_CONSTRAINT_DATATYPE. Rebuild the core auth tables
-- using Better Auth's canonical SQLite DATE affinity while preserving data.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE user_next (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  CHECK (emailVerified IN (0,1))
);

INSERT INTO user_next(id,name,email,emailVerified,image,createdAt,updatedAt)
SELECT
  id,
  name,
  email,
  emailVerified,
  image,
  CASE
    WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', createdAt / 1000.0, 'unixepoch')
    ELSE createdAt
  END,
  CASE
    WHEN typeof(updatedAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt / 1000.0, 'unixepoch')
    ELSE updatedAt
  END
FROM user;

CREATE TABLE session_next (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_next(id) ON UPDATE RESTRICT ON DELETE CASCADE
);

INSERT INTO session_next(id,userId,token,expiresAt,ipAddress,userAgent,createdAt,updatedAt)
SELECT
  id,
  userId,
  token,
  CASE WHEN typeof(expiresAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', expiresAt / 1000.0, 'unixepoch') ELSE expiresAt END,
  ipAddress,
  userAgent,
  CASE WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', createdAt / 1000.0, 'unixepoch') ELSE createdAt END,
  CASE WHEN typeof(updatedAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt / 1000.0, 'unixepoch') ELSE updatedAt END
FROM session;

CREATE TABLE account_next (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_next(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  UNIQUE(providerId,accountId)
);

INSERT INTO account_next(
  id,userId,accountId,providerId,accessToken,refreshToken,
  accessTokenExpiresAt,refreshTokenExpiresAt,scope,idToken,password,createdAt,updatedAt
)
SELECT
  id,
  userId,
  accountId,
  providerId,
  accessToken,
  refreshToken,
  CASE
    WHEN accessTokenExpiresAt IS NULL THEN NULL
    WHEN typeof(accessTokenExpiresAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', accessTokenExpiresAt / 1000.0, 'unixepoch')
    ELSE accessTokenExpiresAt
  END,
  CASE
    WHEN refreshTokenExpiresAt IS NULL THEN NULL
    WHEN typeof(refreshTokenExpiresAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', refreshTokenExpiresAt / 1000.0, 'unixepoch')
    ELSE refreshTokenExpiresAt
  END,
  scope,
  idToken,
  password,
  CASE WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', createdAt / 1000.0, 'unixepoch') ELSE createdAt END,
  CASE WHEN typeof(updatedAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt / 1000.0, 'unixepoch') ELSE updatedAt END
FROM account;

CREATE TABLE verification_next (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE,
  updatedAt DATE
);

INSERT INTO verification_next(id,identifier,value,expiresAt,createdAt,updatedAt)
SELECT
  id,
  identifier,
  value,
  CASE WHEN typeof(expiresAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', expiresAt / 1000.0, 'unixepoch') ELSE expiresAt END,
  CASE
    WHEN createdAt IS NULL THEN NULL
    WHEN typeof(createdAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', createdAt / 1000.0, 'unixepoch')
    ELSE createdAt
  END,
  CASE
    WHEN updatedAt IS NULL THEN NULL
    WHEN typeof(updatedAt) IN ('integer','real') THEN strftime('%Y-%m-%dT%H:%M:%fZ', updatedAt / 1000.0, 'unixepoch')
    ELSE updatedAt
  END
FROM verification;

DROP TABLE session;
DROP TABLE account;
DROP TABLE verification;
DROP TABLE user;

ALTER TABLE user_next RENAME TO user;
ALTER TABLE session_next RENAME TO session;
ALTER TABLE account_next RENAME TO account;
ALTER TABLE verification_next RENAME TO verification;

CREATE INDEX session_user_expires_idx ON session(userId,expiresAt);
CREATE INDEX verification_identifier_idx ON verification(identifier,expiresAt);
