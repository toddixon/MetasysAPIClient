import { inject, Injectable } from '@angular/core';
import { defer, delay, finalize, Observable, retry, Subscriber, Subscription, tap, timer } from 'rxjs';
import { environment } from '../environments/environment.development';
import { LoggerService } from './logger.service';
import { Configuration } from './api';

export type RequestPriority = 'interactive' | 'background';

export interface RequestQueueOptions {
  bypassQueue?: boolean;
  priority?: RequestPriority;
}

interface QueuedRequest<T> {
  priority: RequestPriority;
  reqFactory: () => Observable<T>;
  subscriber: Subscriber<T>;
  started: boolean;
  finished: boolean;
  subscription?: Subscription;
}

@Injectable({
  providedIn: 'root'
})
export class RequestQueueService {
  private _loggerService = inject(LoggerService);
  private _configuration = inject(Configuration);

  private readonly MAX_CONCURRENT_REQUESTS = environment.maxConcurrentRequests ?? 4;
  private readonly REQUEST_DELAY = environment.requestDelay ?? 50;
  private readonly RETRY_COUNT = environment.queryRetryCount ?? 2;
  private readonly RETRY_DELAY = environment.queryRetryDelay ?? 250;
  private readonly MAX_BACKGROUND_REQUESTS = this.MAX_CONCURRENT_REQUESTS > 1
    ? this.MAX_CONCURRENT_REQUESTS - 1
    : 1;
  private readonly MAX_INTERACTIVE_STREAK = Math.max(this.MAX_CONCURRENT_REQUESTS, 2);
  public readonly errorArr: Array<string> = [];

  private logRequestQueue = false;
  private pendingRequests: Array<QueuedRequest<unknown>> = [];
  private activeRequestCount = 0;
  private activeInteractiveRequestCount = 0;
  private activeBackgroundRequestCount = 0;
  private interactiveDispatchStreak = 0;

  constructor() { }

  /** Handles retry, delay, and active count tracking */
  private executeRequest<T>(reqFactory: () => Observable<T>): Observable<T> {
    return defer(reqFactory).pipe(
      retry({
        count: this.RETRY_COUNT,
        delay: (err, retryCount) => {
          const endpoint =
            err?.url
              ? err.url.replace(this._configuration.basePath, '')
              : 'unknown';

          this._loggerService.warn(
            'Request retry:',
            `Endpoint: ${endpoint}`,
            `Status: ${err?.status ?? 'n/a'}`,
            `RetryCount: ${retryCount}`
          );
          return timer(this.RETRY_DELAY);
        },
        resetOnSuccess: true,
      }),
      delay(this.REQUEST_DELAY),
      tap({
        error: err => {
          this._loggerService.errorSubject$.next(err);
          const endpoint = err?.url
            ? err.url.replace(this._configuration.basePath, '')
            : 'unknown';
          this._loggerService.error('Request Failed:', `Endpoint: ${endpoint}`, `Status: ${err?.status ?? 'n/a'}`);
        }
      }),
    );
  }

  /** Adds request observable to queue */
  private enqueueRequest<T>(reqFactory: () => Observable<T>, priority: RequestPriority): Observable<T> {
    return new Observable<T>(subscriber => {
      const queuedRequest: QueuedRequest<T> = {
        priority,
        reqFactory,
        subscriber,
        started: false,
        finished: false,
      };

      this.pendingRequests.push(queuedRequest as QueuedRequest<unknown>);
      this.logQueueState('queued', priority);
      this.drainQueue();

      return () => this.cancelRequest(queuedRequest);
    });
  }

  private cancelRequest<T>(queuedRequest: QueuedRequest<T>): void {
    if (queuedRequest.finished) {
      return;
    }

    if (!queuedRequest.started) {
      this.pendingRequests = this.pendingRequests.filter(request => request !== queuedRequest);
      queuedRequest.finished = true;
      this.logQueueState('removed', queuedRequest.priority);
      return;
    }

    queuedRequest.subscription?.unsubscribe();
  }

  private drainQueue(): void {
    while (this.activeRequestCount < this.MAX_CONCURRENT_REQUESTS) {
      const nextRequest = this.dequeueNextRequest();

      if (!nextRequest) {
        return;
      }

      this.startRequest(nextRequest);
    }
  }

  private dequeueNextRequest(): QueuedRequest<unknown> | undefined {
    if (this.activeBackgroundRequestCount >= this.MAX_BACKGROUND_REQUESTS && this.activeInteractiveRequestCount === 0) {
      const nextInteractiveIndex = this.pendingRequests.findIndex(request => request.priority === 'interactive');
      if (nextInteractiveIndex === -1) {
        return undefined;
      }
      this.interactiveDispatchStreak++;
      return this.pendingRequests.splice(nextInteractiveIndex, 1)[0];
    }

    const nextInteractiveIndex = this.pendingRequests.findIndex(request => request.priority === 'interactive');
    const nextBackgroundIndex = this.pendingRequests.findIndex(request => request.priority === 'background');

    if (nextInteractiveIndex !== -1 &&
      (this.interactiveDispatchStreak < this.MAX_INTERACTIVE_STREAK || nextBackgroundIndex === -1)) {
      this.interactiveDispatchStreak++;
      return this.pendingRequests.splice(nextInteractiveIndex, 1)[0];
    }

    if (nextBackgroundIndex !== -1 && this.activeBackgroundRequestCount < this.MAX_BACKGROUND_REQUESTS) {
      this.interactiveDispatchStreak = 0;
      return this.pendingRequests.splice(nextBackgroundIndex, 1)[0];
    }

    return undefined;
  }

  private startRequest<T>(queuedRequest: QueuedRequest<T>): void {
    queuedRequest.started = true;
    this.activeRequestCount++;
    if (queuedRequest.priority === 'interactive') {
      this.activeInteractiveRequestCount++;
    } else {
      this.activeBackgroundRequestCount++;
    }
    this.logQueueState('started', queuedRequest.priority);

    queuedRequest.subscription = this.executeRequest(queuedRequest.reqFactory).pipe(
      finalize(() => this.completeRequest(queuedRequest)),
    ).subscribe({
      next: value => queuedRequest.subscriber.next(value),
      error: error => queuedRequest.subscriber.error(error),
      complete: () => queuedRequest.subscriber.complete(),
    });
  }

  private completeRequest<T>(queuedRequest: QueuedRequest<T>): void {
    if (queuedRequest.finished) {
      return;
    }

    queuedRequest.finished = true;
    this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
    if (queuedRequest.priority === 'interactive') {
      this.activeInteractiveRequestCount = Math.max(0, this.activeInteractiveRequestCount - 1);
    } else {
      this.activeBackgroundRequestCount = Math.max(0, this.activeBackgroundRequestCount - 1);
    }
    this.logQueueState('completed', queuedRequest.priority);
    this.drainQueue();
  }

  private logQueueState(event: 'queued' | 'started' | 'completed' | 'removed', priority: RequestPriority): void {
    if (!this.logRequestQueue) {
      return;
    }

    this._loggerService.debug(
      'RequestQueueService',
      `Event: ${event}`,
      `Priority: ${priority}`,
      `Pending: ${this.pendingRequests.length}`,
      `Active: ${this.activeRequestCount}`,
      `ActiveInteractive: ${this.activeInteractiveRequestCount}`,
      `ActiveBackground: ${this.activeBackgroundRequestCount}`,
    );
  }

  private normalizeOptions(options?: boolean | RequestQueueOptions): Required<RequestQueueOptions> {
    if (typeof options === 'boolean') {
      return {
        bypassQueue: options,
        priority: 'interactive',
      };
    }

    return {
      bypassQueue: options?.bypassQueue ?? false,
      priority: options?.priority ?? 'interactive',
    };
  }

  public request<T>(reqFactory: () => Observable<T>, options?: boolean | RequestQueueOptions): Observable<T> {
    const { bypassQueue, priority } = this.normalizeOptions(options);
    return bypassQueue ? reqFactory() : this.enqueueRequest(reqFactory, priority);
  }


}
