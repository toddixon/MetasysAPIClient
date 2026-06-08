import { Component, inject, Input } from '@angular/core';
import { BehaviorSubject, defer, isObservable, map, mergeMap, Observable, of, OperatorFunction, startWith, switchMap, tap, withLatestFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormService } from '../form.service';
import { EnumMember } from '../models/enum-set.models';
import { FormControlWithMetaData, ValidatorMeta } from '../models/formControlWithMetadata.model';

@Component({
  selector: 'app-display-value-projection',
  imports: [
    CommonModule

  ],
  templateUrl: './display-value-projection.component.html',
  styleUrl: './display-value-projection.component.scss'
})
export class DisplayValueProjectionComponent {
  private control$ = new BehaviorSubject<FormControlWithMetaData | null>(null);

  @Input()
  set control(ctrl: FormControlWithMetaData | null) {
    this.control$.next(ctrl);
  }

  readonly value$ = this.control$.pipe(
    switchMap(ctrl => {
      if (!ctrl) {
        return of(null);
      }

      const enumSet$ =
        ctrl.type && isObservable(ctrl.type)
          ? ctrl.type
          : of<EnumMember[] | undefined>(undefined);

      return ctrl.valueChanges.pipe(
        startWith(ctrl.value),
        withLatestFrom(enumSet$),
        map(([val, enumSet]) =>
          enumSet
            ? enumSet.find(m => m.const === val)?.title ?? val
            : val
        )
      );
    })
  );

}
