
export function getTimeDiff(now: Date, exp: Date): number {
  const diffMs = exp.getTime() - now.getTime();
  return Math.floor(diffMs / 1000);
}

export function daySubtractor(date: Date, days: number = 1) {
  return new Date(date.getTime() - (days * 24 * 60 * 60 * 1000));
}