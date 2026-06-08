import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ControlGroupComponent } from './control-group.component';

describe('ControlGroupComponent', () => {
  let component: ControlGroupComponent;
  let fixture: ComponentFixture<ControlGroupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ControlGroupComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ControlGroupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
