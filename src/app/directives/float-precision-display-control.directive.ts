import { computed, Directive, effect, ElementRef, HostListener, Input, OnChanges, OnInit, Renderer2, SimpleChanges } from '@angular/core';
import { NgControl } from '@angular/forms';
import { getPrecision } from '../models/display.models';
import { MatFormField } from '@angular/material/form-field';
import { map, of, switchMap } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

@Directive({
  selector: '[appFloatPrecisionDisplayControl]',
})
export class FloatPrecisionDisplayControlDirective implements OnInit, OnChanges {

  @Input() displayPrecision: number = 0.01;
  @Input() controlValue: number | undefined;


  private isHovered = false;
  private isFocused = false;
  private fullValue: number | null = null;

  constructor(
    private el: ElementRef<HTMLInputElement>,
    private control: NgControl,
    private renderer: Renderer2
  ) {

  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['controlValue']) {
      if (changes['controlValue'].currentValue !== changes['controlValue'].previousValue) {
        this.fullValue = this.control.value;
        this.updateDisplay();
      }
    }
    if (changes['displayPrecision'] && !changes['displayPrecision'].firstChange) {
      this.updateDisplay();
    }

  }

  ngOnInit() {
    this.renderer.setStyle(this.el.nativeElement, 'transition', 'transform 0.2s ease, box-shadow 0.2s ease');
    // this.control.valueChanges?.pipe(
    //   switchMap((changeEvent) => {
    //     // if() {

    //     // }
    //     return changeEvent;
    //   })
    // ).subscribe();

  }

  @HostListener('focus')
  onFocus() {
    this.isFocused = true;
    this.showFullValue();
    if (!this.isHovered) {
      this.animate();
    }
  }

  @HostListener('blur')
  onBlur() {
    this.isFocused = false;
    this.fullValue = this.control.value; // Store the actual value
    this.updateDisplay();
    if (!this.isHovered) {
      this.animate();
    }
  }

  @HostListener('mouseenter')
  onMouseEnter() {
    this.isHovered = true;
    this.showFullValue();
    if (!this.isFocused) {
      this.animate();
    }
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.isHovered = false;
    this.updateDisplay();
    if (!this.isFocused) {
      this.animate();
    }
  }

  @HostListener('input', ['$event.target.value'!])
  onInput(value: string) {
    this.fullValue = parseFloat(value);
  }

  private showFullValue() {
    if (this.fullValue !== null) {
      this.el.nativeElement.value = this.fullValue.toString();
    }
  }

  private updateDisplay() {
    if (!this.isFocused && !this.isHovered && this.fullValue !== null) {
      this.el.nativeElement.value = getPrecision(this.fullValue, this.displayPrecision);
    }
  }

  private valuesIdentical(): boolean {
    if (this.fullValue) {
      return this.fullValue?.toString() == getPrecision(this.fullValue, this.displayPrecision)
    } return false
  }

  private animate() {
    if (!this.valuesIdentical()) {
      const element = this.el.nativeElement;

      // Pulse animation
      this.renderer.setStyle(element, 'transform', 'scale(1.01)');
      // this.renderer.setStyle(element, 'box-shadow', '0 0 8px rgba(59, 130, 246, 0.5)');

      setTimeout(() => {
        this.renderer.setStyle(element, 'transform', 'scale(1)');
        // this.renderer.setStyle(element, 'box-shadow', 'none');
      }, 100);
    }
  }

}
