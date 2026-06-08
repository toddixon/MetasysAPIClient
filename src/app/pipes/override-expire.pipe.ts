import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'overrideExpire'
})
export class OverrideExpirePipe implements PipeTransform {
  transform(o: any): string {
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


}
