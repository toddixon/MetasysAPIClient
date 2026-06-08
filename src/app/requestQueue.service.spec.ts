import { TestBed } from '@angular/core/testing';
import { defer, Subject, Subscription } from 'rxjs';
import { Configuration } from './api';
import { LoggerService } from './logger.service';
import { RequestQueueService } from './requestQueue.service';

describe('RequestQueueService', () => {
  let service: RequestQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LoggerService,
        { provide: Configuration, useValue: { basePath: '' } },
      ],
    });
    service = TestBed.inject(RequestQueueService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should reserve capacity so interactive requests start before additional background work', () => {
    const started: string[] = [];
    const subscriptions: Subscription[] = [];
    const activeBackgrounds = Array.from({ length: 4 }, (_, index) => ({
      label: `bg-active-${index}`,
      subject: new Subject<void>(),
    }));
    const queuedBackground$ = new Subject<void>();
    const interactive$ = new Subject<void>();

    activeBackgrounds.forEach(({ label, subject }) => {
      subscriptions.push(
        service.request(
          () => defer(() => {
            started.push(label);
            return subject.asObservable();
          }),
          { priority: 'background' },
        ).subscribe(),
      );
    });

    expect(started).toEqual([
      'bg-active-0',
      'bg-active-1',
      'bg-active-2',
    ]);

    subscriptions.push(
      service.request(
        () => defer(() => {
          started.push('bg-pending');
          return queuedBackground$.asObservable();
        }),
        { priority: 'background' },
      ).subscribe(),
    );

    subscriptions.push(
      service.request(
        () => defer(() => {
          started.push('interactive');
          return interactive$.asObservable();
        }),
        { priority: 'interactive' },
      ).subscribe(),
    );

    expect(started).toEqual([
      'bg-active-0',
      'bg-active-1',
      'bg-active-2',
      'interactive',
    ]);

    interactive$.complete();

    expect(started).toEqual([
      'bg-active-0',
      'bg-active-1',
      'bg-active-2',
      'interactive',
    ]);

    activeBackgrounds[0].subject.complete();

    expect(started).toEqual([
      'bg-active-0',
      'bg-active-1',
      'bg-active-2',
      'interactive',
      'bg-active-3',
    ]);

    activeBackgrounds[1].subject.complete();

    expect(started).toEqual([
      'bg-active-0',
      'bg-active-1',
      'bg-active-2',
      'interactive',
      'bg-active-3',
      'bg-pending',
    ]);

    queuedBackground$.complete();
    activeBackgrounds.slice(2).forEach(({ subject }) => subject.complete());
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });
});
