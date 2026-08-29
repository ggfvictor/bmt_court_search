import {
  minutesToTime,
  overlapsTimeRange,
  timeToMinutes,
} from '@/lib/time-range';

export type VenueId = 'qingyu' | 'meizi' | 'shihuan';

export type BookingMode = 'hourly' | 'fixed';

export type AvailabilityBlock = {
  venueId: VenueId;
  venueName: string;
  court: string;
  courtNumber: number;
  start: string;
  end: string;
  hourlyPrice: number | null;
  totalPrice: number | null;
  bookingMode: BookingMode;
};

export type VenueResult = {
  id: VenueId;
  name: string;
  status: 'ok' | 'error';
  courtCount: number;
  blockCount: number;
  blocks: AvailabilityBlock[];
  error?: string;
};

export type AvailabilityResponse = {
  date: string;
  startTime: string;
  endTime: string;
  queriedAt: string;
  results: VenueResult[];
};

type AdapterResult = {
  courtCount: number;
  blocks: AvailabilityBlock[];
};

const VENUES: Array<{
  id: VenueId;
  name: string;
  query: (date: string) => Promise<AdapterResult>;
}> = [
  { id: 'qingyu', name: '青羽', query: queryQingyu },
  { id: 'meizi', name: '梅子', query: queryMeizi },
  { id: 'shihuan', name: '十环', query: queryShihuan },
];

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const REQUEST_TIMEOUT_MS = 15_000;

export function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatShanghaiDate(parsed) === value;
}

export async function queryAllVenues(
  date: string,
  startTime: string,
  endTime: string,
): Promise<AvailabilityResponse> {
  const settled = await Promise.allSettled(
    VENUES.map(async (venue): Promise<VenueResult> => {
      const { blocks: allBlocks, courtCount } = await venue.query(date);
      const blocks = allBlocks.filter((block) =>
        overlapsTimeRange(block.start, block.end, startTime, endTime),
      );
      return {
        id: venue.id,
        name: venue.name,
        status: 'ok',
        courtCount,
        blockCount: blocks.length,
        blocks,
      };
    }),
  );

  const results = settled.map((result, index): VenueResult => {
    const venue = VENUES[index];
    if (result.status === 'fulfilled') return result.value;
    return {
      id: venue.id,
      name: venue.name,
      status: 'error',
      courtCount: 0,
      blockCount: 0,
      blocks: [],
      error: readableError(result.reason),
    };
  });

  return {
    date,
    startTime,
    endTime,
    queriedAt: new Date().toISOString(),
    results,
  };
}

async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 180);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)) throw new Error('服务器返回格式不正确');
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('查询超时');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function queryQingyu(date: string): Promise<AdapterResult> {
  const payload = await requestJson(
    'https://room.yunvip123.cn/prod-api/room/smallProgram/bookingBoard',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Merchant-Id': '477064449329168',
      },
      body: JSON.stringify({
        date,
        deskTypeId: '480416004035600',
        shopId: '477064449329168',
        shopName: '青羽',
      }),
    },
  );

  if (payload.errno !== 200) {
    throw new Error(messageFrom(payload.errmsg, '青羽接口查询失败'));
  }
  const data = isRecord(payload.data) ? payload.data : null;
  const groups = data && Array.isArray(data.itemArr) ? data.itemArr : null;
  if (!groups) throw new Error('青羽场地数据格式已变化');

  const desks = data && Array.isArray(data.deskArr) ? data.deskArr : [];
  const blocks: AvailabilityBlock[] = [];
  for (const group of groups) {
    const items = Array.isArray(group) ? group : [group];
    for (const raw of items) {
      if (!isRecord(raw) || raw.status !== 0) continue;
      const court = asString(raw.deskName);
      const start = asString(raw.businessBegins);
      const end = asString(raw.businessEnds);
      if (!court || !start || !end || hasStarted(date, start)) continue;
      const price = asNumber(raw.money);
      blocks.push({
        venueId: 'qingyu',
        venueName: '青羽',
        court,
        courtNumber: extractCourtNumber(court),
        start,
        end,
        hourlyPrice: price,
        totalPrice: price === null ? null : price * durationHours(start, end),
        bookingMode: 'hourly',
      });
    }
  }

  return {
    courtCount: desks.length || maxCourtNumber(blocks),
    blocks: mergeQingyuHours(blocks),
  };
}

async function queryMeizi(date: string): Promise<AdapterResult> {
  const weekday = String(isoWeekday(date)).padStart(2, '0');
  const url = new URL('https://api.like-sports.cn:8008/api-c/venue/field');
  url.searchParams.set('detailId', '279');
  url.searchParams.set('matchId', '60');
  url.searchParams.set('weekNo', weekday);
  url.searchParams.set('date', date);

  const payload = await requestJson(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      sourceType: 'wx',
    },
  });
  const courts = unwrapMeiziCourts(payload);
  const blocks: AvailabilityBlock[] = [];

  for (const court of courts) {
    const courtName = asString(court.fieldName);
    const viewBlocks = Array.isArray(court.viewBlocks) ? court.viewBlocks : [];
    const locks = isRecord(court.locks) ? court.locks : {};
    if (!courtName) continue;
    for (const raw of viewBlocks) {
      if (!isRecord(raw)) continue;
      const code = asString(raw.code);
      const startMinutes = asNumber(raw.startTime);
      const endMinutes = asNumber(raw.endTime);
      if (
        !code ||
        code in locks ||
        startMinutes === null ||
        endMinutes === null
      ) {
        continue;
      }
      const start = minutesToTime(startMinutes);
      const end = minutesToTime(endMinutes);
      if (hasStarted(date, start)) continue;
      const cents = asNumber(raw.amount);
      const totalPrice = cents === null ? null : cents / 100;
      const hours = (endMinutes - startMinutes) / 60;
      blocks.push({
        venueId: 'meizi',
        venueName: '梅子',
        court: courtName,
        courtNumber: extractCourtNumber(courtName),
        start,
        end,
        hourlyPrice:
          totalPrice === null || hours <= 0 ? null : totalPrice / hours,
        totalPrice,
        bookingMode: 'fixed',
      });
    }
  }

  return { courtCount: courts.length, blocks: sortBlocks(blocks) };
}

async function queryShihuan(date: string): Promise<AdapterResult> {
  const payload = await requestJson(
    'https://fdsaas.hulasports.com/api/orderlists/get/book',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderDateNum: new Date(`${date}T00:00:00+08:00`).getTime(),
        _venue: '65289508c73b5c1db29bb137',
        _item: '62947fdc6267fd52ab099a3e',
        passBaseOn: 'start',
        showLine: 'row',
        showPassTime: false,
        _org: '5de4af96c87e5e70532e3a44',
        delayMins: 150,
      }),
    },
  );

  if (payload.code !== 200) {
    throw new Error(
      messageFrom(
        payload.data,
        messageFrom(payload.message, '十环接口查询失败'),
      ),
    );
  }
  const data = isRecord(payload.data) ? payload.data : null;
  const rows =
    data && Array.isArray(data.booking_array) ? data.booking_array : null;
  if (!rows) throw new Error('十环场地数据格式已变化');

  const fieldSlot =
    data && Array.isArray(data.field_slot) ? data.field_slot : [];
  const blocks: AvailabilityBlock[] = [];
  for (const row of rows) {
    if (!isRecord(row) || !Array.isArray(row.booking_infos)) continue;
    for (const raw of row.booking_infos) {
      if (!isRecord(raw) || !isRecord(raw.state)) continue;
      if (raw.state.no !== 0 || raw.state.state !== '可预订') continue;
      const court = asString(raw.fieldName);
      const start = asString(raw.showStartTime);
      const end = asString(raw.showEndTime);
      if (!court || !start || !end || hasStarted(date, start)) continue;
      blocks.push({
        venueId: 'shihuan',
        venueName: '十环',
        court,
        courtNumber: extractCourtNumber(court),
        start,
        end,
        hourlyPrice: asNumber(raw.price),
        totalPrice: asNumber(raw.total),
        bookingMode: 'fixed',
      });
    }
  }

  return {
    courtCount: fieldSlot.length || maxCourtNumber(blocks),
    blocks: sortBlocks(blocks),
  };
}

function unwrapMeiziCourts(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  let current = payload;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current.code !== 200) {
      throw new Error(messageFrom(current.message, '梅子接口查询失败'));
    }
    const response = current.response;
    if (!Array.isArray(response)) throw new Error('梅子场地数据格式已变化');
    if (
      response.every(
        (item) => isRecord(item) && 'fieldName' in item && 'viewBlocks' in item,
      )
    ) {
      return response as Record<string, unknown>[];
    }
    if (response.length === 1 && isRecord(response[0])) {
      current = response[0];
      continue;
    }
    if (response.length === 0) return [];
    throw new Error('无法识别梅子场地数据');
  }
  throw new Error('梅子响应嵌套层数异常');
}

function mergeQingyuHours(blocks: AvailabilityBlock[]): AvailabilityBlock[] {
  const sorted = [...blocks].sort(
    (a, b) =>
      a.courtNumber - b.courtNumber ||
      timeToMinutes(a.start) - timeToMinutes(b.start),
  );
  const merged: AvailabilityBlock[] = [];
  for (const block of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.courtNumber === block.courtNumber &&
      previous.end === block.start &&
      previous.hourlyPrice === block.hourlyPrice
    ) {
      previous.end = block.end;
      previous.totalPrice =
        previous.hourlyPrice === null
          ? null
          : previous.hourlyPrice * durationHours(previous.start, block.end);
    } else {
      merged.push({ ...block });
    }
  }
  return sortBlocks(merged);
}

function sortBlocks(blocks: AvailabilityBlock[]): AvailabilityBlock[] {
  return [...blocks].sort(
    (a, b) =>
      a.courtNumber - b.courtNumber ||
      timeToMinutes(a.start) - timeToMinutes(b.start),
  );
}

function hasStarted(date: string, start: string): boolean {
  const now = new Date();
  const today = formatShanghaiDate(now);
  if (date < today) return true;
  if (date > today) return false;
  return timeToMinutes(start) <= shanghaiMinutes(now);
}

function formatShanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shanghaiMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return Number(values.hour) * 60 + Number(values.minute);
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return day === 0 ? 7 : day;
}

function durationHours(start: string, end: string): number {
  return (timeToMinutes(end) - timeToMinutes(start)) / 60;
}

function extractCourtNumber(value: string): number {
  const matched = value.match(/\d+/);
  return matched ? Number(matched[0]) : 0;
}

function maxCourtNumber(blocks: AvailabilityBlock[]): number {
  return blocks.reduce(
    (maximum, block) => Math.max(maximum, block.courtNumber),
    0,
  );
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readableError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return '查询失败';
}

function messageFrom(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
