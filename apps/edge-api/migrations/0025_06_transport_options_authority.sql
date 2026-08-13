-- YuiSync operational integrity v25: transport option identifiers are data, not a duplicated schema enum.
-- appointment_transport already references transport_options by FK, so the option row is the authority.

CREATE TABLE transport_options_v25 (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, max_weight_grams INTEGER,
  pickup_required INTEGER NOT NULL, dropoff_required INTEGER NOT NULL, outside_city INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', sort_order INTEGER NOT NULL DEFAULT 999,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(trim(id)) BETWEEN 1 AND 80),
  CHECK (id GLOB '[a-z0-9_]*'),
  CHECK (fee_cents >= 0), CHECK (max_weight_grams IS NULL OR max_weight_grams > 0),
  CHECK (pickup_required IN (0,1) AND dropoff_required IN (0,1) AND outside_city IN (0,1)),
  CHECK (status IN ('active','inactive'))
) STRICT;

INSERT INTO transport_options_v25(
  tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
)
SELECT tenant_id,module_id,id,label,fee_cents,max_weight_grams,pickup_required,dropoff_required,outside_city,status,sort_order
FROM transport_options;

CREATE TABLE appointment_transport_v25 (
  tenant_id TEXT NOT NULL, module_id TEXT NOT NULL, appointment_id TEXT NOT NULL, option_id TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0, pickup_address TEXT, dropoff_address TEXT,
  pickup_reference TEXT, dropoff_reference TEXT, contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending', notes TEXT, updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,appointment_id),
  FOREIGN KEY (tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,module_id,option_id) REFERENCES transport_options_v25(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (fee_cents >= 0), CHECK (status IN ('pending','scheduled','picked_up','delivered','cancelled'))
) STRICT;

INSERT INTO appointment_transport_v25(
  tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,
  pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms
)
SELECT tenant_id,module_id,appointment_id,option_id,fee_cents,pickup_address,dropoff_address,
  pickup_reference,dropoff_reference,contact_phone,status,notes,updated_at_ms
FROM appointment_transport;

DROP TABLE appointment_transport;
DROP TABLE transport_options;
ALTER TABLE transport_options_v25 RENAME TO transport_options;
ALTER TABLE appointment_transport_v25 RENAME TO appointment_transport;
