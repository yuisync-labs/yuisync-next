CREATE TABLE IF NOT EXISTS transport_options (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, max_weight_grams INTEGER,
  pickup_required INTEGER NOT NULL, dropoff_required INTEGER NOT NULL, outside_city INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 999,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (id IN ('cliente_leva','motodog','buscar_e_levar','buscar_e_levar_fora_muriae','somente_buscar','somente_levar')),
  CHECK (fee_cents >= 0), CHECK (max_weight_grams IS NULL OR max_weight_grams > 0),
  CHECK (pickup_required IN (0,1) AND dropoff_required IN (0,1) AND outside_city IN (0,1)),
  CHECK (status IN ('active','inactive'))
) STRICT;

CREATE TABLE IF NOT EXISTS appointment_transport (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, appointment_id TEXT NOT NULL, option_id TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, pickup_address TEXT, dropoff_address TEXT,
  pickup_reference TEXT, dropoff_reference TEXT, contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,appointment_id),
  FOREIGN KEY (tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,option_id) REFERENCES transport_options(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (fee_cents >= 0), CHECK (status IN ('pending','scheduled','picked_up','delivered','cancelled'))
) STRICT;

UPDATE _yuisync_system_metadata SET value='10', updated_at=CURRENT_TIMESTAMP WHERE key='schema_version';