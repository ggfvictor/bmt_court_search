'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react';

import {
  AvailabilityTimeline,
  TimelineSkeleton,
} from '@/components/availability-timeline';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AvailabilityResponse,
  VenueId,
  VenueResult,
} from '@/lib/availability';
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  getEndTimeOptions,
  getTimelineStartTime,
  isValidTimeRange,
  nextHalfHour,
  overlapsTimeRange,
  START_TIME_OPTIONS,
} from '@/lib/time-range';
import { VENUE_META, VENUE_ORDER } from '@/lib/venue-meta';

const QUICK_TIME_RANGES = [
  { label: '下午场', startTime: '15:00', endTime: '17:00' },
  { label: '晚间场', startTime: '18:00', endTime: '22:00' },
] as const;

const VENUE_BOOKING_LINKS: Record<VenueId, string> = {
  qingyu: '#小程序://青羽运动空间/TDcaYKVYvGAECjp',
  meizi: '#小程序://开拍丨羽毛球订场服务/yCJPgahMoKGDt3a',
  shihuan: '#小程序://智慧场馆/9dzrLBhokrgsc4j',
};

export default function Home() {
  const today = useMemo(() => chinaDate(new Date()), []);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activeVenues, setActiveVenues] = useState<Set<VenueId>>(
    () => new Set(VENUE_ORDER),
  );
  const initialQueryStarted = useRef(false);

  const query = useCallback(
    async (queryDate: string, queryStartTime: string, queryEndTime: string) => {
      setLoading(true);
      setPageError(null);
      try {
        const searchParams = new URLSearchParams({
          date: queryDate,
          startTime: queryStartTime,
          endTime: queryEndTime,
        });
        const response = await fetch(`/api/availability?${searchParams}`, {
          cache: 'no-store',
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isAvailabilityResponse(payload)) {
          const message =
            isRecord(payload) && typeof payload.error === 'string'
              ? payload.error
              : '';
          throw new Error(message || '查询失败，请稍后重试');
        }
        setData(payload);
      } catch (error) {
        setPageError(error instanceof Error ? error.message : '查询失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialQueryStarted.current) return;
    initialQueryStarted.current = true;
    void query(today, DEFAULT_START_TIME, DEFAULT_END_TIME);
  }, [query, today]);

  const endTimeOptions = useMemo(
    () => getEndTimeOptions(startTime),
    [startTime],
  );

  const results = useMemo(() => data?.results ?? [], [data]);
  const visibleBlocks = useMemo(
    () =>
      results.flatMap((result) =>
        activeVenues.has(result.id) ? result.blocks : [],
      ),
    [activeVenues, results],
  );
  const timelineStartTime = useMemo(() => {
    if (!data) return DEFAULT_START_TIME;
    return getTimelineStartTime(
      data.date,
      data.startTime,
      data.endTime,
      new Date(data.queriedAt),
    );
  }, [data]);
  const timelineBlocks = useMemo(() => {
    if (!data) return [];
    return visibleBlocks.filter((block) =>
      overlapsTimeRange(
        block.start,
        block.end,
        timelineStartTime,
        data.endTime,
      ),
    );
  }, [data, timelineStartTime, visibleBlocks]);
  const maxCourt = Math.max(
    1,
    ...results
      .filter((result) => activeVenues.has(result.id))
      .map((result) => result.courtCount),
  );
  const totalBlocks = results.reduce(
    (sum, result) =>
      sum + (activeVenues.has(result.id) ? result.blockCount : 0),
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
              <h1
                id="query-title"
                className="text-2xl font-semibold tracking-tight sm:text-[28px]"
              >
                选日期和时间，同时看三家空场
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                时间条件以 30
                分钟为一格；结果只显示与所选时间段有交集的可订场次。
              </p>
            </div>

            <form
              className="grid w-full grid-cols-2 items-end gap-2 sm:grid-cols-3 xl:w-auto xl:grid-cols-[152px_152px_152px_132px]"
              onSubmit={(event) => {
                event.preventDefault();
                void query(date, startTime, endTime);
              }}
            >
              <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="query-date"
                >
                  查询日期
                </label>
                <Input
                  id="query-date"
                  type="date"
                  min={today}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="query-date-input h-11 w-full min-w-0 max-w-full border-black/10 bg-white px-3 text-base shadow-none"
                />
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="query-start-time"
                >
                  开始时间
                </label>
                <Select
                  value={startTime}
                  onValueChange={(value) => {
                    if (!value) return;
                    setStartTime(value);
                    if (!isValidTimeRange(value, endTime)) {
                      setEndTime(nextHalfHour(value));
                    }
                  }}
                >
                  <SelectTrigger
                    id="query-start-time"
                    aria-label="开始时间"
                    className="h-11 w-full border-black/10 bg-white px-3 text-base shadow-none data-[size=default]:h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {START_TIME_OPTIONS.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="query-end-time"
                >
                  结束时间
                </label>
                <Select
                  value={endTime}
                  onValueChange={(value) => {
                    if (value) setEndTime(value);
                  }}
                >
                  <SelectTrigger
                    id="query-end-time"
                    aria-label="结束时间"
                    className="h-11 w-full border-black/10 bg-white px-3 text-base shadow-none data-[size=default]:h-11"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {endTimeOptions.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 mt-1 grid min-w-0 grid-cols-2 items-center gap-2 border-t border-black/6 pt-3 sm:col-span-3 xl:col-span-4 xl:row-start-2 xl:flex xl:justify-end">
                <span className="col-span-2 mr-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground xl:col-span-1">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  常用时间
                </span>
                {QUICK_TIME_RANGES.map((range) => {
                  const active =
                    startTime === range.startTime && endTime === range.endTime;

                  return (
                    <button
                      key={range.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setStartTime(range.startTime);
                        setEndTime(range.endTime);
                      }}
                      className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none xl:w-auto ${
                        active
                          ? 'border-[#8bcac2] bg-[#e7f5f2] text-[#087f73]'
                          : 'border-black/8 bg-[#f6f4ef] text-foreground/75 hover:border-[#8bcac2] hover:bg-[#eef8f6] hover:text-[#087f73]'
                      }`}
                    >
                      <span>{range.label}</span>
                      <span className="font-mono tabular-nums opacity-75">
                        {range.startTime}–{range.endTime}
                      </span>
                    </button>
                  );
                })}
              </div>

              <Button
                type="submit"
                disabled={
                  loading || !date || !isValidTimeRange(startTime, endTime)
                }
                className="col-span-2 h-11 min-w-0 rounded-xl bg-[#087f73] px-5 text-[15px] shadow-[0_7px_16px_rgb(8_127_115/18%)] hover:bg-[#066d63] sm:col-span-3 xl:col-span-1 xl:col-start-4 xl:row-start-1"
              >
                {loading ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
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
            <span className="mr-1 text-xs font-medium text-muted-foreground">
              显示场馆
            </span>
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
                    <span className="text-[11px] opacity-70">
                      {result.blockCount}
                    </span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <Clock3 className="size-3.5" />
              {data
                ? `${formatDisplayDate(data.date)} · ${data.startTime}–${data.endTime} · ${totalBlocks} 个可订时段`
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

        <section
          aria-label="场馆查询状态"
          className="grid gap-3 md:grid-cols-3"
        >
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

        <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
          <section className="overflow-hidden rounded-2xl border border-black/7 bg-white shadow-[0_16px_42px_rgb(56_48_36/7%)]">
            <div className="flex flex-col gap-3 bg-[#fcfbf8] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h2 className="font-semibold tracking-tight">时间 × 场号</h2>
                <p className="text-xs text-muted-foreground">
                  每个场号仅占一条窄列；场馆与每小时价格以横线分隔，高度代表时长。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {data && (
                  <div className="mr-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                    {timelineStartTime !== data.startTime && (
                      <span className="font-medium text-[#087f73]">
                        今天从 {timelineStartTime} 起显示
                      </span>
                    )}
                    <span className="tabular-nums">
                      更新于 {formatQueryTime(data.queriedAt)}
                    </span>
                  </div>
                )}
                <CollapsibleTrigger className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#087f73]/25 bg-white px-3 text-sm font-medium text-[#087f73] transition hover:bg-[#e8f7f4] focus-visible:ring-3 focus-visible:ring-[#087f73]/20 focus-visible:outline-none">
                  {timelineOpen ? '收起表格' : '展开表格'}
                  <ChevronDown
                    className={`size-4 transition-transform ${timelineOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </CollapsibleTrigger>
              </div>
            </div>

            <CollapsibleContent className="border-t border-black/6">
              {loading && !data ? (
                <TimelineSkeleton />
              ) : data ? (
                <AvailabilityTimeline
                  blocks={timelineBlocks}
                  courtCount={maxCourt}
                  startTime={timelineStartTime}
                  endTime={data.endTime}
                />
              ) : (
                <div className="grid min-h-[360px] place-items-center px-6 text-center">
                  <div>
                    <Search className="mx-auto mb-3 size-7 text-muted-foreground/60" />
                    <p className="font-medium">选择日期后查询</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      三家场馆会同时返回结果。
                    </p>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </section>
        </Collapsible>
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
  const [bookingStatus, setBookingStatus] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');

  const handleBooking = () => {
    const copyPromise = copyText(VENUE_BOOKING_LINKS[venueId]);
    try {
      window.location.assign('weixin://');
    } catch {
      // The copied link remains available when the browser blocks app schemes.
    }
    void copyPromise.then((copied) => {
      setBookingStatus(copied ? 'copied' : 'failed');
    });
  };

  return (
    <Card
      size="sm"
      className="gap-3 border-0 bg-white py-3 shadow-[0_8px_22px_rgb(56_48_36/5%)] ring-black/6 transition"
      style={{ opacity: active ? 1 : 0.55 }}
    >
      <CardHeader className="gap-0.5 px-4">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <span
            className="size-2.5 rounded-full"
            style={{ background: meta.color }}
          />
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
      <CardContent className="space-y-3 px-4">
        <div className="flex items-end justify-between">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">
            {result?.status === 'ok' ? result.blockCount : '—'}
          </span>
          <span className="pb-0.5 text-xs text-muted-foreground">可订时段</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-[#087f73]/25 text-[#087f73] hover:bg-[#e8f7f4] hover:text-[#066d63]"
          onClick={handleBooking}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          去订场
        </Button>
        <p
          className={`min-h-4 text-center text-[11px] ${
            bookingStatus === 'failed'
              ? 'text-red-600'
              : bookingStatus === 'copied'
                ? 'text-[#087f73]'
                : 'text-muted-foreground'
          }`}
          aria-live="polite"
        >
          {bookingStatus === 'copied'
            ? '链接已复制，请在微信中粘贴后打开'
            : bookingStatus === 'failed'
              ? '复制失败，请长按或稍后重试'
              : '将复制小程序链接并尝试打开微信'}
        </p>
      </CardContent>
    </Card>
  );
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || !window.isSecureContext) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
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
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
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
  if (
    !isRecord(value) ||
    typeof value.date !== 'string' ||
    typeof value.startTime !== 'string' ||
    typeof value.endTime !== 'string' ||
    typeof value.queriedAt !== 'string' ||
    !Array.isArray(value.results)
  ) {
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
