CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  CHECK (emailVerified IN (0,1))
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON UPDATE RESTRICT ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_expires_idx ON session(userId,expiresAt);

CREATE TABLE IF NOT EXISTS account (
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
  FOREIGN KEY (userId) REFERENCES user(id) ON UPDATE RESTRICT ON DELETE CASCADE,
  UNIQUE(providerId,accountId)
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE,
  updatedAt DATE
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier,expiresAt);
