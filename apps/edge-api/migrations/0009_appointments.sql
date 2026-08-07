CREATE TABLE IF NOT EXISTS appointments (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL,
  client_id TEXT NOT NULL, pet_id TEXT NOT NULL,
  scheduled_at_ms INTEGER NOT NULL, duration_minutes INTEGER NOT NULL,
  service_group TEXT, status TEXT NOT NULL DEFAULT 'scheduled', source TEXT NOT NULL DEFAULT 'manual',
  subtotal_cents INTEGER NOT NULL DEFAULT 0, transport_fee_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT, version INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,client_id) REFERENCES clients(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,pet_id) REFERENCES pets(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (duration_minutes BETWEEN 15 AND 1440),
  CHECK (service_group IS NULL OR service_group IN ('banho_tosa','veterinaria','outro')),
  CHECK (status IN ('available','scheduled','confirmed','in_progress','completed','cancelled','blocked')),
  CHECK (source GLOB '[a-z0-9]*' AND length(source) BETWEEN 1 AND 40),
  CHECK (subtotal_cents >= 0 AND transport_fee_cents >= 0), CHECK (version >= 1)
) STRICT;
CREATE INDEX IF NOT EXISTS appointments_scope_schedule_idx ON appointments(tenant_id,module_id,scheduled_at_ms,status,id);
CREATE INDEX IF NOT EXISTS appointments_scope_pet_idx ON appointments(tenant_id,module_id,pet_id,scheduled_at_ms,id);

CREATE TABLE IF NOT EXISTS appointment_services (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, appointment_id TEXT NOT NULL, position INTEGER NOT NULL,
  service_id TEXT NOT NULL, service_code TEXT NOT NULL, service_name TEXT NOT NULL, service_group TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL, duration_minutes INTEGER NOT NULL, benefit_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id,module_id,appointment_id,position),
  FOREIGN KEY (tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,service_id) REFERENCES services(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (position BETWEEN 0 AND 19), CHECK (service_group IN ('banho_tosa','veterinaria','motoboy','outro')),
  CHECK (unit_price_cents >= 0), CHECK (duration_minutes BETWEEN 15 AND 1440), CHECK (benefit_used IN (0,1))
) STRICT;

UPDATE _yuisync_system_metadata SET value='9', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';