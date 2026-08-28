import { Search } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import type { AvailabilityBlock } from '@/lib/availability';
import { VENUE_META, VENUE_ORDER } from '@/lib/venue-meta';

const START_MINUTES = 8 * 60;
const END_MINUTES = 22 * 60;
const TOTAL_MINUTES = END_MINUTES - START_MINUTES;
const TIMELINE_WIDTH = 1120;

export function AvailabilityTimeline({
  blocks,
  courtCount,
}: {
  blocks: AvailabilityBlock[];
  courtCount: number;
}) {
  const hours = Array.from({ length: 15 }, (_, index) => index + 8);
  const courts = Array.from({ length: courtCount }, (_, index) => index + 1);

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
    <div className="timeline-scroll overflow-x-auto pb-2">
      <div style={{ width: TIMELINE_WIDTH + 84 }} className="min-w-full">
        <div className="sticky top-0 z-20 grid grid-cols-[84px_1fr] border-b border-black/7 bg-white">
          <div className="sticky left-0 z-30 flex h-12 items-center border-r border-black/7 bg-[#f8f6f1] px-3 text-xs font-semibold text-muted-foreground">
            场号
          </div>
          <div className="relative h-12 bg-[#f8f6f1]" style={{ width: TIMELINE_WIDTH }}>
            {hours.map((hour, index) => (
              <span
                key={hour}
                className="absolute top-1/2 font-mono text-[11px] font-medium tabular-nums text-muted-foreground"
                style={{
                  left: `${(index / 14) * 100}%`,
                  transform:
                    index === 0
                      ? 'translateY(-50%)'
                      : index === hours.length - 1
                        ? 'translate(-100%, -50%)'
                        : 'translate(-50%, -50%)',
                }}
              >
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>

        {courts.map((courtNumber) => {
          const courtBlocks = blocks.filter((block) => block.courtNumber === courtNumber);
          return (
            <div
              key={courtNumber}
              className="grid grid-cols-[84px_1fr] border-b border-black/6 last:border-b-0"
            >
              <div className="sticky left-0 z-10 flex h-[108px] items-center border-r border-black/7 bg-[#fcfbf8] px-3 shadow-[6px_0_12px_rgb(55_48_38/3%)]">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(courtNumber).padStart(2, '0')}
                </span>
                <span className="ml-1 text-sm font-semibold">号场</span>
              </div>
              <div
                className="timeline-grid relative h-[108px] bg-white"
                style={{ width: TIMELINE_WIDTH }}
              >
                {VENUE_ORDER.map((venueId, lane) =>
                  courtBlocks
                    .filter((block) => block.venueId === venueId)
                    .map((block, blockIndex) => (
                      <TimelineBlock
                        key={`${venueId}-${block.start}-${block.end}-${blockIndex}`}
                        block={block}
                        lane={lane}
                      />
                    )),
                )}
                {courtBlocks.length === 0 && (
                  <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground/45">
                    暂无空场
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineBlock({ block, lane }: { block: AvailabilityBlock; lane: number }) {
  const meta = VENUE_META[block.venueId];
  const start = Math.max(START_MINUTES, timeToMinutes(block.start));
  const end = Math.min(END_MINUTES, timeToMinutes(block.end));
  const left = ((start - START_MINUTES) / TOTAL_MINUTES) * 100;
  const width = ((end - start) / TOTAL_MINUTES) * 100;
  const hourly = block.hourlyPrice === null ? '价格待定' : `¥${money(block.hourlyPrice)}/h`;
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
      className="availability-block absolute flex h-7 min-w-[28px] items-center gap-1 overflow-hidden rounded-md border px-2 text-left text-[11px] font-semibold whitespace-nowrap shadow-[0_2px_5px_rgb(0_0_0/7%)] transition hover:z-20 hover:-translate-y-0.5 hover:brightness-[0.98] focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring/45 focus-visible:outline-none"
      style={{
        left: `${left}%`,
        width: `${width}%`,
        top: 8 + lane * 32,
        color: meta.color,
        background: meta.soft,
        borderColor: meta.border,
      }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
      <span className="truncate">
        {block.venueName} / {hourly}
      </span>
    </button>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="space-y-px p-3" aria-label="正在加载时间轴">
      <Skeleton className="mb-2 h-10 w-full" />
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex h-20 items-center gap-4 border-t border-black/5 px-2">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-7 w-[32%]" />
          <Skeleton className="h-7 w-[20%]" />
        </div>
      ))}
    </div>
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function money(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
