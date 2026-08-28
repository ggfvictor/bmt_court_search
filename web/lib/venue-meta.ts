import type { VenueId } from '@/lib/availability';

export const VENUE_META: Record<
  VenueId,
  { name: string; color: string; soft: string; border: string }
> = {
  qingyu: { name: '青羽', color: '#087f73', soft: '#dff4ef', border: '#84cfc2' },
  meizi: { name: '梅子', color: '#a95316', soft: '#fff0dc', border: '#e9b87d' },
  shihuan: { name: '十环', color: '#4d4aa6', soft: '#ebeafd', border: '#aaa7e8' },
};

export const VENUE_ORDER: VenueId[] = ['qingyu', 'meizi', 'shihuan'];
