import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'genericObject'
})
export class GenericObjectPipe implements PipeTransform {

  transform(value: any): string {
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

}
