import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, Injector, signal, WritableSignal } from '@angular/core';
import { streamHeaders, reqOptions, streamRoutes, lastSegment } from './constants/api.constants';
import { BehaviorSubject, catchError, defer, distinctUntilChanged, exhaustMap, filter, last, map, merge, Observable, of, ReplaySubject, retry, share, shareReplay, startWith, Subject, switchMap, take, takeUntil, tap, throwError, timer } from 'rxjs';
import { SseClient } from 'ngx-sse-client'
import { environment } from '../environments/environment.development';
import { RequestPriority, RequestQueueService } from './requestQueue.service';
import { LoggerService } from './logger.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filterNull } from './helpers/rxjs.helpers';
import { ObjectSubscription, ObjectUpdateEvent, ObjectValueUpdate, StoredStreamEvent, streamTypes } from './models/stream.models';
import { ObjectAttributeIDs } from './models/object-attribute.models';
import { Classification, ObjectsStreamValuesUpdateInner } from './api';
import { isObjectsStreamValuesUpdateInner } from './api-models/objectsStreamValues.models';
// eslint-disable-next-line import/no-cycle
import { NetworkDeviceManagerService, ObjectStatusBatchTarget } from './network-device-manager.service';

interface ObjectStatusSnapshot {
  status?: string | null;
  alarmState?: string | null;
  subscriptionId?: string;
}

interface ParentChildStatusBatch {
  subscriptionId: string;
  childIds: string[];
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

@Injectable({
  providedIn: 'root'
})
export class StreamService {
  private _sseClient = inject(SseClient);
  private _requestQueueService = inject(RequestQueueService);
  private _loggerService = inject(LoggerService);
  private _httpClient = inject(HttpClient);
  private _injector = inject(Injector);

  private _stopStream$ = new Subject<void>();
  public streamSubject$ = new Subject<MessageEvent>();
  public streamAuthResSubject$ = new BehaviorSubject<MessageEvent | null>(null);

  public subscriptionSubject$ = new Subject<any>();

  public objectValuesUpdateSubject$ = new BehaviorSubject<Array<ObjectsStreamValuesUpdateInner> | []>([]);
  private objectSubStorage: Map<string, Array<ObjectSubscription>> = new Map();
  private objectStatusSubStorage: Map<string, Array<ObjectSubscription>> = new Map();
  private objectStatusCache = new Map<string, { status?: string; alarmState?: string }>();
  private objectStatusStateStorage = new Map<string, BehaviorSubject<ObjectStatusSnapshot>>();
  private objectStatusAttributeStorage = new Map<string, 'status' | 'presentValue'>();
  private statusSubscriptionObjects = new Map<string, Set<string>>();
  private parentChildStatusBatches = new Map<string, ParentChildStatusBatch>();
  private ancestorOnlineRegistry = new Map<string, BehaviorSubject<boolean>>();
  // Maps any object ID → its nearest network-device ancestor's ID (device/server/integration/controller).
  // Network-device objects register as their own ancestor; all others inherit from their parent.
  // Populated top-down as ObjectComponents initialize so a parent's entry is always present
  // before its children's ngOnInit fires.
  private networkAncestorMap = new Map<string, string>();
  // Maps any object ID → its nearest top-level ancestor's ID (device/server only).
  // Used to ensure that extension children of point objects gate on the device/server,
  // not the intermediate controller, because extensions live in device memory.
  private topLevelAncestorMap = new Map<string, string>();
  private readonly OFFLINE_STATUS = 'objectStatusEnumSet.osOffline';
  private readonly NORMAL_STATUS = 'objectStatusEnumSet.osNormal';
  private readonly CONTROLLER_OFFLINE_STATUS = 'controllerStatusEnumSet.csOffline';
  private readonly CONTROLLER_COMMDISABLE_STATUS = 'controllerStatusEnumSet.csCommDisable';
  private readonly OFFLINE_RETRY_DELAY_MS = 30_000;
  private readonly CHILD_STATUS_BATCH_CACHE_TTL_MS = 15_000;
  // Tracks subscription IDs for which we synthesised an offline status update via
  // object.values.error, so we can enrich the recovery object.values.update with
  // status:osNormal (Metasys only sends alarmState on recovery, not status).
  private readonly offlineSubscriptionIds = new Set<string>();
  private MAX_SUBSCRIPTIONS = environment.maxSubscriptions;
  private readonly MAX_LOG_SIZE = 500;
  public readonly streamEventLog$ = new BehaviorSubject<StoredStreamEvent[]>([]);

  constructor() {
  }

  private getOrCreateObjectStatusState(objectId: string): BehaviorSubject<ObjectStatusSnapshot> {
    if (!this.objectStatusStateStorage.has(objectId)) {
      this.objectStatusStateStorage.set(objectId, new BehaviorSubject<ObjectStatusSnapshot>({}));
    }

    return this.objectStatusStateStorage.get(objectId)!;
  }

  private hasManagedObjectStatusSource(objectId: string): boolean {
    const state = this.objectStatusStateStorage.get(objectId)?.getValue();
    if (state && (state.status !== undefined || state.alarmState !== undefined || state.subscriptionId !== undefined)) {
      return true;
    }

    return (this.objectStatusSubStorage.get(objectId)?.length ?? 0) > 0;
  }

  private emitObjectStatusState(objectId: string, update: ObjectStatusSnapshot): void {
    const subject = this.getOrCreateObjectStatusState(objectId);
    const current = subject.getValue();

    subject.next({
      status: update.status !== undefined ? update.status : current.status,
      alarmState: update.alarmState !== undefined ? update.alarmState : current.alarmState,
      subscriptionId: update.subscriptionId ?? current.subscriptionId,
    });
  }

  private trackStatusObject(objectId: string, classification?: Classification | string): void {
    const statusAttribute = classification === Classification.Controller ? 'presentValue' : 'status';
    this.objectStatusAttributeStorage.set(objectId, statusAttribute);
    this.getOrCreateObjectStatusState(objectId);
  }

  private storeStatusSubscription(objectId: string, subscriptionId: string): void {
    const subs = this.objectStatusSubStorage.get(objectId) ?? [];
    if (!subs.some(sub => sub.subscriptionId === subscriptionId)) {
      subs.push({ subscriptionId });
      this.objectStatusSubStorage.set(objectId, subs);
    }

    const objectIds = this.statusSubscriptionObjects.get(subscriptionId) ?? new Set<string>();
    objectIds.add(objectId);
    this.statusSubscriptionObjects.set(subscriptionId, objectIds);
  }

  private clearParentChildStatusBatchCleanup(parentId: string): void {
    const batch = this.parentChildStatusBatches.get(parentId);
    if (!batch?.cleanupTimer) {
      return;
    }

    clearTimeout(batch.cleanupTimer);
    batch.cleanupTimer = undefined;
  }

  private teardownParentChildStatusBatch(parentId: string): void {
    const batch = this.parentChildStatusBatches.get(parentId);
    if (!batch) {
      return;
    }

    if (batch.cleanupTimer) {
      clearTimeout(batch.cleanupTimer);
    }

    this.parentChildStatusBatches.delete(parentId);
    this.statusSubscriptionObjects.delete(batch.subscriptionId);

    batch.childIds.forEach((childId) => {
      const nextSubs = (this.objectStatusSubStorage.get(childId) ?? []).filter(sub => sub.subscriptionId !== batch.subscriptionId);
      if (nextSubs.length > 0) {
        this.objectStatusSubStorage.set(childId, nextSubs);
      } else {
        this.objectStatusSubStorage.delete(childId);
      }
    });

    this.deleteSubscription('objects', batch.subscriptionId).pipe(take(1)).subscribe({
      error: () => {
        this._loggerService.error(`Failed to delete child status batch ${batch.subscriptionId} for parent ${parentId}`);
      },
    });
  }

  private hasSameChildStatusTargets(existingChildIds: string[], targets: ObjectStatusBatchTarget[]): boolean {
    if (existingChildIds.length !== targets.length) {
      return false;
    }

    const expectedIds = new Set(targets.map(target => target.objectId));
    return existingChildIds.every(childId => expectedIds.has(childId));
  }

  private resolveStatusUpdateObjectIds(update: ObjectsStreamValuesUpdateInner): string[] {
    const item = update.item as Record<string, unknown>;
    const objectId = item['id'];
    if (typeof objectId === 'string') {
      return [objectId];
    }

    if (!update.subscriptionId) {
      return [];
    }

    return Array.from(this.statusSubscriptionObjects.get(update.subscriptionId) ?? []);
  }

  private routeStatusUpdates(updates: ObjectsStreamValuesUpdateInner[]): void {
    updates.forEach((update) => {
      const item = update.item as Record<string, unknown>;
      const objectIds = this.resolveStatusUpdateObjectIds(update);

      objectIds.forEach((objectId) => {
        const statusAttribute = this.objectStatusAttributeStorage.get(objectId) ?? 'status';
        const nextState: ObjectStatusSnapshot = {
          subscriptionId: update.subscriptionId,
        };
        let hasStateUpdate = false;

        if (Object.prototype.hasOwnProperty.call(item, 'status')) {
          nextState.status = item['status'] as string | null | undefined;
          hasStateUpdate = true;
        } else if (statusAttribute === 'presentValue' && Object.prototype.hasOwnProperty.call(item, 'presentValue')) {
          nextState.status = item['presentValue'] as string | null | undefined;
          hasStateUpdate = true;
        }

        if (Object.prototype.hasOwnProperty.call(item, 'alarmState')) {
          nextState.alarmState = item['alarmState'] as string | null | undefined;
          hasStateUpdate = true;
        }

        if (hasStateUpdate || nextState.subscriptionId) {
          this.emitObjectStatusState(objectId, nextState);
        }
      });
    });
  }

  public watchObjectStatus(objectId: string): Observable<ObjectStatusSnapshot> {
    return this.getOrCreateObjectStatusState(objectId).asObservable();
  }

  public connectToManagedObjectStatus(
    objectId: string,
    classification?: Classification | string,
    parentId?: string,
    hasChildren?: boolean,
  ): Observable<{ status?: string | null; alarmState?: string | null; subscriptionId?: string }> {
    this.trackStatusObject(objectId, classification);

    const isNetworkDevice =
      classification === Classification.Device ||
      classification === Classification.Server ||
      classification === Classification.Integration ||
      classification === Classification.Controller;

    const isTopLevel =
      classification === Classification.Device ||
      classification === Classification.Server;

    const managed$ = this.watchObjectStatus(objectId);

    if (isNetworkDevice) {
      this.networkAncestorMap.set(objectId, objectId);

      if (isTopLevel || !parentId) {
        this.topLevelAncestorMap.set(objectId, objectId);
        return managed$.pipe(
          tap(state => {
            this.getOrCreateAncestorStatus(objectId).next(!this.isOfflineStatus(state.status, classification));
          }),
        );
      }

      const topLevelId = this.topLevelAncestorMap.get(parentId);
      if (topLevelId) {
        this.topLevelAncestorMap.set(objectId, topLevelId);
      }

      return this.getOrCreateAncestorStatus(parentId).pipe(
        distinctUntilChanged(),
        switchMap(isParentOnline => {
          if (!isParentOnline) {
            this.getOrCreateAncestorStatus(objectId).next(false);
            this.emitObjectStatusState(objectId, { status: this.OFFLINE_STATUS });
            return of({ status: this.OFFLINE_STATUS } as { status?: string | null; alarmState?: string | null; subscriptionId?: string });
          }

          return managed$.pipe(
            tap(state => {
              this.getOrCreateAncestorStatus(objectId).next(!this.isOfflineStatus(state.status, classification));
            }),
          );
        }),
      );
    }

    const isExtension = classification === Classification.Extension;
    const networkAncestorId = parentId ? this.networkAncestorMap.get(parentId) : undefined;
    const gatingAncestorId = (isExtension && networkAncestorId)
      ? (this.topLevelAncestorMap.get(networkAncestorId) ?? networkAncestorId)
      : networkAncestorId;

    if (gatingAncestorId) {
      this.networkAncestorMap.set(objectId, gatingAncestorId);
    }

    if (!gatingAncestorId) {
      return managed$;
    }

    return this.getOrCreateAncestorStatus(gatingAncestorId).pipe(
      distinctUntilChanged(),
      switchMap(isAncestorOnline => {
        if (!isAncestorOnline) {
          this.emitObjectStatusState(objectId, { status: this.OFFLINE_STATUS });
          return of({ status: this.OFFLINE_STATUS } as { status?: string | null; alarmState?: string | null; subscriptionId?: string });
        }

        return managed$;
      }),
    );
  }

  public provisionChildObjectStatuses(
    parentId: string,
    targets: ObjectStatusBatchTarget[],
    priority: RequestPriority = 'background',
  ): Observable<Map<string, ObjectStatusSnapshot>> {
    if (targets.length === 0) {
      return of(new Map<string, ObjectStatusSnapshot>());
    }

    const existingBatch = this.parentChildStatusBatches.get(parentId);
    if (existingBatch && this.hasSameChildStatusTargets(existingBatch.childIds, targets)) {
      this.clearParentChildStatusBatchCleanup(parentId);
      return of(new Map(targets.map(target => [target.objectId, this.getOrCreateObjectStatusState(target.objectId).getValue()])));
    }

    if (existingBatch) {
      this.teardownParentChildStatusBatch(parentId);
    }

    return this._injector.get(NetworkDeviceManagerService).subscribeToObjectsStatus(targets, priority).pipe(
      map(({ subscriptionLocation, initialStates }) => {
        const subscriptionId = this.addStatusBatchSubscription(parentId, targets, subscriptionLocation);

        targets.forEach((target) => {
          this.emitObjectStatusState(target.objectId, { subscriptionId });
        });

        initialStates.forEach((state, objectId) => {
          this.emitObjectStatusState(objectId, {
            status: state.status,
            alarmState: state.alarmState,
            subscriptionId,
          });
        });

        return new Map(targets.map(target => [target.objectId, this.getOrCreateObjectStatusState(target.objectId).getValue()]));
      }),
    );
  }

  public releaseChildObjectStatuses(parentId: string): void {
    const batch = this.parentChildStatusBatches.get(parentId);
    if (!batch || batch.cleanupTimer) {
      return;
    }

    batch.cleanupTimer = setTimeout(() => {
      this.teardownParentChildStatusBatch(parentId);
    }, this.CHILD_STATUS_BATCH_CACHE_TTL_MS);
  }

  public initStream(): Observable<MessageEvent> {
    // this._stream$ = this._sseClient.stream(
    this._sseClient.stream(
      streamRoutes.stream,
      { keepAlive: true, reconnectionDelay: environment.streamReconnectionDelay, responseType: 'event' },
      {},
      'GET'
    ).pipe(
      takeUntil(this._stopStream$),
      tap((data) => {
        const d = (data as any).data || null
        let color = undefined;
        let storedEvent: StoredStreamEvent;
        if (data.type == 'hello') {
          this.streamAuthResSubject$.next(data as MessageEvent);
          color = '#ce9178';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else if (data.type == 'message') {
          color = '#7f7f7f';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else if (data.type == 'error') {
          color = '#e46962';//! If we recieve to many errors at once, cancel the session, display an error snackbar and return the user back to login
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else if (data.type == 'object.values.heartbeat') {
          color = '#f7b402';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else if (data.type == 'object.values.heartbeatImproved') {
          color = '#ce9178';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else if (data.type == 'object.values.update') {
          const updateJson = data as ObjectUpdateEvent;
          const updateParsed = JSON.parse(updateJson.data) as ObjectsStreamValuesUpdateInner;
          const parsedArray: ObjectsStreamValuesUpdateInner[] = Array.isArray(updateParsed) ? updateParsed : [updateParsed];
          // Recovery detection: device/server/integration come back online via an alarmState
          // update — Metasys does not send a status field on recovery. If a subscription was
          // previously flagged offline via object.values.error, enrich the update with
          // status:osNormal so ObjectComponent clears the offline badge.
          const toEmit = this.offlineSubscriptionIds.size > 0
            ? parsedArray.map(u => {
              if (u.subscriptionId && this.offlineSubscriptionIds.has(u.subscriptionId) && (u.item as Record<string, any>)['alarmState'] != null) {
                this.offlineSubscriptionIds.delete(u.subscriptionId);
                return { ...u, item: { ...u.item, status: this.NORMAL_STATUS } as any };
              }
              return u;
            })
            : parsedArray;
          this.objectValuesUpdateSubject$.next(toEmit as ObjectsStreamValuesUpdateInner[]);
          this.routeStatusUpdates(toEmit as ObjectsStreamValuesUpdateInner[]);
          color = '#6b78ff';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d, parsed: parsedArray };
        } else if (data.type == 'object.values.error') {
          // Metasys sends device-offline notifications as object.values.error (not object.values.update).
          // Parse the payload and synthesise offline status updates so that ancestorOnlineRegistry
          // is updated and the offline badge cascades to all child objects.
          if (d) {
            try {
              const errorData = JSON.parse(d) as Array<{
                item: Record<string, any>;
                condition: Record<string, { error?: string }>;
                subscriptionId: string;
              }>;
              const entries = Array.isArray(errorData) ? errorData : [errorData];
              const offlineUpdates: ObjectsStreamValuesUpdateInner[] = [];
              entries.forEach(entry => {
                const isDeviceOffline = Object.values(entry.condition).some(c => c?.error === 'statusEnumSet.deviceOffline');
                if (isDeviceOffline) {
                  this.offlineSubscriptionIds.add(entry.subscriptionId);
                  offlineUpdates.push({
                    item: { status: this.OFFLINE_STATUS } as any,
                    subscriptionId: entry.subscriptionId,
                  } as ObjectsStreamValuesUpdateInner);
                }
              });
              if (offlineUpdates.length > 0) {
                this.objectValuesUpdateSubject$.next(offlineUpdates);
                this.routeStatusUpdates(offlineUpdates);
              }
            } catch { /* ignore malformed payloads */ }
          }
          color = '#e46962';
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        } else {
          storedEvent = { timestamp: new Date(), type: data.type, rawData: d };
        }
        const current = this.streamEventLog$.getValue();
        const next = current.length >= this.MAX_LOG_SIZE
          ? [...current.slice(current.length - this.MAX_LOG_SIZE + 1), storedEvent]
          : [...current, storedEvent];
        this.streamEventLog$.next(next);
        const logParams = [`type: ${data.type}, data: ${d}`];
        this._loggerService.info('Stream Event', color, logParams);
      }),
      map((res) => res as MessageEvent),
      catchError((err) => {
        return throwError(() => 'Lost stream connection. Please reconnect');
      }),
      tap({
        subscribe: () => console.log('stream$ Subscribed to'),
        unsubscribe: () => console.log('stream$ Unsubscribed to'),
        complete: () => console.log('stream$ Completed!'),
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    ).subscribe(this.streamSubject$);

    return this.streamAuthResSubject$.asObservable().pipe(
      filterNull(),
    );

  }

  // public getStream(type: streamTypes = 'hello'): Observable<MessageEvent> {
  //   this._stream$.subscribe();
  //   return this._stream$.pipe(
  //     filter((event) => event.type == type),
  //     tap((res) => {
  //       console.log(res);
  //     }),
  //   );
  // }

  public deleteSubscription(subscriptionType: string = 'objects', subscriptionId: string): Observable<void> {
    //returns status 200 on success, 404 if not found, 500 on server error
    const lastEventId = localStorage.getItem('lastEventId')!
    const deleteReq = this._httpClient.delete(`/${subscriptionType}/streams/${lastEventId}/subscriptions/${subscriptionId}`);
    return this._requestQueueService.request<any>(() => deleteReq).pipe(
      tap(() => {
        this._loggerService.info(`Deleted subscription ${subscriptionId}`);
      }),
      catchError(err => {
        this._loggerService.error(`Failed to delete subscription ${subscriptionId}:`, err);
        return throwError(() => err);
      }),
      tap({}),
    );

  }

  public getStream(): Observable<MessageEvent> {
    return this.streamSubject$.asObservable();
  }

  public stopStream() {
    this._stopStream$.next();
  }

  public addSubscription(objectId: string, subscriptionLocation: string, attribute?: ObjectAttributeIDs): string {
    const sid = subscriptionLocation.match(lastSegment)![0];
    const objSub: ObjectSubscription = {
      subscriptionId: sid,
    }
    if (attribute) {
      objSub.attribute = attribute;
    }
    let subs = this.objectSubStorage.get(objectId);
    if (subs) {
      subs.push(objSub);
      this.objectSubStorage.set(objectId, subs);
    } else {
      this.objectSubStorage.set(objectId, [objSub]);
    }
    return sid;
  }


  public removeObjectSubscriptions(objectId: string): void {
    const subs = this.objectSubStorage.get(objectId) ?? [];
    subs.forEach(sub => {
      this.deleteSubscription('objects', sub.subscriptionId).subscribe();
    });
    this.objectSubStorage.delete(objectId);
  }

  public checkSubscription(id: string, attribute?: ObjectAttributeIDs): ObjectSubscription | undefined {
    const objSubs = this.objectSubStorage.get(id);
    if (objSubs && attribute) {
      return objSubs.find(s => s.attribute == attribute);
    }
    return objSubs?.find(s => s.attribute == undefined);
  }

  public addStatusSubscription(objectId: string, subscriptionLocation: string, classification?: Classification | string): string {
    const sid = subscriptionLocation.match(lastSegment)![0];
    this.trackStatusObject(objectId, classification);
    this.storeStatusSubscription(objectId, sid);
    this.emitObjectStatusState(objectId, { subscriptionId: sid });
    return sid;
  }

  public addStatusBatchSubscription(parentId: string, targets: ObjectStatusBatchTarget[], subscriptionLocation: string): string {
    const sid = subscriptionLocation.match(lastSegment)![0];

    targets.forEach((target) => {
      this.trackStatusObject(target.objectId, target.classification);
      this.storeStatusSubscription(target.objectId, sid);
    });

    this.parentChildStatusBatches.set(parentId, {
      subscriptionId: sid,
      childIds: targets.map(target => target.objectId),
    });

    return sid;
  }



  private getOrCreateAncestorStatus(objectId: string): BehaviorSubject<boolean> {
    if (!this.ancestorOnlineRegistry.has(objectId)) {
      this.ancestorOnlineRegistry.set(objectId, new BehaviorSubject<boolean>(true));
    }
    return this.ancestorOnlineRegistry.get(objectId)!;
  }

  private isOfflineStatus(status: string | null | undefined, classification?: Classification | string): boolean {
    if (classification === Classification.Controller) {
      return status === this.OFFLINE_STATUS ||
        status === this.CONTROLLER_OFFLINE_STATUS ||
        status === this.CONTROLLER_COMMDISABLE_STATUS;
    }
    return status === this.OFFLINE_STATUS;
  }

  public pingServer(message: string): Observable<any> {
    return this._httpClient.get('https://desktop-vm/API/signalr/ping').pipe(
      take(1),
      tap(() => console.log('ping response:', message)),
    )
  }


  /**
   * Returns a cached status read for non-network-device objects, falling back to a
   * live HTTP fetch only on first mount or after an offline event cleared the entry.
   * Writes the result back into objectStatusCache so subsequent recreations are free.
   */
  private fetchWithCache(
    objectId: string,
    priority: RequestPriority = 'background',
  ): Observable<{ status?: string; alarmState?: string }> {
    const cached = this.objectStatusCache.get(objectId);
    if (cached) {
      return of(cached);
    }
    return this._injector.get(NetworkDeviceManagerService).fetchCurrentObjectStatus(objectId, undefined, priority).pipe(
      retry({ delay: (error) => error?.status === 504 ? timer(this.OFFLINE_RETRY_DELAY_MS) : throwError(() => error) }),
      tap(result => this.objectStatusCache.set(objectId, result)),
    );
  }

  // Core subscription + live stream logic, extracted from the original listenToObjectStatus.
  private _subscribeAndListen(
    objectId: string,
    classification?: Classification | string,
    priority: RequestPriority = 'background',
  ): Observable<{ status?: string; alarmState?: string, subscriptionId?: string }> {
    // Controllers report their enabled/disabled state via presentValue (controllerStatusEnumSet),
    // not via the status attribute (objectStatusEnumSet). Subscribe to the right attribute.
    const isController = classification === Classification.Controller;
    const statusKey = isController ? 'presentValue' : 'status';

    return defer(() => {
      const existing = this.objectStatusSubStorage.get(objectId)?.[0];
      if (existing) {
        return of({ subscriptionId: existing.subscriptionId, isResubscription: true });
      }
      return this._injector.get(NetworkDeviceManagerService).subscribeToObjectStatus(objectId, classification, priority).pipe(
        retry({ delay: (error) => error?.status === 504 ? timer(this.OFFLINE_RETRY_DELAY_MS) : throwError(() => error) }),
        map(subscriptionId => ({ subscriptionId, isResubscription: false })),
      );
    }).pipe(
      switchMap(({ subscriptionId, isResubscription }) => {
        const liveStream$ = this.objectValuesUpdateSubject$.asObservable().pipe(
          filter(updates => updates.length > 0),
          map(updates => updates.find(u =>
            u.subscriptionId === subscriptionId &&
            (statusKey in u.item || 'alarmState' in u.item)
          )),
          filter((update): update is ObjectsStreamValuesUpdateInner => update !== undefined),
          map(update => ({
            status: update.item[statusKey] as string | undefined, // presentValue mapped to status for controllers
            alarmState: update.item['alarmState'] as string | undefined,
            subscriptionId: update.subscriptionId,
          })),
          tap(state => this.objectStatusCache.set(objectId, state)),
        );

        if (!isResubscription) return liveStream$;

        // Re-subscription: show stale cached value immediately while a fresh read is in-flight
        const cached = this.objectStatusCache.get(objectId);
        const freshFetch$ = this._injector.get(NetworkDeviceManagerService).fetchCurrentObjectStatus(objectId, classification, priority).pipe(
          retry({ delay: (error) => error?.status === 504 ? timer(this.OFFLINE_RETRY_DELAY_MS) : throwError(() => error) }),
          tap(state => this.objectStatusCache.set(objectId, state)),
        );
        const refreshed$ = merge(freshFetch$, liveStream$);
        return cached ? refreshed$.pipe(startWith(cached)) : refreshed$;
      }),
    );
  }

  /**
   * Hierarchical status monitor.
   *
   * Network-device classifications (device / server / integration / controller):
   *   Subscribe to live COV stream updates and publish their own online/offline state
   *   to the ancestor registry so that child objects can gate on them.
   *   - device / server have no parent to gate on; they subscribe directly.
   *   - integration / controller gate behind their direct parent's registry entry.
   *
   * All other classifications (point, folder, object, …):
   *   No COV subscription is created. They gate on their NEAREST network-device
   *   ancestor (not necessarily their direct parent) via networkAncestorMap, so that
   *   non-network-device intermediate objects (folders, etc.) have zero influence on
   *   their children's offline status. When that network ancestor is online they emit
   *   a one-time alarmState read; when it is offline they inherit the offline badge.
   */
  public listenToObjectStatus(
    objectId: string,
    classification?: Classification | string,
    parentId?: string,
    hasChildren?: boolean,
    priority: RequestPriority = 'background',
  ): Observable<{ status?: string | null; alarmState?: string | null; subscriptionId?: string }> {
    this.trackStatusObject(objectId, classification);

    if (this.hasManagedObjectStatusSource(objectId)) {
      return this.watchObjectStatus(objectId);
    }

    const isNetworkDevice =
      classification === Classification.Device ||
      classification === Classification.Server ||
      classification === Classification.Integration ||
      classification === Classification.Controller;

    const isPoint = classification === Classification.Point;

    const isTopLevel =
      classification === Classification.Device ||
      classification === Classification.Server;

    if (this.hasManagedObjectStatusSource(objectId)) {
      return this.connectToManagedObjectStatus(objectId, classification, parentId, hasChildren);
    }

    // ── Network-device objects ────────────────────────────────────────────────
    if (isNetworkDevice) {
      // Register as own nearest network-device ancestor so descendants can look up this ID.
      this.networkAncestorMap.set(objectId, objectId);

      if (isTopLevel || !parentId) {
        // Device / server: register as own top-level ancestor.
        this.topLevelAncestorMap.set(objectId, objectId);
        // Subscribe directly, publish own online state.
        return this._subscribeAndListen(objectId, classification, priority).pipe(
          tap(state => this.emitObjectStatusState(objectId, state)),
          tap(state => {
            this.getOrCreateAncestorStatus(objectId).next(!this.isOfflineStatus(state.status, classification));
          }),
        );
      }
      // Integration / controller: inherit top-level ancestor from parent so point children
      // can later resolve the device/server without traversing the full chain.
      const topLevelId = this.topLevelAncestorMap.get(parentId);
      if (topLevelId) this.topLevelAncestorMap.set(objectId, topLevelId);

      // Gate behind direct parent's registry, subscribe live.
      return this.getOrCreateAncestorStatus(parentId).pipe(
        distinctUntilChanged(),
        switchMap(isParentOnline => {
          if (!isParentOnline) {
            this.getOrCreateAncestorStatus(objectId).next(false);
            // Clear the cache so re-subscription on recovery does not replay stale offline data
            // via startWith(cached), which would incorrectly re-push the registry to false.
            this.objectStatusCache.delete(objectId);
            return of({ status: this.OFFLINE_STATUS } as { status?: string | null; alarmState?: string | null });
          }
          // Immediately clear any stale offline badge and unblock the child cascade via the tap,
          // before the async fresh fetch confirms the actual state.
          return this._subscribeAndListen(objectId, classification, priority).pipe(
            startWith({ status: null, alarmState: null } as { status?: string | null; alarmState?: string | null }),
            tap(state => this.emitObjectStatusState(objectId, state)),
            tap(state => {
              this.getOrCreateAncestorStatus(objectId).next(!this.isOfflineStatus(state.status, classification));
            }),
          );
        }),
      );
    }

    // ── Non-network-device objects (points, extensions, folders, etc.) ──────
    // Walk up to the nearest network-device ancestor via networkAncestorMap so that
    // non-network-device intermediaries are bypassed entirely.
    const isExtension = classification === Classification.Extension;
    const networkAncestorId = parentId ? this.networkAncestorMap.get(parentId) : undefined;

    // Extension objects live in device/server memory and must gate on the top-level
    // device/server regardless of what their immediate parent is (controller, point, etc.).
    // All other non-network-device objects gate on the nearest network-device ancestor as normal.
    // Store the chosen ancestor in networkAncestorMap so this object's children inherit correctly.
    const gatingAncestorId = (isExtension && networkAncestorId)
      ? (this.topLevelAncestorMap.get(networkAncestorId) ?? networkAncestorId)
      : networkAncestorId;

    if (gatingAncestorId) {
      this.networkAncestorMap.set(objectId, gatingAncestorId);
    }

    // Points and objects with children fetch their own alarm state; purely leaf/intermediate
    // objects with no children emit a null reset (no network request needed).
    const shouldFetch = isPoint || !!hasChildren;

    if (!gatingAncestorId) {
      return shouldFetch
        ? this.fetchWithCache(objectId, priority).pipe(
          tap(state => this.emitObjectStatusState(objectId, state)),
        )
        : of({ status: null, alarmState: null } as { status?: string | null; alarmState?: string | null });
    }

    return this.getOrCreateAncestorStatus(gatingAncestorId).pipe(
      distinctUntilChanged(),
      switchMap(isAncestorOnline => {
        if (!isAncestorOnline) {
          // Clear the cache so a fresh read is triggered when the ancestor comes back online.
          this.objectStatusCache.delete(objectId);
          return of({ status: this.OFFLINE_STATUS } as { status?: string | null; alarmState?: string | null }).pipe(
            tap(state => this.emitObjectStatusState(objectId, state)),
          );
        }
        return shouldFetch
          ? this.fetchWithCache(objectId, priority).pipe(
            tap(state => this.emitObjectStatusState(objectId, state)),
          )
          : of({ status: null, alarmState: null } as { status?: string | null; alarmState?: string | null });
      }),
    );
  }

  // types in /home/dev/MetasysAPIClient/references/timeseries-streamevents
  public listenToValueUpdates(subscriptionId: string): Observable<Array<ObjectsStreamValuesUpdateInner>> {
    return this.objectValuesUpdateSubject$.asObservable().pipe(
      tap((update) => {
        let u = update;
        // console.log(update);
      }),
      // filter((update) => isObjectsStreamValuesUpdateInner(update)),
      filter((updates) => updates.length > 0),
      map((updates) => {
        const u = updates.filter(v => v.subscriptionId == subscriptionId);
        return u;
      }),
    );
  }

  // public subscribeToObjectEvents(route: string): Observable<any> {
  //   // const headers = new HttpHeaders().set(streamHeaders.meatasysSubscribe, '');
  //   return this._requestQueueService.get(route).pipe(
  //     tap((data) => {
  //       console.log(data);
  //     }),
  //   );

  // }

  public clearEventLog(): void {
    this.streamEventLog$.next([]);
  }

  private streamLog(event: string, data: string) {
    console.debug(`${event}: ${data}`);
  }

}
