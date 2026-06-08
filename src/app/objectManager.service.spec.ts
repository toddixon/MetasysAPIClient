import { TestBed } from '@angular/core/testing';

import { ObjectManagerService } from './objectManager.service';

describe('ObjectService', () => {
  let service: ObjectManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ObjectManagerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
