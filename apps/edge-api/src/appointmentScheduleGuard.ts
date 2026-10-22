export type AppointmentScheduleGuard = { capacity: number; settingsJSON: string }
export function appointmentScheduleGuardStatement(db:D1Database,input:{tenantId:string;moduleId:string;appointmentId:string;guard:AppointmentScheduleGuard}):D1PreparedStatement {
  return db.prepare(`INSERT INTO appointment_schedule_guards(tenant_id,module_id,appointment_id,capacity,settings_json) VALUES(?1,?2,?3,?4,?5)
    ON CONFLICT(tenant_id,module_id,appointment_id) DO UPDATE SET capacity=excluded.capacity,settings_json=excluded.settings_json`)
    .bind(input.tenantId,input.moduleId,input.appointmentId,input.guard.capacity,input.guard.settingsJSON)
}
