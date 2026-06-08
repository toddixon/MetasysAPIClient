import {
  Directive,
  ElementRef,
  forwardRef,
  HostListener,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { getPrecision } from '../models/display.models';

@Directive({
  selector: '[divFormControl]',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DivFormControlDirective),
      multi: true,
    },
  ],
})
export class DivFormControlDirective implements ControlValueAccessor, OnChanges {
  @Input({ required: false }) displayPrecision?: number;
  private onChange = (value: any) => {
    let f = value
  };
  private onTouched = () => { };

  constructor(private el: ElementRef<HTMLElement>) { }

  writeValue(value: any): void {
    if (this.displayPrecision && parseFloat(value)) {
      value = getPrecision(value, this.displayPrecision);
    }
    this.el.nativeElement.textContent = value ?? '';
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.el.nativeElement.contentEditable = (!isDisabled).toString();
  }

  @HostListener('input')
  onInput() {
    this.onChange(this.el.nativeElement.textContent);
  }

  @HostListener('blur')
  onBlur() {
    this.onTouched();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['displayPrecision'] && !changes['displayPrecision'].firstChange) {
      this.writeValue(this.el.nativeElement.textContent);
    }
  }
}