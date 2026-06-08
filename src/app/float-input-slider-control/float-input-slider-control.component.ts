import { CommonModule } from '@angular/common';
import { Component, computed, Input, OnInit, Signal, signal, WritableSignal } from '@angular/core';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSliderModule } from '@angular/material/slider';
import { FormControlWithMetaData, isNumberValidator, NumberValidators, StringNumberValidators } from '../models/formControlWithMetadata.model';
import { MatInputModule } from "@angular/material/input";
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { delay, iif, Observable, of, switchMap, tap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment.development';
import { isFloatType } from '../models/object-views.models';
import { FloatPrecisionDisplayControlDirective } from "../directives/float-precision-display-control.directive";

@Component({
  selector: 'app-float-input-slider-control',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSliderModule,
    MatInputModule,
    MatIconModule,
    FloatPrecisionDisplayControlDirective
  ],
  templateUrl: './float-input-slider-control.component.html',
  styleUrl: './float-input-slider-control.component.scss',
})
export class FloatInputSliderControlComponent implements OnInit {

  //TODO: Have a minimum 'width' required for the slider to appear
  @Input() control!: FormControlWithMetaData;
  private MAX_SLIDER_RANGE: number = environment.maxSliderRange;
  private MAX_SLIDER_STEPS: number = environment.maxSliderSteps;
  public maxDecimals: number = 6;

  public showSlider: WritableSignal<boolean> = signal(false);
  public minMax!: NumberValidators;
  public isNumberValidatorFn = isNumberValidator;
  public inputFocused: WritableSignal<boolean> = signal(false);
  public sliderFocused: WritableSignal<boolean> = signal(false);

  public eitherFocused: Signal<boolean> = computed(() => this.inputFocused() || this.sliderFocused());
  public controlFocused$: Observable<boolean>;
  public valueParameters?: StringNumberValidators;
  public sliderSteps: number = 1;
  public showDetails: WritableSignal<boolean> = signal(false);

  public isFloatType = isFloatType;


  constructor() {

    this.controlFocused$ = toObservable(this.eitherFocused).pipe(
      switchMap((eitherFocused: boolean) => iif(() => eitherFocused,
        of(true),
        of(false).pipe(delay(100))
      )),
      tap((data) => {
        if (this.control.focusChangedSubject$) {
          this.control.focusChangedSubject$!.next(data);
        }
        console.log(`Show Slider: ${data}`);
      }),
    );

  }


  ngOnInit(): void {

    if (this.control.focusChangedSubject$) {
      this.control.focusChangedSubject$.subscribe((focused) => {
        console.log(`${this.control.name} Focus Changed: ${focused}`);
      });
    }

    if (this.control.validatorMeta && isNumberValidator(this.control.validatorMeta)) {

      const range = this.getSliderRange(this.control.validatorMeta);
      if (range < this.MAX_SLIDER_RANGE) {
        this.sliderSteps = (range / this.MAX_SLIDER_STEPS);
        const minValue = this.control.validatorMeta.minValue.toLocaleString('en-US', { useGrouping: false });
        const maxValue = this.control.validatorMeta.maxValue.toLocaleString('en-US', { useGrouping: false });
        this.valueParameters = {
          minValue: minValue,
          maxValue: maxValue
        }
      }
    }

  }

  getSliderRange(minMax: NumberValidators): number {
    return Math.abs(minMax.maxValue - minMax.minValue);
  }


  onSliderChange(value: number | null) {
    if (value !== null) {
      this.control.setValue(value);
    }
  }

  setSliderVisibility(visible: boolean) {
    visible ? this.showSlider.set(true) : setTimeout(() => (this.showSlider.set(false)), 150);
  }

  public calcSliderSteps(pars: NumberValidators): number {
    const diff = pars.maxValue - pars.minValue;
    return diff;
  }

  // public adjustDecimals(value: string): string {
  //   if (this.control.type && isFloatType(this.control.type) && this.control.type.precision !== undefined) {
  //     const precision = this.control.type.precision;
  //     const decimalPlaces = precision.toString().split('.')[1]?.length || 0;
  //   }
  //   return value;
  // }

  // public onFocusChange(event) {
  //   if (this.control.focusChangedSubject$) {
  //     this.control.focusChangedSubject$.next(false);
  //   }
  // }


}
