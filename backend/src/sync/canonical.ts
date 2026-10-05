export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj=value as Record<string,unknown>;
    return `{${Object.keys(obj).sort().map(key=>`${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
  }
  const encoded=JSON.stringify(value);
  if (encoded === undefined) throw Error('Cannot canonicalize undefined');
  return encoded;
}
