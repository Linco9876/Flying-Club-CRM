// Run against the disposable fixture database, never the live CRM.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const database = process.env.PRIVATE_AIRCRAFT_TEST_DATABASE || 'private_aircraft_test_v2';
assert.match(database, /^private_aircraft_test(?:_[a-z0-9]+)?$/);
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PRIVATE_AIRCRAFT_TEST_PORT || '55441', '-U', 'postgres', '-d', database];
const sql = statement => exec('psql', [...args, '-c', statement]);
const option = '00000000-0000-4000-8000-000000000001';
const bookings = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const instructor = randomUUID();
const insert = (id, teacher, rego) => `insert into public.bookings(id,aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration,start_time,end_time) values ('${id}','${option}','${teacher}','Cessna 172','${rego}','2026-09-09 10:00+10','2026-09-09 12:00+10');`;
try {
  await sql(`update public.aircraft set private_booking_enabled=true where id='${option}';`);
  const independent = await Promise.allSettled([
    sql(`begin; ${insert(bookings[0], randomUUID(), 'VH-ONE')} select pg_sleep(0.5); commit;`),
    sql(`begin; ${insert(bookings[1], randomUUID(), 'VH-TWO')} commit;`),
  ]);
  assert.equal(independent.filter(result => result.status === 'fulfilled').length, 2, 'Different private aircraft must book concurrently');
  const shared = await Promise.allSettled([
    sql(`begin; ${insert(bookings[2], instructor, 'VH-THREE')} select pg_sleep(0.5); commit;`),
    sql(`begin; ${insert(bookings[3], instructor, 'VH-FOUR')} commit;`),
  ]);
  assert.equal(shared.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one competing instructor reservation must succeed');
  assert.match(shared.find(result => result.status === 'rejected').reason.stderr, /conflicts with an existing/);
  console.log('Concurrent private bookings passed: separate instructors accepted; competing instructor reservation rejected.');
} finally {
  await sql(`delete from public.bookings where id in (${bookings.map(id => `'${id}'`).join(',')}); update public.aircraft set private_booking_enabled=false where id='${option}';`);
}
