export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      status: 'ok',
      service: 'badminton-availability',
      build: process.env.APP_BUILD_REVISION ?? 'local',
      time: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
