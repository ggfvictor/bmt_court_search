import { isValidDate, queryAllVenues } from '@/lib/availability';

export async function GET(request: Request): Promise<Response> {
  const date = new URL(request.url).searchParams.get('date');
  if (!isValidDate(date)) {
    return Response.json(
      { error: '日期无效，请使用 YYYY-MM-DD 格式' },
      { status: 400 },
    );
  }

  const result = await queryAllVenues(date);
  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
