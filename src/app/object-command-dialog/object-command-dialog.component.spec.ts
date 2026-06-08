import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ObjectCommandDialogComponent } from './object-command-dialog.component';

describe('ObjectCommandDialogComponent', () => {
  let component: ObjectCommandDialogComponent;
  let fixture: ComponentFixture<ObjectCommandDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ObjectCommandDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ObjectCommandDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
