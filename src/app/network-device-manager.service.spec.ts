import { TestBed } from '@angular/core/testing';

import { Classification, NetworkDevicesService, ObjectsService } from './api';
import { LoggerService } from './logger.service';
import { RequestQueueService } from './requestQueue.service';
import { StreamService } from './stream.service';
import { NetworkDeviceManagerService } from './network-device-manager.service';

describe('NetworkDeviceManagerService', () => {
  let service: NetworkDeviceManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NetworkDeviceManagerService,
        { provide: NetworkDevicesService, useValue: {} },
        { provide: ObjectsService, useValue: {} },
        { provide: StreamService, useValue: {} },
        { provide: RequestQueueService, useValue: {} },
        { provide: LoggerService, useValue: {} },
      ],
    });
    service = TestBed.inject(NetworkDeviceManagerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('builds semantic batch ids for status requests', () => {
    expect(service.buildObjectStatusBatchRequests([
      { objectId: 'device-1', classification: Classification.Device },
      { objectId: 'controller-1', classification: Classification.Controller },
    ])).toEqual([
      { id: 'device-1:status', relativeUrl: 'device-1/attributes/status' },
      { id: 'device-1:alarmState', relativeUrl: 'device-1/attributes/alarmState' },
      { id: 'controller-1:status', relativeUrl: 'controller-1/attributes/presentValue' },
      { id: 'controller-1:alarmState', relativeUrl: 'controller-1/attributes/alarmState' },
    ]);
  });

  it('parses semantic batch ids back into per-object status state', () => {
    const parsed = service.parseObjectStatusBatchResponse({
      responses: [
        {
          id: 'device-1:status',
          status: 200,
          body: { item: { status: 'objectStatusEnumSet.osNormal' } },
        },
        {
          id: 'device-1:alarmState',
          status: 200,
          body: { item: { alarmState: 'objectStatusEnumSet.osNormal' } },
        },
        {
          id: 'controller-1:status',
          status: 200,
          body: { item: { presentValue: 'controllerStatusEnumSet.csOnline' } },
        },
      ],
    } as any);

    expect(parsed.get('device-1')).toEqual({
      status: 'objectStatusEnumSet.osNormal',
      alarmState: 'objectStatusEnumSet.osNormal',
    });
    expect(parsed.get('controller-1')).toEqual({
      status: 'controllerStatusEnumSet.csOnline',
    });
  });
});
