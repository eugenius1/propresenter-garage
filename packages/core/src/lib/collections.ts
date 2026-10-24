export function groupBy<T>(rows: Iterable<T>, pick: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = pick(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** A copy of the set with the value added or removed, for React state. */
export function toggled<T>(set: ReadonlySet<T>, value: T, on = !set.has(value)): Set<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}
