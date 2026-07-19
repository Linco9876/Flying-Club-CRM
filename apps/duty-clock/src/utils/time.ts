export const formatClockTime = (value: Date | string) => new Intl.DateTimeFormat('en-AU', {
  hour: 'numeric',
  minute: '2-digit',
}).format(typeof value === 'string' ? new Date(value) : value);

export const formatDateTime = (value: Date | string) => new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
}).format(typeof value === 'string' ? new Date(value) : value);

export const formatDuration = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
};

export const hoursFromMinutes = (minutes: number) => (minutes / 60)
  .toFixed(2)
  .replace(/\.00$/, '')
  .replace(/(\.\d)0$/, '$1');

export const minutesFromHours = (value: string) => Math.max(0, Math.round((Number(value) || 0) * 60));
