CREATE TABLE IF NOT EXISTS clients (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  email TEXT,
  birth_date TEXT,
  address TEXT,
  address_number TEXT,
  address_complement TEXT,
  address_reference TEXT,
  neighborhood TEXT,
  city TEXT,
  postal_code TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(trim(name)) BETWEEN 1 AND 250),
  CHECK (document IS NULL OR length(document) <= 32),
  CHECK (phone IS NULL OR length(phone) <= 32),
  CHECK (email IS NULL OR length(email) <= 320),
  CHECK (birth_date IS NULL OR length(birth_date) = 10),
  CHECK (address IS NULL OR length(address) <= 300),
  CHECK (address_number IS NULL OR length(address_number) <= 40),
  CHECK (address_complement IS NULL OR length(address_complement) <= 250),
  CHECK (address_reference IS NULL OR length(address_reference) <= 500),
  CHECK (neighborhood IS NULL OR length(neighborhood) <= 150),
  CHECK (city IS NULL OR length(city) <= 150),
  CHECK (postal_code IS NULL OR length(postal_code) <= 16),
  CHECK (notes IS NULL OR length(notes) <= 4000),
  CHECK (status IN ('active', 'inactive'))
) STRICT;

CREATE INDEX IF NOT EXISTS clients_scope_status_name_idx
  ON clients (tenant_id, module_id, status, name, id);

CREATE INDEX IF NOT EXISTS clients_scope_phone_idx
  ON clients (tenant_id, module_id, phone, id);

CREATE INDEX IF NOT EXISTS clients_scope_document_idx
  ON clients (tenant_id, module_id, document, id);

CREATE TABLE IF NOT EXISTS pets (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  species TEXT NOT NULL DEFAULT 'other',
  breed TEXT,
  birth_date TEXT,
  weight_kg REAL,
  color TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, module_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, module_id, client_id)
    REFERENCES clients(tenant_id, module_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CHECK (length(trim(module_id)) BETWEEN 1 AND 64),
  CHECK (module_id = lower(module_id)),
  CHECK (length(trim(id)) BETWEEN 1 AND 160),
  CHECK (length(name) <= 160),
  CHECK (species IN ('dog', 'cat', 'bird', 'rabbit', 'fish', 'other')),
  CHECK (breed IS NULL OR length(breed) <= 160),
  CHECK (birth_date IS NULL OR length(birth_date) = 10),
  CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 500)),
  CHECK (color IS NULL OR length(color) <= 120),
  CHECK (notes IS NULL OR length(notes) <= 4000),
  CHECK (status IN ('active', 'inactive'))
) STRICT;

CREATE INDEX IF NOT EXISTS pets_scope_client_status_idx
  ON pets (tenant_id, module_id, client_id, status, id);

CREATE INDEX IF NOT EXISTS pets_scope_status_name_idx
  ON pets (tenant_id, module_id, status, name, id);

UPDATE _yuisync_system_metadata
SET value = '5', updated_at = CURRENT_TIMESTAMP
WHERE key = 'schema_version';