-- Capacity exists only when explicitly provisioned. No default vehicle/slot.
CREATE TABLE transport_resources (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,id TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 50),status TEXT NOT NULL CHECK(status IN ('active','inactive')),
 PRIMARY KEY(tenant_id,module_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id)
) STRICT;
CREATE TABLE transport_option_resources (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,option_id TEXT NOT NULL,resource_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,module_id,option_id),
 FOREIGN KEY(tenant_id,module_id,option_id) REFERENCES transport_options(tenant_id,module_id,id),
 FOREIGN KEY(tenant_id,module_id,resource_id) REFERENCES transport_resources(tenant_id,module_id,id)
) STRICT;
CREATE TABLE transport_availability_windows (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,id TEXT NOT NULL,resource_id TEXT NOT NULL,starts_at_ms INTEGER NOT NULL,ends_at_ms INTEGER NOT NULL CHECK(ends_at_ms>starts_at_ms),version INTEGER NOT NULL CHECK(version>0),
 PRIMARY KEY(tenant_id,module_id,id),FOREIGN KEY(tenant_id,module_id,resource_id) REFERENCES transport_resources(tenant_id,module_id,id)
) STRICT;
CREATE INDEX transport_windows_lookup ON transport_availability_windows(tenant_id,module_id,resource_id,starts_at_ms,ends_at_ms);
CREATE TABLE appointment_transport_reservations (
 tenant_id TEXT NOT NULL,module_id TEXT NOT NULL,appointment_id TEXT NOT NULL,resource_id TEXT NOT NULL,window_id TEXT NOT NULL,window_version INTEGER NOT NULL,
 starts_at_ms INTEGER NOT NULL,ends_at_ms INTEGER NOT NULL CHECK(ends_at_ms>starts_at_ms),snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 PRIMARY KEY(tenant_id,module_id,appointment_id),FOREIGN KEY(tenant_id,module_id,appointment_id) REFERENCES appointments(tenant_id,module_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,module_id,resource_id) REFERENCES transport_resources(tenant_id,module_id,id),FOREIGN KEY(tenant_id,module_id,window_id) REFERENCES transport_availability_windows(tenant_id,module_id,id)
) STRICT;
CREATE INDEX transport_reservations_lookup ON appointment_transport_reservations(tenant_id,module_id,resource_id,starts_at_ms,ends_at_ms);
CREATE VIEW transport_resource_allocations AS
 SELECT r.tenant_id,r.module_id,r.appointment_id,r.resource_id,r.starts_at_ms,r.ends_at_ms
 FROM appointment_transport_reservations r JOIN appointments a ON a.tenant_id=r.tenant_id AND a.module_id=r.module_id AND a.id=r.appointment_id
 WHERE a.status IN ('scheduled','confirmed','in_progress','blocked','completed')
 UNION
 SELECT t.tenant_id,t.module_id,t.appointment_id,m.resource_id,a.scheduled_at_ms,a.scheduled_at_ms+a.duration_min*60000
 FROM appointment_transport t JOIN appointments a ON a.tenant_id=t.tenant_id AND a.module_id=t.module_id AND a.id=t.appointment_id
 JOIN transport_option_resources m ON m.tenant_id=t.tenant_id AND m.module_id=t.module_id AND m.option_id=t.option_id
 WHERE a.status IN ('scheduled','confirmed','in_progress','blocked','completed') AND t.status<>'cancelled';
CREATE TRIGGER transport_reservation_guard BEFORE INSERT ON appointment_transport_reservations
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transport_availability_windows w
  JOIN transport_resources r ON r.tenant_id=w.tenant_id AND r.module_id=w.module_id AND r.id=w.resource_id
  JOIN appointment_transport t ON t.tenant_id=NEW.tenant_id AND t.module_id=NEW.module_id AND t.appointment_id=NEW.appointment_id
  JOIN transport_option_resources m ON m.tenant_id=t.tenant_id AND m.module_id=t.module_id AND m.option_id=t.option_id
  JOIN transport_options o ON o.tenant_id=t.tenant_id AND o.module_id=t.module_id AND o.id=t.option_id
  JOIN appointments ap ON ap.tenant_id=t.tenant_id AND ap.module_id=t.module_id AND ap.id=t.appointment_id
  JOIN pets p ON p.tenant_id=ap.tenant_id AND p.module_id=ap.module_id AND p.id=ap.pet_id
  JOIN tenant_module_settings settings ON settings.tenant_id=ap.tenant_id AND settings.module_id=ap.module_id
  WHERE w.tenant_id=NEW.tenant_id AND w.module_id=NEW.module_id AND w.id=NEW.window_id AND w.resource_id=NEW.resource_id
   AND w.version=NEW.window_version AND w.starts_at_ms<=NEW.starts_at_ms AND w.ends_at_ms>=NEW.ends_at_ms
   AND r.status='active' AND m.resource_id=r.id AND o.status='active' AND o.fee_cents=t.fee_cents
   AND r.capacity=json_extract(NEW.snapshot_json,'$.capacity') AND o.fee_cents=json_extract(NEW.snapshot_json,'$.fee_cents')
   AND o.pickup_required=json_extract(NEW.snapshot_json,'$.pickup_required') AND o.dropoff_required=json_extract(NEW.snapshot_json,'$.dropoff_required')
   AND ap.pet_id=json_extract(NEW.snapshot_json,'$.pet_id') AND ap.scheduled_at_ms=NEW.starts_at_ms
   AND ap.scheduled_at_ms+ap.duration_min*60000=NEW.ends_at_ms AND p.status='active'
   AND (o.max_weight_grams IS NULL OR (p.weight_kg>0 AND ROUND(p.weight_kg*1000)<=o.max_weight_grams))
   AND ROUND(p.weight_kg*1000) IS json_extract(NEW.snapshot_json,'$.weight_grams')
   AND o.outside_city=json_extract(NEW.snapshot_json,'$.outside_city')
   AND o.max_weight_grams IS json_extract(NEW.snapshot_json,'$.max_weight_grams')
   AND settings.store_city=json_extract(NEW.snapshot_json,'$.store_city')
   AND (o.pickup_required=0 OR t.pickup_address=json_extract(NEW.snapshot_json,'$.address'))
   AND (o.dropoff_required=0 OR t.dropoff_address=json_extract(NEW.snapshot_json,'$.address')))
  THEN RAISE(ABORT,'TRANSPORT_QUOTE_CHANGED') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM transport_resource_allocations a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id
   AND a.resource_id=NEW.resource_id AND a.appointment_id<>NEW.appointment_id AND a.starts_at_ms<NEW.ends_at_ms AND a.ends_at_ms>NEW.starts_at_ms)
  >=(SELECT capacity FROM transport_resources WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND id=NEW.resource_id)
  THEN RAISE(ABORT,'TRANSPORT_CAPACITY_EXCEEDED') END;
END;
CREATE TRIGGER transport_native_insert_guard BEFORE INSERT ON appointment_transport
WHEN NEW.status<>'cancelled' AND EXISTS(SELECT 1 FROM transport_option_resources WHERE tenant_id=NEW.tenant_id AND module_id=NEW.module_id AND option_id=NEW.option_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM appointments owner JOIN transport_option_resources m
  ON m.tenant_id=owner.tenant_id AND m.module_id=owner.module_id AND m.option_id=NEW.option_id
  JOIN transport_resources r ON r.tenant_id=m.tenant_id AND r.module_id=m.module_id AND r.id=m.resource_id
  WHERE owner.tenant_id=NEW.tenant_id AND owner.module_id=NEW.module_id AND owner.id=NEW.appointment_id
   AND (r.status<>'active' OR (SELECT COUNT(*) FROM transport_resource_allocations a WHERE a.tenant_id=NEW.tenant_id AND a.module_id=NEW.module_id AND a.resource_id=r.id
    AND a.appointment_id<>NEW.appointment_id AND a.starts_at_ms<owner.scheduled_at_ms+owner.duration_min*60000 AND a.ends_at_ms>owner.scheduled_at_ms)>=r.capacity))
  THEN RAISE(ABORT,'TRANSPORT_CAPACITY_EXCEEDED') END;
END;
-- Moving a transport booking requires another verified transport proposal,
-- not a date-only command which would leave the vehicle reservation behind.
CREATE TRIGGER transport_reschedule_guard BEFORE UPDATE OF scheduled_at_ms,duration_min ON appointments
WHEN (NEW.scheduled_at_ms<>OLD.scheduled_at_ms OR NEW.duration_min<>OLD.duration_min)
 AND EXISTS(SELECT 1 FROM appointment_transport_reservations r WHERE r.tenant_id=OLD.tenant_id AND r.module_id=OLD.module_id AND r.appointment_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'TRANSPORT_REPREPARATION_REQUIRED'); END;
-- A native writer must not detach/change a verified vehicle reservation.
CREATE TRIGGER transport_verified_update_guard BEFORE UPDATE OF option_id,fee_cents,pickup_address,dropoff_address,pickup_reference,dropoff_reference ON appointment_transport
WHEN EXISTS(SELECT 1 FROM appointment_transport_reservations r WHERE r.tenant_id=OLD.tenant_id AND r.module_id=OLD.module_id AND r.appointment_id=OLD.appointment_id)
 AND (NEW.option_id IS NOT OLD.option_id OR NEW.fee_cents IS NOT OLD.fee_cents OR NEW.pickup_address IS NOT OLD.pickup_address OR NEW.dropoff_address IS NOT OLD.dropoff_address OR NEW.pickup_reference IS NOT OLD.pickup_reference OR NEW.dropoff_reference IS NOT OLD.dropoff_reference)
BEGIN SELECT RAISE(ABORT,'TRANSPORT_REPREPARATION_REQUIRED'); END;
CREATE TRIGGER transport_reactivation_guard BEFORE UPDATE OF status ON appointments
WHEN OLD.status='cancelled' AND NEW.status IN ('scheduled','confirmed','in_progress','blocked','completed')
 AND EXISTS(SELECT 1 FROM appointment_transport_reservations r WHERE r.tenant_id=OLD.tenant_id AND r.module_id=OLD.module_id AND r.appointment_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'TRANSPORT_REPREPARATION_REQUIRED'); END;
