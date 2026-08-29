export const HALF_HOUR_MINUTES = 30;
export const DEFAULT_START_TIME = '08:00';
export const DEFAULT_END_TIME = '22:00';

const DEFAULT_START_MINUTES = timeToMinutes(DEFAULT_START_TIME);
const DEFAULT_END_MINUTES = timeToMinutes(DEFAULT_END_TIME);

export const START_TIME_OPTIONS = createTimeOptions(
  DEFAULT_START_MINUTES,
  DEFAULT_END_MINUTES - HALF_HOUR_MINUTES,
);

export function getEndTimeOptions(startTime: string): string[] {
  const startMinutes = timeToMinutes(startTime);
  if (!isHalfHourTime(startTime) || startMinutes >= DEFAULT_END_MINUTES) {
    return [DEFAULT_END_TIME];
  }
  return createTimeOptions(
    startMinutes + HALF_HOUR_MINUTES,
    DEFAULT_END_MINUTES,
  );
}

export function nextHalfHour(startTime: string): string {
  const next = Math.min(
    timeToMinutes(startTime) + HALF_HOUR_MINUTES,
    DEFAULT_END_MINUTES,
  );
  return minutesToTime(next);
}

export function isValidTimeRange(startTime: string, endTime: string): boolean {
  if (!isHalfHourTime(startTime) || !isHalfHourTime(endTime)) return false;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return (
    start >= DEFAULT_START_MINUTES && end <= DEFAULT_END_MINUTES && start < end
  );
}

export function overlapsTimeRange(
  blockStart: string,
  blockEnd: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return (
    timeToMinutes(blockEnd) > timeToMinutes(rangeStart) &&
    timeToMinutes(blockStart) < timeToMinutes(rangeEnd)
  );
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function minutesToTime(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function isHalfHourTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && (minute === 0 || minute === 30);
}

function createTimeOptions(start: number, end: number): string[] {
  const options: string[] = [];
  for (let value = start; value <= end; value += HALF_HOUR_MINUTES) {
    options.push(minutesToTime(value));
  }
  return options;
}
