-- YuiSync operational integrity v25: benefit allocation ledger.

CREATE TABLE subscription_benefit_allocations (
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  appointment_service_position INTEGER NOT NULL DEFAULT -1,
  benefit_kind TEXT NOT NULL DEFAULT 'service',
  benefit_key TEXT NOT NULL,
  service_code TEXT,
  state TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  catalog_price_cents INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  reserved_at_ms INTEGER,
  consumed_at_ms INTEGER,
  released_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id,module_id,id),
  FOREIGN KEY (tenant_id,module_id,subscription_id)
    REFERENCES client_subscriptions(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,module_id,appointment_id)
    REFERENCES appointments(tenant_id,module_id,id) ON UPDATE RESTRICT ON DELETE CASCADE,
  UNIQUE (tenant_id,module_id,operation_key),
  CHECK (appointment_service_position >= -1),
  CHECK (benefit_kind IN ('service','transport')),
  CHECK (length(trim(benefit_key)) BETWEEN 1 AND 160),
  CHECK (state IN ('reserved','consumed','released')),
  CHECK (catalog_price_cents >= 0),
  CHECK (version >= 1)
) STRICT;

CREATE INDEX subscription_benefit_allocations_subscription_idx
  ON subscription_benefit_allocations(tenant_id,module_id,subscription_id,state,benefit_key,updated_at_ms);
CREATE INDEX subscription_benefit_allocations_appointment_idx
  ON subscription_benefit_allocations(tenant_id,module_id,appointment_id,state,appointment_service_position);
CREATE UNIQUE INDEX subscription_benefit_allocations_active_position_unique
  ON subscription_benefit_allocations(tenant_id,module_id,appointment_id,benefit_kind,appointment_service_position)
  WHERE state IN ('reserved','consumed');

INSERT OR IGNORE INTO subscription_benefit_allocations(
  tenant_id,module_id,id,subscription_id,appointment_id,appointment_service_position,
  benefit_kind,benefit_key,service_code,state,operation_key,catalog_price_cents,
  version,reserved_at_ms,consumed_at_ms,released_at_ms,created_at_ms,updated_at_ms
)
SELECT
  a.tenant_id,a.module_id,'legacy_' || a.id || '_' || CAST(s.position AS TEXT),
  a.subscription_id,a.id,s.position,'service',s.service_code,s.service_code,'consumed',
  'legacy-consumed:' || a.id || ':' || CAST(s.position AS TEXT),
  COALESCE(s.catalog_price_cents,s.unit_price_cents),1,NULL,a.updated_at_ms,NULL,a.created_at_ms,a.updated_at_ms
FROM appointments a
JOIN appointment_services s
  ON s.tenant_id=a.tenant_id AND s.module_id=a.module_id AND s.appointment_id=a.id
WHERE a.subscription_id IS NOT NULL
  AND a.subscription_benefit_status='consumed'
  AND s.benefit_used=1;

UPDATE client_subscriptions AS cs
SET benefit_ledger_base_used_json = COALESCE((
  SELECT json_group_object(
    j.key,
    MAX(0, CAST(j.value AS INTEGER) - COALESCE((
      SELECT COUNT(*) FROM subscription_benefit_allocations a
      WHERE a.tenant_id=cs.tenant_id AND a.module_id=cs.module_id
        AND a.subscription_id=cs.id AND a.benefit_key=j.key AND a.state='consumed'
    ),0))
  )
  FROM json_each(cs.services_used_json) j
),'{}');
