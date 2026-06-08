import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ObjectsNavigationTreeComponent } from './objects-navigation-tree.component';

describe('NetworkObjectsComponent', () => {
  let component: ObjectsNavigationTreeComponent;
  let fixture: ComponentFixture<ObjectsNavigationTreeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ObjectsNavigationTreeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ObjectsNavigationTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
