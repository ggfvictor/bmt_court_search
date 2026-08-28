'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';

import { AvailabilityTimeline, TimelineSkeleton } from '@/components/availability-timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { AvailabilityResponse, VenueId, VenueResult } from '@/lib/availability';
import { VENUE_META, VENUE_ORDER } from '@/lib/venue-meta';

export default function Home() {
  const today = useMemo(() => chinaDate(new Date()), []);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [activeVenues, setActiveVenues] = useState<Set<VenueId>>(
    () => new Set(VENUE_ORDER),
  );
  const initialQueryStarted = useRef(false);

  const query = useCallback(async (queryDate: string) => {
    setLoading(true);
    setPageError(null);
    try {
      const response = await fetch(
        `/api/availability?date=${encodeURIComponent(queryDate)}`,
        { cache: 'no-store' },
      );
      const payload: unknown = await response.json();
      if (!response.ok || !isAvailabilityResponse(payload)) {
        const message =
          isRecord(payload) && typeof payload.error === 'string' ? payload.error : '';
        throw new Error(message || '查询失败，请稍后重试');
      }
      setData(payload);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQueryStarted.current) return;
    initialQueryStarted.current = true;
    void query(today);
  }, [query, today]);

  const results = useMemo(() => data?.results ?? [], [data]);
  const visibleBlocks = useMemo(
    () =>
      results.flatMap((result) =>
        activeVenues.has(result.id) ? result.blocks : [],
      ),
    [activeVenues, results],
  );
  const maxCourt = Math.max(
    1,
    ...results
      .filter((result) => activeVenues.has(result.id))
      .map((result) => result.courtCount),
  );
  const totalBlocks = results.reduce(
    (sum, result) => sum + (activeVenues.has(result.id) ? result.blockCount : 0),
    0,
  );

  const toggleVenue = (venueId: VenueId) => {
    setActiveVenues((current) => {
      const next = new Set(current);
      if (next.has(venueId)) {
        if (next.size > 1) next.delete(venueId);
      } else {
        next.add(venueId);
      }
      return next;
    });
  };

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-black/5 bg-[#123d3a] text-white shadow-[0_8px_28px_rgb(18_61_58/12%)]">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between gap-5 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/12 ring-1 ring-white/15">
              <CalendarDays className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold tracking-[-0.02em] sm:text-xl">
                羽毛球空场
              </p>
              <p className="truncate text-xs text-white/62">
                青羽 · 梅子 · 十环聚合查询
              </p>
            </div>
          </div>
          <Badge className="hidden h-7 border border-white/15 bg-white/10 px-3 text-white sm:inline-flex">
            30 分钟时间轴
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-[1560px] space-y-5 px-4 pt-5 sm:px-7 lg:px-10">
        <section
          aria-labelledby="query-title"
          className="rounded-2xl border border-black/6 bg-white/84 p-4 shadow-[0_12px_30px_rgb(56_48_36/6%)] backdrop-blur sm:p-5"
        >
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold tracking-[0.12em] text-[#087f73] uppercase">
                Availability board
              </p>
              <h1 id="query-title" className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                选一天，同时看三家空场
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                横轴是时间，纵轴是场号；颜色代表场馆，方块宽度代表真实场次时长。
              </p>
            </div>

            <form
              className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto"
              onSubmit={(event) => {
                event.preventDefault();
                void query(date);
              }}
            >
              <label className="sr-only" htmlFor="query-date">查询日期</label>
              <Input
                id="query-date"
                type="date"
                min={today}
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-11 min-w-[190px] border-black/10 bg-white px-3 text-base shadow-none sm:w-[205px]"
              />
              <Button
                type="submit"
                disabled={loading || !date}
                className="h-11 min-w-[132px] rounded-xl bg-[#087f73] px-5 text-[15px] shadow-[0_7px_16px_rgb(8_127_115/18%)] hover:bg-[#066d63]"
              >
                {loading ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : data ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <Search data-icon="inline-start" />
                )}
                {loading ? '查询中' : data ? '重新查询' : '查询三馆'}
              </Button>
            </form>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/6 pt-4">
            <span className="mr-1 text-xs font-medium text-muted-foreground">显示场馆</span>
            {VENUE_ORDER.map((venueId) => {
              const meta = VENUE_META[venueId];
              const active = activeVenues.has(venueId);
              const result = results.find((item) => item.id === venueId);
              return (
                <button
                  key={venueId}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleVenue(venueId)}
                  className="inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm font-medium transition hover:-translate-y-px focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                  style={{
                    color: active ? meta.color : '#77736b',
                    borderColor: active ? meta.border : '#dedbd4',
                    background: active ? meta.soft : '#f5f3ef',
                    opacity: active ? 1 : 0.66,
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: active ? meta.color : '#aaa59b' }}
                  />
                  {meta.name}
                  {result?.status === 'ok' && (
                    <span className="text-[11px] opacity-70">{result.blockCount}</span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <Clock3 className="size-3.5" />
              {data
                ? `${formatDisplayDate(data.date)} · ${totalBlocks} 个可订时段`
                : '等待查询'}
            </span>
          </div>
        </section>

        {pageError && (
          <div
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <CircleAlert className="size-4 shrink-0" />
            {pageError}
          </div>
        )}

        <section aria-label="场馆查询状态" className="grid gap-3 md:grid-cols-3">
          {loading && !data
            ? VENUE_ORDER.map((venue) => <StatusSkeleton key={venue} />)
            : VENUE_ORDER.map((venueId) => (
                <VenueStatusCard
                  key={venueId}
                  venueId={venueId}
                  result={results.find((item) => item.id === venueId)}
                  active={activeVenues.has(venueId)}
                />
              ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-black/7 bg-white shadow-[0_16px_42px_rgb(56_48_36/7%)]">
          <div className="flex flex-col gap-2 border-b border-black/6 bg-[#fcfbf8] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="font-semibold tracking-tight">场号 × 时间</h2>
              <p className="text-xs text-muted-foreground">
                方块内为“场馆 / 每小时价格”，悬停可看本场合计。
              </p>
            </div>
            {data && (
              <span className="text-xs tabular-nums text-muted-foreground">
                更新于 {formatQueryTime(data.queriedAt)}
              </span>
            )}
          </div>

          {loading && !data ? (
            <TimelineSkeleton />
          ) : data ? (
            <AvailabilityTimeline blocks={visibleBlocks} courtCount={maxCourt} />
          ) : (
            <div className="grid min-h-[360px] place-items-center px-6 text-center">
              <div>
                <Search className="mx-auto mb-3 size-7 text-muted-foreground/60" />
                <p className="font-medium">选择日期后查询</p>
                <p className="mt-1 text-sm text-muted-foreground">三家场馆会同时返回结果。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function VenueStatusCard({
  venueId,
  result,
  active,
}: {
  venueId: VenueId;
  result?: VenueResult;
  active: boolean;
}) {
  const meta = VENUE_META[venueId];
  const isError = result?.status === 'error';
  return (
    <Card
      size="sm"
      className="gap-3 border-0 bg-white py-3 shadow-[0_8px_22px_rgb(56_48_36/5%)] ring-black/6 transition"
      style={{ opacity: active ? 1 : 0.55 }}
    >
      <CardHeader className="gap-0.5 px-4">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <span className="size-2.5 rounded-full" style={{ background: meta.color }} />
          {meta.name}
        </CardTitle>
        <CardDescription className="line-clamp-1 text-xs">
          {isError
            ? result.error || '查询失败'
            : result
              ? `${result.courtCount} 块场地`
              : '等待查询'}
        </CardDescription>
        <CardAction>
          {isError ? (
            <CircleAlert className="size-4 text-red-500" />
          ) : result ? (
            <CheckCircle2 className="size-4 text-[#087f73]" />
          ) : (
            <Clock3 className="size-4 text-muted-foreground" />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-end justify-between px-4">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">
          {result?.status === 'ok' ? result.blockCount : '—'}
        </span>
        <span className="pb-0.5 text-xs text-muted-foreground">可订时段</span>
      </CardContent>
    </Card>
  );
}

function StatusSkeleton() {
  return (
    <Card size="sm" className="gap-3 border-0 bg-white py-3 ring-black/6">
      <CardHeader className="px-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-14" />
      </CardHeader>
      <CardContent className="px-4">
        <Skeleton className="h-7 w-10" />
      </CardContent>
    </Card>
  );
}

function chinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDisplayDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(`${value}T12:00:00+08:00`));
}

function formatQueryTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  if (!isRecord(value) || typeof value.date !== 'string' || !Array.isArray(value.results)) {
    return false;
  }
  return value.results.every(
    (result) =>
      isRecord(result) &&
      typeof result.id === 'string' &&
      typeof result.name === 'string' &&
      Array.isArray(result.blocks),
  );
}
