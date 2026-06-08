import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnformattedDisplayComponent } from './unformatted-display.component';

describe('UnformattedDisplayComponent', () => {
  let component: UnformattedDisplayComponent;
  let fixture: ComponentFixture<UnformattedDisplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnformattedDisplayComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnformattedDisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
