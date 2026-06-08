import { TestBed } from '@angular/core/testing';
import { ApiFactoryService } from './api-factory.service';


describe('ApiServiceFactoryService', () => {
  let service: ApiFactoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ApiFactoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
