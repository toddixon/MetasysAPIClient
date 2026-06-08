import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DisplayValueProjectionComponent } from './display-value-projection.component';

describe('DisplayValueProjectionComponent', () => {
  let component: DisplayValueProjectionComponent;
  let fixture: ComponentFixture<DisplayValueProjectionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DisplayValueProjectionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DisplayValueProjectionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
