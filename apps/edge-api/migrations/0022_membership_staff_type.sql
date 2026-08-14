-- Historical v22 migration restored for deterministic bootstrap/upgrade.
-- The original migration set schema_version=22 unconditionally; the guarded
-- assignment preserves newer environments (v23+) while remaining equivalent
-- when applied after v21 on a fresh database.
ALTER TABLE tenant_memberships ADD COLUMN staff_type TEXT
  CHECK (
    staff_type IS NULL OR staff_type IN (
      'funcionario',
      'banho_tosa',
      'veterinaria',
      'motodog',
      'vendedor_caixa',
      'gerente'
    )
  );

UPDATE tenant_memberships
SET staff_type = CASE
  WHEN role IN ('owner','admin','manager') THEN 'gerente'
  ELSE 'funcionario'
END
WHERE staff_type IS NULL;

UPDATE _yuisync_system_metadata
SET value = CASE
      WHEN CAST(value AS INTEGER) < 22 THEN '22'
      ELSE value
    END,
    updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
