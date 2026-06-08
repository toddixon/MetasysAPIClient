import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FloatInputSliderControlComponent } from './float-input-slider-control.component';

describe('FloatInputSliderControlComponent', () => {
  let component: FloatInputSliderControlComponent;
  let fixture: ComponentFixture<FloatInputSliderControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FloatInputSliderControlComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FloatInputSliderControlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
