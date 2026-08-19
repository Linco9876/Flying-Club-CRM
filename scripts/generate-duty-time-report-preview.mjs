import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDutyTimeReportPdf } from '../src/utils/dutyTimeReportPdf.ts';

const start = new Date('2026-06-01T00:00:00+10:00');
const duties = [];
const rows = [];
let rollingDuty = [];
let rollingFlight = [];

for (let index = 0; index < 56; index += 1) {
  const day = new Date(start);
  day.setDate(start.getDate() + index);
  const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const isDutyDay = index % 7 < 5;
  const durationHours = isDutyDay ? 7 + (index % 5) * 0.7 : 0;
  const flightHours = isDutyDay ? 2.1 + (index % 4) * 0.6 : 0;
  let duty;

  if (isDutyDay) {
    const dutyStart = new Date(`${dateKey}T${index % 6 === 0 ? '05:30' : '08:00'}:00+10:00`);
    const dutyEnd = new Date(dutyStart.getTime() + durationHours * 60 * 60 * 1000);
    duty = {
      id: `sample-${index}`,
      status: 'completed',
      start: dutyStart,
      end: dutyEnd,
      durationHours,
      flightHours,
      location: index % 9 === 0 ? 'Shepparton / external standardisation activity' : 'Bendigo',
      isExternal: index % 9 === 0,
      breakCount: index % 3 === 0 ? 1 : 0,
    };
    duties.push(duty);
  }

  rollingDuty = [...rollingDuty.slice(-6), durationHours];
  rollingFlight = [...rollingFlight.slice(-27), flightHours];
  const duty7 = rollingDuty.reduce((total, value) => total + value, 0);
  const duty14 = Math.min(105, duty7 * 1.85);
  const flight28 = rollingFlight.reduce((total, value) => total + value, 0);
  const issues = index === 18
    ? ['Daily FDP span 11.2h exceeds Appendix 6 limit 10h', 'Only 9.5h off-duty before first duty; minimum is 12h']
    : index === 33
      ? ['Rolling 7-day CRM duty 62.4h exceeds 60h']
      : [];

  rows.push({
    date: day.toLocaleDateString('en-AU', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    dateKey,
    duties: duty ? [duty] : [],
    firstStart: duty?.start,
    lastEnd: duty?.end,
    dutySpanHours: durationHours,
    bookedHours: flightHours,
    fdpLimitHours: isDutyDay ? 11 : 0,
    latestFinish: duty ? new Date(`${dateKey}T23:59:00+10:00`) : undefined,
    restBeforeHours: isDutyDay ? 14 : undefined,
    rolling7DutyHours: index === 33 ? 62.4 : duty7,
    rolling14DutyHours: duty14,
    rolling28FlightHours: flight28,
    rolling365FlightHours: 412.6 + flight28,
    status: issues.length ? 'attention' : 'ok',
    issues,
  });
}

const bytes = await createDutyTimeReportPdf({
  instructor: { name: 'Sample Instructor', email: 'instructor@example.com' },
  period: { start: '2026-06-01', end: '2026-07-26' },
  rows,
  duties,
  maxDailyFlightHours: 7,
  minimumRestHours: 12,
  generatedAt: new Date('2026-08-10T10:30:00+10:00'),
});

const outputDirectory = resolve('tmp/pdfs');
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, 'duty-time-report-preview.pdf');
await writeFile(outputPath, bytes);
console.log(outputPath);
