import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'objectVersion'
})
export class ObjectVersionPipe implements PipeTransform {

  transform(version: any): string {
    if (!version) return '';
    return `${version.major}.${version.minor}`;
  }

}
