import { Search } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import type { AvailabilityBlock } from '@/lib/availability';
import { VENUE_META, VENUE_ORDER } from '@/lib/venue-meta';

const START_MINUTES = 8 * 60;
const END_MINUTES = 22 * 60;
const SLOT_MINUTES = 30;
const TIME_AXIS_WIDTH = 72;
const COURT_WIDTH = 64;
const HEADER_HEIGHT = 52;
const TIME_ROW_HEIGHT = 44;
const TOTAL_ROWS = (END_MINUTES - START_MINUTES) / SLOT_MINUTES;
const TIMELINE_HEIGHT = TOTAL_ROWS * TIME_ROW_HEIGHT;

export function AvailabilityTimeline({
  blocks,
  courtCount,
}: {
  blocks: AvailabilityBlock[];
  courtCount: number;
}) {
  const courts = Array.from({ length: courtCount }, (_, index) => index + 1);
  const timeSlots = Array.from({ length: TOTAL_ROWS + 1 }, (_, index) => {
    return minutesToTime(START_MINUTES + index * SLOT_MINUTES);
  });
  const gridTemplateColumns = `${TIME_AXIS_WIDTH}px repeat(${courtCount}, ${COURT_WIDTH}px)`;
  const totalWidth = TIME_AXIS_WIDTH + courtCount * COURT_WIDTH;

  if (blocks.length === 0) {
    return (
      <div className="grid min-h-[340px] place-items-center px-6 text-center">
        <div>
          <Search className="mx-auto mb-3 size-7 text-muted-foreground/55" />
          <p className="font-medium">当前筛选下没有可订时段</p>
          <p className="mt-1 text-sm text-muted-foreground">
            可以切换场馆，或选择其他日期。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-scroll max-h-[72vh] overflow-auto">
      <div className="min-w-full" style={{ width: totalWidth }}>
        <div
          className="sticky top-0 z-30 grid border-b border-black/7 bg-[#f8f6f1] shadow-[0_5px_14px_rgb(55_48_38/5%)]"
          style={{ gridTemplateColumns, height: HEADER_HEIGHT }}
        >
          <div
            className="sticky left-0 z-50 border-r-2 border-[#d3cec4] bg-[#f2efe8]"
            aria-label="纵轴为时间，横轴为场号"
          >
            <span className="absolute top-1 right-1.5 text-[11px] font-bold text-foreground/90">
              场号
            </span>
            <span className="absolute bottom-1 left-1.5 text-[11px] font-bold text-foreground/90">
              时间
            </span>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 h-px w-[89px] origin-top-left rotate-[35.8deg] bg-[#c5bfb4]"
            />
          </div>

          {courts.map((courtNumber) => (
            <div
              key={courtNumber}
              className="flex items-center justify-center border-r-2 border-[#d3cec4] bg-[#f8f6f1]"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {String(courtNumber).padStart(2, '0')}
              </span>
              <span className="ml-1 text-sm font-semibold">号场</span>
            </div>
          ))}
        </div>

        <div
          className="grid"
          style={{ gridTemplateColumns, height: TIMELINE_HEIGHT }}
        >
          <div className="matrix-time-axis sticky left-0 z-20 border-r-2 border-[#d3cec4] bg-[#fcfbf8] shadow-[6px_0_12px_rgb(55_48_38/3%)]">
            {timeSlots.map((time, index) => {
              const isFirst = index === 0;
              const isLast = index === timeSlots.length - 1;
              const isWholeHour = time.endsWith(':00');
              return (
                <span
                  key={time}
                  className={`absolute right-0 z-10 flex h-5 w-full items-center justify-end pr-2 font-mono tabular-nums ${
                    isWholeHour
                      ? 'text-[11px] font-semibold text-foreground/70'
                      : 'text-[10px] font-medium text-muted-foreground/80'
                  }`}
                  style={{
                    top: index * TIME_ROW_HEIGHT,
                    transform: isFirst
                      ? 'translateY(0)'
                      : isLast
                        ? 'translateY(-100%)'
                        : 'translateY(-50%)',
                  }}
                >
                  <span className="bg-[#fcfbf8] px-0.5">{time}</span>
                  <span
                    aria-hidden="true"
                    className="absolute right-0 h-px w-1.5 bg-[#aaa397]"
                  />
                </span>
              );
            })}
          </div>

          {courts.map((courtNumber) => {
            const courtBlocks = blocks.filter(
              (block) => block.courtNumber === courtNumber,
            );
            const positionedBlocks = positionOverlappingBlocks(courtBlocks);
            return (
              <div
                key={courtNumber}
                className="matrix-time-grid relative border-r-2 border-[#d3cec4] bg-white"
                style={{ height: TIMELINE_HEIGHT }}
              >
                {positionedBlocks.map(
                  ({ block, lane, laneCount }, blockIndex) => (
                    <TimelineBlock
                      key={`${block.venueId}-${block.start}-${block.end}-${blockIndex}`}
                      block={block}
                      lane={lane}
                      laneCount={laneCount}
                    />
                  ),
                )}
                {courtBlocks.length === 0 && (
                  <span className="absolute inset-x-0 top-6 text-center text-xs text-muted-foreground/45">
                    暂无空场
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TimelineBlock({
  block,
  lane,
  laneCount,
}: {
  block: AvailabilityBlock;
  lane: number;
  laneCount: number;
}) {
  const meta = VENUE_META[block.venueId];
  const start = Math.max(START_MINUTES, timeToMinutes(block.start));
  const end = Math.min(END_MINUTES, timeToMinutes(block.end));
  const top = ((start - START_MINUTES) / SLOT_MINUTES) * TIME_ROW_HEIGHT;
  const height = ((end - start) / SLOT_MINUTES) * TIME_ROW_HEIGHT;
  const laneWidth = 100 / laneCount;
  const blockWidth = laneCount === 1 ? 26 : laneCount === 2 ? 24 : 20;
  const compactPrice =
    block.hourlyPrice === null ? '?' : money(block.hourlyPrice);
  const details = [
    `${block.venueName} · ${block.court}`,
    `${block.start}–${block.end}`,
    block.hourlyPrice === null ? null : `¥${money(block.hourlyPrice)}/小时`,
    block.totalPrice === null ? null : `本场合计 ¥${money(block.totalPrice)}`,
    block.bookingMode === 'hourly' ? '可按小时预订' : '固定场次',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      type="button"
      title={details}
      aria-label={details.replaceAll('\n', '，')}
      className="availability-block absolute z-10 flex min-h-7 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border px-0.5 py-1 text-center text-[9px] leading-none font-semibold shadow-[0_2px_5px_rgb(0_0_0/7%)] transition hover:z-20 hover:brightness-[0.98] focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring/45 focus-visible:outline-none"
      style={{
        top: top + 3,
        height: Math.max(height - 6, 28),
        left: `calc(${(lane + 0.5) * laneWidth}% - ${blockWidth / 2}px)`,
        width: blockWidth,
        color: meta.color,
        background: meta.soft,
        borderColor: meta.border,
      }}
    >
      <span
        className="max-h-full overflow-hidden whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
      >
        {meta.name}
      </span>
      <span
        className="h-px w-3 shrink-0 bg-current opacity-45"
        aria-hidden="true"
      />
      <span
        className="max-h-full overflow-hidden whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', textOrientation: 'upright' }}
      >
        {compactPrice}
      </span>
    </button>
  );
}

type PositionedBlock = {
  block: AvailabilityBlock;
  lane: number;
  laneCount: number;
};

function positionOverlappingBlocks(
  blocks: AvailabilityBlock[],
): PositionedBlock[] {
  const sorted = blocks
    .map((block) => ({
      block,
      start: timeToMinutes(block.start),
      end: timeToMinutes(block.end),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => {
      return (
        left.start - right.start ||
        VENUE_ORDER.indexOf(left.block.venueId) -
          VENUE_ORDER.indexOf(right.block.venueId) ||
        left.end - right.end
      );
    });

  const result: PositionedBlock[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assignments = cluster.map((item) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      return { block: item.block, lane };
    });
    const laneCount = laneEnds.length;
    result.push(...assignments.map((item) => ({ ...item, laneCount })));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flushCluster();

  return result;
}

export function TimelineSkeleton() {
  return (
    <div className="overflow-hidden p-3" aria-label="正在加载时间轴">
      <div className="flex gap-1.5">
        <Skeleton className="h-[420px] w-[72px] shrink-0" />
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="w-16 shrink-0 space-y-1.5">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function money(value: number): string {
  return value
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}
