import { inject, Pipe, PipeTransform } from '@angular/core';
import { ObjectManagerService } from '../objectManager.service';

@Pipe({
  name: 'enumStateTitle'
})
export class EnumStateTitlePipe implements PipeTransform {
  private _objectManagerService = inject(ObjectManagerService);
  transform(value: string, ...args: unknown[]) {
    let title: string;
    // this._objectManagerService.getEnumSet(value).subscribe({
    //   next((value) => title)
    // });
    return
  }

}
