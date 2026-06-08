export function formatStructData(obj: any, type: string): string {
  if (!obj || typeof obj !== 'object') {
    return obj === null || obj === undefined ? '' : String(obj);
  }

  let val;
  if (['date', 'time'].every(key => key in obj)) {
    return dateTimeFormat(obj);
  }

  if ('year' in obj && 'month' in obj && 'dayOfMonth' in obj) {
    return dateOnlyFormat(obj);
  }

  if ('hour' in obj && 'minute' in obj && 'second' in obj) {
    return timeOnlyFormat(obj);
  }

  switch (type) {
    case 'overrideExpirationTime':
      val = dateTimeFormat(obj);
      break;
    case 'version':
      val = objectVersionFormat(obj);
      break;
    case 'genericObject':
      val = genericObject(obj);
      break;
    default:
      val = genericObject(obj);
      break;
  }
  return val;
}


function dateTimeFormat(o: any) {
  if (!o) return '';

  const parse = (str: string) => str.split('.').pop() ?? str;

  if (!o.date && !o.time) return 'Unspecified';

  const month = parse(o.date.month).replace('month', '');
  const day = parse(o.date.dayOfMonth).replace('bdom', '');
  const dow = parse(o.date.dayOfWeek);

  const hh = o.time.hour.toString().padStart(2, '0');
  const mm = o.time.minute.toString().padStart(2, '0');
  const ss = o.time.second.toString().padStart(2, '0');
  const hs = o.time.hundredth.toString().padStart(2, '0');

  return `Date: ${o.date.year} ${month} ${day} (${dow})\n` +
    `Time: ${hh}:${mm}:${ss}.${hs}`;
}

function dateOnlyFormat(o: any): string {
  const parse = (str: string) => str?.split('.').pop() ?? str;
  const month = parse(String(o.month ?? ''))?.replace('month', '') ?? '';
  const day = parse(String(o.dayOfMonth ?? ''))?.replace('bdom', '') ?? '';
  const dow = o.dayOfWeek ? parse(String(o.dayOfWeek)) : '';
  const dayOfWeek = dow ? ` (${dow})` : '';
  return `${o.year ?? ''} ${month} ${day}${dayOfWeek}`.trim();
}

function timeOnlyFormat(o: any): string {
  const hh = String(o.hour ?? 0).padStart(2, '0');
  const mm = String(o.minute ?? 0).padStart(2, '0');
  const ss = String(o.second ?? 0).padStart(2, '0');
  const hs = String(o.hundredth ?? 0).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${hs}`;
}

function objectVersionFormat(version: any): string {
  if (!version) return '';
  return `${version.major}.${version.minor}`;
}

function genericObject(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  try {
    // Pretty JSON formatting with indentation
    return JSON.stringify(value, null, 2);
  } catch {
    // Fallback for circular structures or weird types
    return String(value);
  }
}