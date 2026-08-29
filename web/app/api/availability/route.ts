import { isValidDate, queryAllVenues } from '@/lib/availability';
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  isValidTimeRange,
} from '@/lib/time-range';

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const date = searchParams.get('date');
  const startTime = searchParams.get('startTime') ?? DEFAULT_START_TIME;
  const endTime = searchParams.get('endTime') ?? DEFAULT_END_TIME;
  if (!isValidDate(date)) {
    return Response.json(
      { error: '日期无效，请使用 YYYY-MM-DD 格式' },
      { status: 400 },
    );
  }
  if (!isValidTimeRange(startTime, endTime)) {
    return Response.json(
      { error: '时间段无效，请使用 08:00–22:00 之间的半小时刻度' },
      { status: 400 },
    );
  }

  const result = await queryAllVenues(date, startTime, endTime);
  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
