import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpacesNavigationTreeComponent } from './spaces-navigation-tree.component';

describe('SpacesNavigationTreeComponent', () => {
  let component: SpacesNavigationTreeComponent;
  let fixture: ComponentFixture<SpacesNavigationTreeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpacesNavigationTreeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpacesNavigationTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
