const locale = 'zh-CN';

export const formatNumber = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);

export const formatDuration = (milliseconds: number) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(milliseconds / 1_000);

export const formatMilliseconds = (milliseconds: number) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'millisecond',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(milliseconds);

export const formatScore = (score: number) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(score);
