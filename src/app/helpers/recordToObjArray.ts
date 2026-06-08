
export function getObjectArrayFromRecord<T>(record: Record<string, T>): T[] {
  const arr = Object.entries(record).map(([key, value]) => ({
    id: key,
    ...value,
  }));
  return arr;
}