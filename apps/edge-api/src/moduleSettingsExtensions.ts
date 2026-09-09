export function extensionMergeStatement(
  database: D1Database,
  tenantId: string,
  moduleId: string,
  patch: Record<string, unknown>,
  updatedAtMs = Date.now(),
): D1PreparedStatement {
  return database.prepare(`
    INSERT INTO module_settings_extensions(tenant_id,module_id,data_json,updated_at_ms)
    VALUES(?1,?2,json(?3),?4)
    ON CONFLICT(tenant_id,module_id) DO UPDATE SET
      data_json=json_patch(
        CASE
          WHEN json_valid(module_settings_extensions.data_json) THEN module_settings_extensions.data_json
          ELSE '{}'
        END,
        excluded.data_json
      ),
      updated_at_ms=MAX(module_settings_extensions.updated_at_ms + 1, excluded.updated_at_ms)
  `).bind(tenantId, moduleId, JSON.stringify(patch), updatedAtMs)
}
