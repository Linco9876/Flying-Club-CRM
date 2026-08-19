import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import { normalisePdfText, truncatePdfText, wrapPdfText } from './coursePdfLayout.ts';
import {
  buildDutyTrendSeries,
  calculateDutyTimeSummary,
  dutyReportFilename,
  type DutyTimeDay,
  type DutyTimePeriod,
  type DutyTrendPoint,
} from './dutyTimeReport.ts';

export type DutyTimeReportPdfInput = {
  instructor: { name: string; email?: string };
  period: { start: string; end: string };
  rows: DutyTimeDay[];
  duties: DutyTimePeriod[];
  maxDailyFlightHours: number;
  minimumRestHours: number;
  generatedAt?: Date;
};

type PdfPalette = {
  navy: RGB;
  blue: RGB;
  cyan: RGB;
  paleBlue: RGB;
  green: RGB;
  paleGreen: RGB;
  amber: RGB;
  paleAmber: RGB;
  red: RGB;
  ink: RGB;
  muted: RGB;
  border: RGB;
  panel: RGB;
  white: RGB;
};

const PAGE_SIZE: [number, number] = [841.89, 595.28];
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN * 2;

const formatHours = (value: number) => `${value.toFixed(1)} h`;
const formatTime = (value?: Date) => value
  ? value.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })
  : '-';
const formatGenerated = (date: Date) => date.toLocaleString('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const drawText = (
  page: PDFPage,
  font: PDFFont,
  value: unknown,
  x: number,
  y: number,
  size: number,
  color: RGB,
  maxWidth?: number,
) => {
  const measure = (text: string) => font.widthOfTextAtSize(text, size);
  const text = maxWidth == null
    ? normalisePdfText(value)
    : truncatePdfText(value, measure, maxWidth);
  page.drawText(text, { x, y, size, font, color });
};

const drawWrappedText = (
  page: PDFPage,
  font: PDFFont,
  value: unknown,
  x: number,
  y: number,
  size: number,
  color: RGB,
  maxWidth: number,
  lineHeight = size * 1.3,
  maxLines = 3,
) => {
  const measure = (text: string) => font.widthOfTextAtSize(text, size);
  const lines = wrapPdfText(value, measure, maxWidth).slice(0, maxLines);
  lines.forEach((line, index) => {
    const finalLine = index === maxLines - 1 && wrapPdfText(value, measure, maxWidth).length > maxLines
      ? truncatePdfText(`${line}...`, measure, maxWidth, '')
      : line;
    page.drawText(finalLine, { x, y: y - index * lineHeight, size, font, color });
  });
  return lines.length * lineHeight;
};

const drawSectionTitle = (
  page: PDFPage,
  bold: PDFFont,
  palette: PdfPalette,
  title: string,
  subtitle: string,
  y: number,
) => {
  page.drawRectangle({ x: MARGIN, y: y - 26, width: CONTENT_WIDTH, height: 26, color: palette.paleBlue });
  page.drawRectangle({ x: MARGIN, y: y - 26, width: 5, height: 26, color: palette.blue });
  drawText(page, bold, title, MARGIN + 13, y - 17, 11, palette.navy, 250);
  drawText(page, bold, subtitle, MARGIN + 280, y - 17, 7.5, palette.muted, CONTENT_WIDTH - 292);
};

const drawMetric = (
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  palette: PdfPalette,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  detail: string,
  accent: RGB,
) => {
  page.drawRectangle({ x, y, width, height: 58, color: palette.white, borderColor: palette.border, borderWidth: 0.7 });
  page.drawRectangle({ x, y, width: 4, height: 58, color: accent });
  drawText(page, regular, label.toUpperCase(), x + 12, y + 42, 6.5, palette.muted, width - 20);
  drawText(page, bold, value, x + 12, y + 21, 16, palette.ink, width - 20);
  drawText(page, regular, detail, x + 12, y + 8, 6.5, palette.muted, width - 20);
};

const drawChartFrame = (
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  palette: PdfPalette,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
) => {
  page.drawRectangle({ x, y, width, height, color: palette.white, borderColor: palette.border, borderWidth: 0.7 });
  drawText(page, bold, title, x + 12, y + height - 18, 9, palette.ink, width - 24);
  drawText(page, regular, subtitle, x + 12, y + height - 31, 6.5, palette.muted, width - 24);
};

const drawDutyFlightChart = (
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  palette: PdfPalette,
  points: DutyTrendPoint[],
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const weekly = points.some(point => point.rangeLabel.includes(' - '));
  drawChartFrame(page, bold, regular, palette, x, y, width, height, weekly ? 'Weekly duty profile' : 'Daily duty profile', 'Duty and flight/supervision hours remain separate');
  const plot = { x: x + 32, y: y + 24, width: width - 45, height: height - 66 };
  const maxValue = Math.max(1, ...points.flatMap(point => [point.dutyHours, point.flightHours]));
  const axisMax = Math.ceil(maxValue / 5) * 5 || 5;

  for (let line = 0; line <= 4; line += 1) {
    const lineY = plot.y + (plot.height * line) / 4;
    page.drawLine({ start: { x: plot.x, y: lineY }, end: { x: plot.x + plot.width, y: lineY }, thickness: 0.35, color: palette.border });
    drawText(page, regular, ((axisMax * line) / 4).toFixed(0), x + 8, lineY - 2, 5.5, palette.muted, 20);
  }

  if (points.length === 0) {
    drawText(page, regular, 'No recorded duty in this period', plot.x + 60, plot.y + plot.height / 2, 8, palette.muted, plot.width - 100);
  } else {
    const groupWidth = plot.width / points.length;
    const barWidth = Math.max(1.2, Math.min(7, groupWidth * 0.3));
    points.forEach((point, index) => {
      const centre = plot.x + groupWidth * index + groupWidth / 2;
      const dutyHeight = (point.dutyHours / axisMax) * plot.height;
      const flightHeight = (point.flightHours / axisMax) * plot.height;
      page.drawRectangle({ x: centre - barWidth - 0.6, y: plot.y, width: barWidth, height: dutyHeight, color: palette.blue });
      page.drawRectangle({ x: centre + 0.6, y: plot.y, width: barWidth, height: flightHeight, color: palette.cyan });
    });
    const labelEvery = Math.max(1, Math.ceil(points.length / 7));
    points.forEach((point, index) => {
      if (index % labelEvery !== 0 && index !== points.length - 1) return;
      drawText(page, regular, point.label, plot.x + groupWidth * index, y + 10, 5, palette.muted, Math.max(25, groupWidth * labelEvery - 2));
    });
  }

  page.drawRectangle({ x: x + width - 130, y: y + height - 18, width: 6, height: 6, color: palette.blue });
  drawText(page, regular, 'Duty', x + width - 121, y + height - 18, 6, palette.muted, 35);
  page.drawRectangle({ x: x + width - 78, y: y + height - 18, width: 6, height: 6, color: palette.cyan });
  drawText(page, regular, 'Flight', x + width - 69, y + height - 18, 6, palette.muted, 38);
};

const drawRollingChart = (
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  palette: PdfPalette,
  points: DutyTrendPoint[],
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  drawChartFrame(page, bold, regular, palette, x, y, width, height, 'Rolling 7-day duty', 'Recorded duty against the 60-hour planning limit');
  const plot = { x: x + 32, y: y + 24, width: width - 45, height: height - 66 };
  const maxValue = Math.max(60, ...points.map(point => point.rolling7DutyHours));
  const axisMax = Math.ceil(maxValue / 10) * 10;

  for (let line = 0; line <= 3; line += 1) {
    const lineY = plot.y + (plot.height * line) / 3;
    page.drawLine({ start: { x: plot.x, y: lineY }, end: { x: plot.x + plot.width, y: lineY }, thickness: 0.35, color: palette.border });
    drawText(page, regular, ((axisMax * line) / 3).toFixed(0), x + 8, lineY - 2, 5.5, palette.muted, 20);
  }

  const limitY = plot.y + (60 / axisMax) * plot.height;
  page.drawLine({ start: { x: plot.x, y: limitY }, end: { x: plot.x + plot.width, y: limitY }, thickness: 1, color: palette.red, dashArray: [3, 2] });
  drawText(page, bold, '60 h', plot.x + plot.width - 25, limitY + 3, 5.5, palette.red, 24);

  if (points.length === 0) {
    drawText(page, regular, 'No recorded duty in this period', plot.x + 60, plot.y + plot.height / 2, 8, palette.muted, plot.width - 100);
  } else {
    const step = points.length === 1 ? 0 : plot.width / (points.length - 1);
    points.forEach((point, index) => {
      const pointX = plot.x + step * index;
      const pointY = plot.y + (point.rolling7DutyHours / axisMax) * plot.height;
      if (index > 0) {
        const previous = points[index - 1];
        page.drawLine({
          start: { x: plot.x + step * (index - 1), y: plot.y + (previous.rolling7DutyHours / axisMax) * plot.height },
          end: { x: pointX, y: pointY },
          thickness: 1.4,
          color: point.rolling7DutyHours > 60 || previous.rolling7DutyHours > 60 ? palette.red : palette.green,
        });
      }
      if (points.length < 22 || index % 2 === 0) {
        page.drawCircle({ x: pointX, y: pointY, size: 1.8, color: point.rolling7DutyHours > 60 ? palette.red : palette.green });
      }
    });
    const labelEvery = Math.max(1, Math.ceil(points.length / 7));
    points.forEach((point, index) => {
      if (index % labelEvery !== 0 && index !== points.length - 1) return;
      drawText(page, regular, point.label, plot.x + step * index - 2, y + 10, 5, palette.muted, Math.max(25, step * labelEvery - 2));
    });
  }
};

export const createDutyTimeReportPdf = async (input: DutyTimeReportPdfInput) => {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const palette: PdfPalette = {
    navy: rgb(0.024, 0.082, 0.184),
    blue: rgb(0.055, 0.353, 0.729),
    cyan: rgb(0.016, 0.659, 0.761),
    paleBlue: rgb(0.92, 0.957, 1),
    green: rgb(0.047, 0.55, 0.35),
    paleGreen: rgb(0.91, 0.98, 0.95),
    amber: rgb(0.85, 0.47, 0.02),
    paleAmber: rgb(1, 0.965, 0.86),
    red: rgb(0.82, 0.12, 0.12),
    ink: rgb(0.08, 0.11, 0.17),
    muted: rgb(0.34, 0.39, 0.47),
    border: rgb(0.82, 0.85, 0.89),
    panel: rgb(0.965, 0.973, 0.984),
    white: rgb(1, 1, 1),
  };
  const generatedAt = input.generatedAt ?? new Date();
  const summary = calculateDutyTimeSummary(input.duties, input.rows);
  const trend = buildDutyTrendSeries(input.rows);
  const attentionRows = input.rows.filter(row => row.status === 'attention');

  pdf.setTitle(`Duty time report - ${normalisePdfText(input.instructor.name)}`);
  pdf.setAuthor('Bendigo Flying Club CRM');
  pdf.setSubject('Duty time and fatigue management report');
  pdf.setCreationDate(generatedAt);

  const dashboard = pdf.addPage(PAGE_SIZE);
  dashboard.drawRectangle({ x: 0, y: PAGE_SIZE[1] - 76, width: PAGE_SIZE[0], height: 76, color: palette.navy });
  dashboard.drawRectangle({ x: 0, y: PAGE_SIZE[1] - 76, width: 8, height: 76, color: palette.cyan });
  drawText(dashboard, bold, 'BENDIGO FLYING CLUB', MARGIN, PAGE_SIZE[1] - 26, 8, palette.cyan, 220);
  drawText(dashboard, bold, 'Duty time report', MARGIN, PAGE_SIZE[1] - 49, 21, palette.white, 300);
  drawText(dashboard, bold, input.instructor.name, 475, PAGE_SIZE[1] - 30, 13, palette.white, 330);
  drawText(dashboard, regular, `${input.period.start} to ${input.period.end}`, 475, PAGE_SIZE[1] - 47, 8, palette.white, 330);
  drawText(dashboard, regular, `Generated ${formatGenerated(generatedAt)}`, 475, PAGE_SIZE[1] - 62, 7, palette.cyan, 330);

  const metricY = 440;
  const metricGap = 8;
  const metricWidth = (CONTENT_WIDTH - metricGap * 5) / 6;
  const metricData: Array<[string, string, string, RGB]> = [
    ['Duty periods', String(summary.periodCount), `${summary.activeDays} active days`, palette.blue],
    ['Total duty', formatHours(summary.totalDutyHours), 'All recorded duty', palette.blue],
    ['Flight / supervision', formatHours(summary.totalFlightHours), 'Not total duty time', palette.cyan],
    ['Average period', formatHours(summary.averageDutyHours), `Longest ${formatHours(summary.longestDutyHours)}`, palette.green],
    ['External duty', formatHours(summary.externalDutyHours), 'Declared outside CRM', palette.amber],
    ['Days to review', String(summary.attentionDays), summary.compliancePercent == null ? 'No active duty' : `${summary.compliancePercent}% clear days`, summary.attentionDays ? palette.amber : palette.green],
  ];
  metricData.forEach(([label, value, detail, accent], index) => {
    drawMetric(dashboard, regular, bold, palette, MARGIN + index * (metricWidth + metricGap), metricY, metricWidth, label, value, detail, accent);
  });

  const bannerY = 404;
  const hasAttention = summary.attentionDays > 0;
  dashboard.drawRectangle({
    x: MARGIN,
    y: bannerY,
    width: CONTENT_WIDTH,
    height: 27,
    color: hasAttention ? palette.paleAmber : palette.paleGreen,
    borderColor: hasAttention ? palette.amber : palette.green,
    borderWidth: 0.6,
  });
  drawText(dashboard, bold, hasAttention ? 'REVIEW REQUIRED' : 'NO RECORDED EXCEPTIONS', MARGIN + 11, bannerY + 16, 8, hasAttention ? palette.amber : palette.green, 130);
  drawText(
    dashboard,
    regular,
    hasAttention
      ? `${summary.attentionDays} active day${summary.attentionDays === 1 ? '' : 's'} triggered one or more planning checks. See the exception and daily review pages.`
      : 'No active day triggered the configured planning checks. Confirm all external and non-flying duty has been declared.',
    MARGIN + 150,
    bannerY + 10,
    7.5,
    palette.ink,
    CONTENT_WIDTH - 162,
  );

  const chartGap = 10;
  const chartWidth = (CONTENT_WIDTH - chartGap) / 2;
  drawDutyFlightChart(dashboard, regular, bold, palette, trend, MARGIN, 222, chartWidth, 170);
  drawRollingChart(dashboard, regular, bold, palette, trend, MARGIN + chartWidth + chartGap, 222, chartWidth, 170);

  drawSectionTitle(dashboard, bold, palette, 'Management notes', 'At-a-glance context for this export', 208);
  const notes = [
    `${input.duties.filter(duty => duty.breakCount > 0).length} duty period(s) include recorded breaks; ${input.duties.reduce((total, duty) => total + duty.breakCount, 0)} break record(s) in total.`,
    `Daily flight/supervision control: ${input.maxDailyFlightHours.toFixed(1)} h. Minimum rest control: ${input.minimumRestHours.toFixed(1)} h.`,
    attentionRows.length
      ? `Highest rolling 7-day duty: ${Math.max(...input.rows.map(row => row.rolling7DutyHours)).toFixed(1)} h. Open the exception register for the exact dates and reasons.`
      : 'The report is a planning aid. It cannot identify duty that was not entered into the portal.',
  ];
  notes.forEach((note, index) => {
    dashboard.drawCircle({ x: MARGIN + 5, y: 164 - index * 28, size: 2.2, color: index === 2 && attentionRows.length ? palette.amber : palette.blue });
    drawWrappedText(dashboard, regular, note, MARGIN + 14, 168 - index * 28, 7.5, palette.ink, CONTENT_WIDTH - 18, 10, 2);
  });
  dashboard.drawRectangle({ x: MARGIN, y: 39, width: CONTENT_WIDTH, height: 38, color: palette.panel });
  drawWrappedText(
    dashboard,
    regular,
    'Important: Duty hours are the elapsed duty period. Flight/supervision hours are a separate recorded value and are not used as a substitute for duty time. This report includes active and completed Duty records only.',
    MARGIN + 12,
    62,
    7,
    palette.muted,
    CONTENT_WIDTH - 24,
    9,
    3,
  );

  if (attentionRows.length > 0) {
    let page = pdf.addPage(PAGE_SIZE);
    let y = PAGE_SIZE[1] - 48;
    drawSectionTitle(page, bold, palette, 'Exception register', `${attentionRows.length} day(s) requiring review`, y);
    y -= 42;
    attentionRows.forEach(row => {
      const issueLines = row.issues.flatMap(issue => {
        const measure = (text: string) => regular.widthOfTextAtSize(text, 7.2);
        return wrapPdfText(issue, measure, CONTENT_WIDTH - 132);
      });
      const rowHeight = Math.max(35, 19 + issueLines.length * 9);
      if (y - rowHeight < 45) {
        page = pdf.addPage(PAGE_SIZE);
        y = PAGE_SIZE[1] - 48;
        drawSectionTitle(page, bold, palette, 'Exception register', 'Continued', y);
        y -= 42;
      }
      page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: palette.paleAmber, borderColor: palette.amber, borderWidth: 0.45 });
      drawText(page, bold, row.date, MARGIN + 10, y - 16, 8, palette.ink, 75);
      drawText(page, regular, `${formatTime(row.firstStart)} - ${formatTime(row.lastEnd)}`, MARGIN + 10, y - 29, 6.5, palette.muted, 90);
      issueLines.forEach((line, index) => drawText(page, regular, `- ${line}`, MARGIN + 116, y - 16 - index * 9, 7.2, palette.ink, CONTENT_WIDTH - 128));
      y -= rowHeight + 7;
    });
  }

  const activeRows = input.rows.filter(row => row.duties.length > 0);
  let dailyPage = pdf.addPage(PAGE_SIZE);
  let dailyY = PAGE_SIZE[1] - 48;
  const dailyColumns = [80, 84, 58, 58, 58, 58, 74, 299];
  const dailyHeaders = ['Date', 'Duty window', 'Duty', 'Flight', '7-day', '14-day', 'Rest before', 'Status / notes'];
  const drawDailyHeader = () => {
    drawSectionTitle(dailyPage, bold, palette, 'Daily duty review', activeRows.length ? `${activeRows.length} active day(s); off-duty dates omitted for readability` : 'No active duty days in this period', dailyY);
    dailyY -= 41;
    dailyPage.drawRectangle({ x: MARGIN, y: dailyY - 20, width: CONTENT_WIDTH, height: 20, color: palette.navy });
    let x = MARGIN;
    dailyHeaders.forEach((header, index) => {
      drawText(dailyPage, bold, header, x + 5, dailyY - 13, 6.5, palette.white, dailyColumns[index] - 10);
      x += dailyColumns[index];
    });
    dailyY -= 20;
  };
  drawDailyHeader();
  for (const row of activeRows) {
    const note = row.issues.length ? row.issues.join('; ') : 'No recorded-duty planning exception.';
    const noteMeasure = (text: string) => regular.widthOfTextAtSize(text, 6.4);
    const noteLines = wrapPdfText(note, noteMeasure, dailyColumns[7] - 10).slice(0, 3);
    const rowHeight = Math.max(24, 10 + noteLines.length * 8);
    if (dailyY - rowHeight < 42) {
      dailyPage = pdf.addPage(PAGE_SIZE);
      dailyY = PAGE_SIZE[1] - 48;
      drawDailyHeader();
    }
    dailyPage.drawRectangle({ x: MARGIN, y: dailyY - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: row.status === 'attention' ? palette.paleAmber : palette.white, borderColor: palette.border, borderWidth: 0.35 });
    const values = [
      row.date,
      `${formatTime(row.firstStart)}-${formatTime(row.lastEnd)}`,
      row.dutySpanHours.toFixed(1),
      row.bookedHours.toFixed(1),
      row.rolling7DutyHours.toFixed(1),
      row.rolling14DutyHours.toFixed(1),
      row.restBeforeHours == null ? '-' : row.restBeforeHours.toFixed(1),
    ];
    let x = MARGIN;
    values.forEach((value, index) => {
      drawText(dailyPage, index === 0 ? bold : regular, value, x + 5, dailyY - 15, 6.5, palette.ink, dailyColumns[index] - 10);
      x += dailyColumns[index];
    });
    noteLines.forEach((line, index) => drawText(dailyPage, regular, line, x + 5, dailyY - 11 - index * 8, 6.4, row.status === 'attention' ? palette.amber : palette.muted, dailyColumns[7] - 10));
    dailyY -= rowHeight;
  }

  let detailPage = pdf.addPage(PAGE_SIZE);
  let detailY = PAGE_SIZE[1] - 48;
  const detailColumns = [75, 60, 60, 65, 65, 190, 65, 65, 84];
  const detailHeaders = ['Date', 'Start', 'Finish', 'Duty', 'Flight', 'Location', 'External', 'Breaks', 'Status'];
  const drawDetailHeader = () => {
    drawSectionTitle(detailPage, bold, palette, 'Duty-period detail', `${input.duties.length} active or completed period(s)`, detailY);
    detailY -= 41;
    detailPage.drawRectangle({ x: MARGIN, y: detailY - 20, width: CONTENT_WIDTH, height: 20, color: palette.navy });
    let x = MARGIN;
    detailHeaders.forEach((header, index) => {
      drawText(detailPage, bold, header, x + 5, detailY - 13, 6.5, palette.white, detailColumns[index] - 10);
      x += detailColumns[index];
    });
    detailY -= 20;
  };
  drawDetailHeader();
  for (const duty of input.duties) {
    if (detailY - 25 < 42) {
      detailPage = pdf.addPage(PAGE_SIZE);
      detailY = PAGE_SIZE[1] - 48;
      drawDetailHeader();
    }
    detailPage.drawRectangle({ x: MARGIN, y: detailY - 25, width: CONTENT_WIDTH, height: 25, color: palette.white, borderColor: palette.border, borderWidth: 0.35 });
    const values = [
      duty.start.toLocaleDateString('en-AU'),
      formatTime(duty.start),
      formatTime(duty.end),
      duty.durationHours.toFixed(1),
      duty.flightHours.toFixed(1),
      duty.location,
      duty.isExternal ? 'Yes' : 'No',
      String(duty.breakCount),
      duty.status,
    ];
    let x = MARGIN;
    values.forEach((value, index) => {
      drawText(detailPage, index === 0 ? bold : regular, value, x + 5, detailY - 16, 6.5, palette.ink, detailColumns[index] - 10);
      x += detailColumns[index];
    });
    detailY -= 25;
  }

  const methodology = pdf.addPage(PAGE_SIZE);
  drawSectionTitle(methodology, bold, palette, 'How to read this report', 'Definitions, controls and limitations', PAGE_SIZE[1] - 48);
  const definitions = [
    ['Duty hours', 'Elapsed time from the start to the finish of a recorded duty period. This can include non-flying work and must not be replaced with flight time.'],
    ['Flight / supervision hours', 'The separately recorded flying or supervision component of duty. Used for the configured daily and rolling flight-time checks.'],
    ['Rolling 7 / 14-day duty', 'Total overlapping recorded duty in the preceding 7 or 14 calendar days, including the day displayed.'],
    ['Rest before', `Elapsed off-duty time since the previous recorded duty. The configured planning control in this report is ${input.minimumRestHours.toFixed(1)} hours.`],
    ['Daily FDP check', 'Compares the recorded daily duty span with the CASA CAO 48.1 Appendix 6 planning limit selected from the first duty start time.'],
    ['Data completeness', 'Only active and completed Duty records known to the portal are included. External, administrative and non-flying duty must be declared for the report to be complete.'],
  ];
  let methodY = PAGE_SIZE[1] - 105;
  definitions.forEach(([label, description], index) => {
    const boxHeight = 56;
    const x = index % 2 === 0 ? MARGIN : MARGIN + CONTENT_WIDTH / 2 + 5;
    if (index % 2 === 0 && index > 0) methodY -= boxHeight + 10;
    const width = CONTENT_WIDTH / 2 - 5;
    methodology.drawRectangle({ x, y: methodY - boxHeight, width, height: boxHeight, color: palette.panel, borderColor: palette.border, borderWidth: 0.5 });
    drawText(methodology, bold, label, x + 12, methodY - 17, 9, palette.navy, width - 24);
    drawWrappedText(methodology, regular, description, x + 12, methodY - 32, 7.2, palette.ink, width - 24, 9.5, 3);
  });
  methodY -= 86;
  methodology.drawRectangle({ x: MARGIN, y: 52, width: CONTENT_WIDTH, height: 118, color: palette.paleBlue, borderColor: palette.blue, borderWidth: 0.6 });
  drawText(methodology, bold, 'Recommended review workflow', MARGIN + 14, 149, 10, palette.navy, 250);
  const workflow = [
    '1. Confirm all duty periods, including external and non-flying work, are present.',
    '2. Review each amber exception against source records and operational context.',
    '3. Use the CSV export when record-level filtering or independent calculations are required.',
    '4. Retain the signed or reviewed report with the supporting duty records where required.',
  ];
  workflow.forEach((line, index) => drawText(methodology, regular, line, MARGIN + 14, 128 - index * 18, 7.5, palette.ink, CONTENT_WIDTH - 28));

  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: 27 }, end: { x: PAGE_SIZE[0] - MARGIN, y: 27 }, thickness: 0.4, color: palette.border });
    drawText(page, regular, 'Bendigo Flying Club CRM - Duty time report', MARGIN, 15, 6.5, palette.muted, 300);
    drawText(page, regular, `Page ${index + 1} of ${pages.length}`, PAGE_SIZE[0] - MARGIN - 70, 15, 6.5, palette.muted, 70);
  });

  return pdf.save();
};

export const downloadDutyTimeReportPdf = async (input: DutyTimeReportPdfInput) => {
  const bytes = await createDutyTimeReportPdf(input);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = dutyReportFilename(input.instructor.name, input.period.start, input.period.end, 'pdf');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
