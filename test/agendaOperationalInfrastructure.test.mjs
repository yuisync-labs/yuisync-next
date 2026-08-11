import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  MANUAL_SLOT_CAPACITY,
  appointmentOccupiesManualSlot,
  appointmentTransportAddress,
  appointmentTransportLabel,
  operationalCommissionRate,
} from '../src/modules/petshop/lib/appointmentOperational.js'

test('agenda manual expoe quatro colunas visuais sem limitar operacao', () => {
  assert.equal(MANUAL_SLOT_CAPACITY, 4)
  assert.equal(appointmentOccupiesManualSlot({ status: 'agendado' }), true)
  assert.equal(appointmentOccupiesManualSlot({ status: 'concluido' }), false)
  assert.equal(appointmentOccupiesManualSlot({ status: 'cancelado' }), false)
})

test('transporte da ficha diferencia cliente e MotoDog', () => {
  assert.equal(appointmentTransportLabel('cliente_leva'), 'Cliente traz e busca')
  assert.match(appointmentTransportLabel('buscar_e_levar'), /MotoDog/)
  assert.equal(appointmentTransportAddress({ motodog: { address: 'Rua A, 10', neighborhood: 'Centro', city: 'Muriae' } }), 'Rua A, 10 - Centro - Muriae')
})

test('comissao operacional usa 10 por cento para tosa e 5 para outros esteticos', () => {
  assert.equal(operationalCommissionRate({ code: 'tosa_tesoura', group_type: 'banho_tosa' }), 10)
  assert.equal(operationalCommissionRate({ name: 'Banho Pet', group_type: 'banho_tosa' }), 5)
  assert.equal(operationalCommissionRate({ name: 'Escovacao Dental', group_type: 'banho_tosa' }), 5)
  assert.equal(operationalCommissionRate({ name: 'Consulta Veterinaria', group_type: 'veterinaria' }), 0)
})

test('infraestrutura conecta capacidade, transporte e responsible_staff_key', async () => {
  const [migration, freeSchedulingMigration, staffMigration, catalogMigration, agenda, appointments, advanced, advancedCore, commissions, settings, authContext] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260727001000_agenda_capacity_operational_commissions.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260730095500_agenda_free_overlap_visual_lanes.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260727003000_petshop_operational_staff_persistence.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260727004000_reconcile_agenda_service_catalog.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/AgendaPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/hooks/useAppointments.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/hooks/usePetshopAdvanced.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/hooks/usePetshopAdvancedCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/modules/petshop/pages/EquipePage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shared/pages/SettingsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/context/AuthContext.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(migration, /petbot_booking_capacity = 2/)
  assert.match(migration, /responsible_staff_key/)
  assert.ok(migration.includes('calculate_petshop_operational_commissions'))
  assert.ok(migration.includes('book_petshop_appointment_transaction'))
  assert.ok(migration.includes('responsible_staff_key, responsible_staff_name'))
  assert.ok(migration.includes('transport_mode, transport_label, transport_address'))
  assert.doesNotMatch(migration, /as \$\n/)
  assert.doesNotMatch(migration, /\n\$;\n/)
  assert.match(migration, /create or replace function public\.book_petshop_appointment_transaction[\s\S]*?as \$\$/)
  assert.match(migration, /create or replace function public\.update_petshop_appointment_transaction[\s\S]*?as \$\$/)
  assert.ok(migration.includes('revenue * 0.10'))
  assert.ok(migration.includes('revenue * 0.05'))
  assert.match(freeSchedulingMigration, /create or replace function public\.prevent_appointment_overlap/)
  assert.match(freeSchedulingMigration, /begin\s+return new;\s+end;/)
  assert.doesNotMatch(freeSchedulingMigration, /raise exception|v_overlap_count|responsible_staff_key/)
  assert.ok(agenda.includes('Espaco visual {laneIndex + 1}'))
  assert.match(agenda, /agendaPeriod/)
  assert.match(agenda, /DAILY_SLOT_MINUTES = 10/)
  assert.match(agenda, /motodogDefaultsFromClient/)
  assert.match(agenda, /fillMotodogFromClient/)
  assert.match(agenda, /Duracao total do agendamento/)
  assert.match(agenda, /effectiveDuration/)
  assert.doesNotMatch(agenda, /wouldExceedSlotCapacity|sameResponsibleConflict/)
  assert.match(agenda, /Agenda diaria em intervalos de 10 minutos/)
  assert.match(agenda, /label: String\(service.name/)
  assert.doesNotMatch(agenda, /friendlyPetshopServiceLabel/)
  assert.match(agenda, /days=\{agendaDays\}/)
  assert.match(agenda, /slotCapacity=\{MANUAL_SLOT_CAPACITY\}/)
  assert.match(staffMigration, /add column if not exists petshop_operational_staff/)
  assert.match(catalogMigration, /update public\.products product/)
  assert.match(catalogMigration, /set bot_metadata = coalesce/)
  assert.match(catalogMigration, /source_product_id/)
  assert.match(advanced, /from\('products'\)/)
  assert.match(advanced, /inferCatalogServiceGroup/)
  assert.match(advanced, /return 'veterinaria'/)
  assert.match(advanced, /return 'banho_tosa'/)
  assert.match(advanced, /source_product_id/)
  assert.match(settings, /OPERATIONAL_STAFF_TEMPLATE_KEY/)
  assert.match(settings, /Salvar equipe/)
  assert.match(settings, /persistOperationalStaff/)
  assert.match(authContext, /message_templates\?\.\[OPERATIONAL_STAFF_TEMPLATE_KEY\]/)
  assert.match(agenda, /appointmentHourSlotKeys/)
  assert.match(agenda, /appointmentHourSlotKeys\(appt\)\.forEach/)
  assert.match(agenda, /fmtInterval\(appt\)/)
  assert.match(agenda, /fmtInterval\(a\)/)
  assert.match(agenda, /FICHA DE ATENDIMENTO/)
  assert.match(agenda, /Responsavel/)
  assert.match(appointments, /transport_reference/)
  assert.match(advancedCore, /calculate_petshop_operational_commissions/)
  assert.match(advancedCore, /getDateBounds\(startDate\)\.start/)
  assert.match(advancedCore, /getDateBounds\(endDate\)\.end/)
  assert.doesNotMatch(advancedCore, /\$\{startDate\}T00:00:00\.000Z/)
  assert.ok(advancedCore.includes(".is('responsible_staff_key', null)"))
  assert.match(commissions, /Tosa 10%/)
  assert.match(commissions, /Banho e demais servicos 5%/)
})
