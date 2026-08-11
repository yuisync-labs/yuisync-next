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
SET value='22', updated_at=CURRENT_TIMESTAMP
WHERE key='schema_version';
