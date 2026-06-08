import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, buffer, catchError, combineLatest, concat, concatAll, concatMap, count, delay, distinctUntilChanged, EMPTY, exhaustMap, filter, first, forkJoin, from, fromEvent, iif, map, merge, mergeMap, Observable, Observer, of, repeat, retry, scan, share, shareReplay, skip, startWith, Subject, Subscriber, switchAll, switchMap, take, takeUntil, takeWhile, tap, throwError, throwIfEmpty, timer, toArray, withLatestFrom } from 'rxjs';
import { childObjectsParams, lastSegment, objectRoutes, reqOptions, streamRoutes } from './constants/api.constants';
import { ObjectTypes } from './models/api-object.models';
import { filterNull, trackRequestProgress } from './helpers/rxjs.helpers';
import { ObjectManagerService } from './objectManager.service';
import { environment } from '../environments/environment.development';
import { StreamService } from './stream.service';
import { LoggerService } from './logger.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EventModifiers, isItemClickedEvent, isItemSelectedData, ItemClickedEvent, ItemSelectedData } from './models/event.models';
import { DisplayItem } from './models/display.models';
import { GetObjectsResponse, GetObjectsResponseItemsInner, ObjectEntityInTree, ObjectMinimalList } from './api';
import { isObjectEntityInTree } from './api-extensions';
import { ActivatedRoute, ActivatedRouteSnapshot, MaybeAsync, RedirectCommand, Resolve, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { navigationTreeParam, paramSeparator } from './constants/router.constants';
import { extractObjectId, extractOidsString } from './helpers/objectId';
import { Location } from '@angular/common';
import { isSchema, ItemAndSchema } from './models/object-schema.models';
import { FormService } from './form.service';
import { condensePaths } from './helpers/itemReference';
import { ActionWarnEvent } from './models/dialog.models';
import { NetworkDeviceManagerService } from './network-device-manager.service';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class NavigationTreeService implements Resolve<Array<string>> {
  private _streamService = inject(StreamService);
  private _objectManagerService = inject(ObjectManagerService);
  private _networkDeviceManagerService = inject(NetworkDeviceManagerService);
  private _loggerService = inject(LoggerService);
  private _router = inject(Router);
  private _activatedRoute = inject(ActivatedRoute);
  private _location = inject(Location);
  private _formService = inject(FormService);
  private _settingsService = inject(SettingsService);

  private navTreeSubject$ = new BehaviorSubject<GetObjectsResponseItemsInner | undefined>(undefined);
  public navTree$ = this.navTreeSubject$.asObservable();

  public dialogActionsSubject$ = new Subject<ActionWarnEvent>();


  public navTreeCache = new Map<string, Observable<GetObjectsResponseItemsInner> | undefined>();

  private nodeDisplayEventSubject$ = new Subject<ItemClickedEvent>();//* Emitted when event triggered (called by object.component) 
  private nodeSelectedEventSubject$ = new Subject<ItemClickedEvent>();//* Emitted when event triggered (called by object.component)
  private pickerNodeSelectedSubject$ = new Subject<ItemClickedEvent>(); //* Picker-mode selection — separate from main nav

  public nodeDisplayEvent$ = this.nodeDisplayEventSubject$.asObservable().pipe(
    shareReplay({ bufferSize: 1, refCount: true }),
  ).pipe(
    switchMap((event) => {
      const unsavedChanges$ = this.checkForUnsavedChanges();

      //TODO: Figure out if this is an 'ok' practice. It appears that the `addingToSelection` variable is evaluated each time whether or not `unsavedChanges$` has a non-empty value

      if (unsavedChanges$) {
        const addingToSelection = event.modifiers.ctrlKey && !this._formService.unsavedChangesSubject$.value.some((unsavedObj) => unsavedObj.objectId == event.id);
        if (!addingToSelection) {
          return unsavedChanges$.pipe(
            takeWhile(res => res != 'Cancel'),
            exhaustMap((res) => {
              return of(event);
            }),
          )
        }
      }

      return of(event);


    }),
  );

  public selectedNodes$: Observable<ItemSelectedData[]>;
  public selectedNodesSubject$ = new BehaviorSubject<ItemSelectedData[]>([]);

  public pickerSelectedNodesSubject$ = new BehaviorSubject<ItemSelectedData[]>([]);
  public pickerSelectedNodes$ = this.pickerSelectedNodesSubject$.asObservable().pipe(
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  public displayedNodes$: Observable<ItemSelectedData[]>;
  public displayedNodesSubject$ = new BehaviorSubject<ItemSelectedData[]>([]);

  public refreshItem$: Subject<string> = new Subject();

  public refreshNodeSubject$: Subject<string> = new Subject();

  public removeFromDisplay$: Subject<string> = new Subject();

  public contextMenuTrigger$: Subject<{ event: MouseEvent; nodeId: string }> = new Subject();

  private contextMenuInitialSelectionSubject$ = new BehaviorSubject<ItemSelectedData[]>([]);
  public contextMenuInitialSelection$ = this.contextMenuInitialSelectionSubject$.asObservable();

  private initSelectedObjectsSubject$ = new BehaviorSubject<ItemSelectedData[]>([]);
  public selectedFqr$ = this.initSelectedObjectsSubject$.asObservable().pipe(
    map((items) => {
      if (Array.isArray(items)) {
        const fqrCondensed = condensePaths(items.map(i => i.itemReference));
        return fqrCondensed;
      } else {
        return items;
      }
    }),
  );

  public displayedNodesData$: Observable<Array<DisplayItem>>;

  private routeSelectedSubscriber!: Subscriber<Array<string>>;
  public routeSelectedNodes$ = new Observable<Array<string>>(subscriber => {
    this.routeSelectedSubscriber = subscriber;
  }).pipe(
    shareReplay({ bufferSize: 1, refCount: false }),
  );



  // public initSelection$: Observable<Array<string>> = this.routeSelectedNodes$.pipe(
  //   exhaustMap((oids) => {

  //   })
  // );

  public objectStorage = new Map<string, Observable<Object>>();
  private readonly childObjectsParams: HttpParams = new HttpParams(
    { fromObject: childObjectsParams }
  );

  constructor() {

    const initSelectedObjects$ = this.routeSelectedNodes$.pipe(
      exhaustMap((oids) => {
        return from(oids).pipe(
          mergeMap((id) => this.getNode(id).pipe(
            filterNull(),
            take(1),
            map((obj) => {
              const data: ItemSelectedData = {
                id: obj.id,
                itemReference: obj.itemReference,
                parentId: obj.parentUrl?.match(lastSegment)?.[0] ?? '',
                objectType: obj.objectType,
                name: obj.name,
              }
              return data
            }),//* Take the objectType and prent ID here
          )),
          toArray(),
          tap((objFqrs) => {
            let f = objFqrs;
            console.log(f);
          }),
          shareReplay({ bufferSize: 1, refCount: false }),
        )
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    initSelectedObjects$.subscribe(this.initSelectedObjectsSubject$);

    this.selectedNodes$ = merge(this.nodeSelectedEventSubject$, this.initSelectedObjectsSubject$).pipe(
      takeUntilDestroyed(),
      scan<ItemClickedEvent | ItemSelectedData[], ItemSelectedData[]>((acc, event) => {
        if (typeof event == 'string') {
          const idx = acc.findIndex(oid => oid == event);
          if (idx !== -1) {
            acc.splice(idx, 1);
          }
        } else {
          if (Array.isArray(event)) {
            acc = event;
          } else {
            if (event.modifiers.ctrlKey) {
              acc.some((item) => item.id == event.id) ? acc = acc.filter((x) => x.id !== event.id) : acc.push(event);
            } else if (Object.values(event.modifiers).every((k) => k === false)) {
              acc = [event];
            }
          }
        }
        return acc;
      }, []),
      tap((items) => {
        const currentPath = this._location.path();
        const previousSelection = extractOidsString(currentPath);
        const currentSelection = items.map((item) => item.id).join(paramSeparator);

        if (previousSelection !== currentSelection) {
          const baseUrl = currentPath.replace(previousSelection, '');
          const newPath = this._router.createUrlTree([baseUrl, currentSelection]).toString();
          this._location.replaceState(newPath);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
      startWith([]),
    );
    this.selectedNodes$.subscribe(this.selectedNodesSubject$);

    this.displayedNodes$ = merge(this.nodeDisplayEvent$, this.removeFromDisplay$).pipe(
      scan<ItemClickedEvent | string, ItemSelectedData[]>((acc, event) => {
        if (typeof event == 'string') {
          const idx = acc.findIndex(oid => oid.id == event);
          if (idx !== -1) {
            acc.splice(idx, 1);
          }
        } else {
          if (event.modifiers.ctrlKey) {
            acc.some((item) => item.id == event.id) ? acc = acc.filter((x) => x.id !== event.id) : acc.push(event);
          } else if (Object.values(event.modifiers).every((k) => k === false)) {
            acc = [event];
          }
        }
        return acc;
      }, []),
      shareReplay({ bufferSize: 1, refCount: true }),

    )
    // this.displayedNodes$ = this.nodeSelectedEvent$.pipe(
    // buffer(this._settingsService.doubleClickDelay),//* add double click buffer here 
    // filter((clickEvents) => clickEvents.length >= 2),
    // scan<ItemClickedEvent, string[]>((acc, event) => {
    //   if (event.modifiers.ctrlKey) {
    //     acc.includes(event.id) ? acc = acc.filter((x) => x !== event.id) : acc.push(event.id);
    //   } else if (Object.values(event.modifiers).every((k) => k === false)) {
    //     acc = [event.id];
    //   }
    //   return acc;
    // }, [] as string[])
    // );

    this.displayedNodes$.subscribe(this.displayedNodesSubject$);

    this.displayedNodesData$ = this.displayedNodesSubject$.pipe(
      map<Array<ItemSelectedData>, Array<DisplayItem>>((itemData) => {
        const displayItms: Array<DisplayItem> = [];
        const selectedFqr: Array<string> = [];
        itemData.forEach((item) => {
          const displayItem = {
            itemData: item,
            item$: this.refreshItem$.pipe(
              filter(refreshId => refreshId === item.id),
              startWith(null),
              switchMap(() => this._objectManagerService.getObject(item.id, true, true)),
              shareReplay({ bufferSize: 1, refCount: false }),
              tap((data) => {
                const itemFqr = data.item['itemReference'];
                selectedFqr.push(itemFqr);
              }),
            ),
            node$: this.getNode(item.id).pipe(
              map((node) => {
                return node as GetObjectsResponseItemsInner;
              }),
              tap((node) => {
                let f = node
              }),
            )
          } as DisplayItem;
          displayItms.push(displayItem);
        });
        // this.selectedFqrSubject$.next(selectedFqr);
        return displayItms;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );


  }


  //* When we begin to select the objects that were passed into the queryParameters we will call .next on the selectedNodesSubeject$ passing in all of the validated nodes.
  //* A new process in the selectedNodes$ Observable will we will do a recursive operation that does the following
  //* - look for ObjectID in objectStorage
  //* - If nothing look for the objects parent in the objectStorage
  //* - If nothing there, we'll need to make another object request and go from there

  //* - Instead of all of this, let's just take the `itemReference` and parse through the tree until we get to the selected object!
  public resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): MaybeAsync<string[]> {
    const objectIds: Array<string> = route.paramMap.get(navigationTreeParam)?.split(paramSeparator) || [];

    if (objectIds.length > 0) {
      // Pre-seed the nav tree cache with all nodes along the path to each selected object
      // before emitting to routeSelectedSubscriber. This lets getNode() return instantly
      // from cache for every node along the path rather than making sequential HTTP requests.
      return this.prefetchPaths(objectIds).pipe(
        tap(() => this.routeSelectedSubscriber.next(objectIds)),
        map(() => [] as string[]),
      );
    }

    this.routeSelectedSubscriber.next(objectIds);
    return [];
  }

  /**
   * Calls getObjects with pathTo for each unique object ID in parallel, then walks the
   * returned path trees and pre-populates navTreeCache with every node along each path.
   * Failures for individual paths are swallowed so they never block navigation.
   */
  private prefetchPaths(objectIds: string[]): Observable<void> {
    return forkJoin(
      [...new Set(objectIds)].map(id =>
        this._objectManagerService.getObjectsPathTo(id).pipe(
          tap(response => this.seedCacheFromPathResponse(response)),
          catchError(() => of(null)),
        )
      )
    ).pipe(map(() => { }));
  }

  /**
   * Recursively walks a GetObjectsResponse path tree and seeds navTreeCache with every
   * node encountered. Only seeds nodes not already cached so live-fetched data is never
   * overwritten by the path pre-fetch.
   *
   * Each cache entry emits the path node immediately (so FQR lookups and tree rendering
   * work without waiting for HTTP), then fires a background getChildObjects fetch to load
   * the full sibling list. Once that fetch completes, shareReplay replaces the cached value
   * with the full node, enabling the user to navigate to surrounding objects.
   */
  private seedCacheFromPathResponse(response: GetObjectsResponse): void {
    const seedNode = (node: GetObjectsResponseItemsInner): void => {
      if (!this.navTreeCache.get(node.id)) {
        const objectId = node.id;

        // Background fetch mirrors getNode() logic but falls back to the path node on error
        // rather than propagating the error (keeps the immediately-emitted path node usable).
        const fullFetch$ = this.refreshNodeSubject$.pipe(
          filter(refreshId => refreshId === objectId),
          startWith(null),
          switchMap(() =>
            this._objectManagerService.getChildObjects(objectId, this.childObjectsParams, 'background').pipe(
              map((data) => {
                const primaryNode = this.setItemExpanded(data.items.find(i => i.id === objectId) ?? node);
                if (primaryNode.hasChildrenMatchingQuery) {
                  this.checkChildNodes(primaryNode);
                }
                return primaryNode;
              }),
              catchError((err) => {
                if (err.status === 504) {
                  this._networkDeviceManagerService.getNetworkDevices();
                }
                return of(node);
              }),
            )
          ),
        );

        // Emit path node first for instant rendering, then the full fetch result takes over.
        // refCount: false keeps the cache alive so the full result is retained for later subscribers.
        const item$ = merge(of(node), fullFetch$).pipe(
          shareReplay({ bufferSize: 1, refCount: false }),
        );
        this.navTreeCache.set(objectId, item$);
      }

      if (isObjectEntityInTree(node) && node.items?.length > 0) {
        node.items.forEach(child => seedNode(child));
      }
    };
    response.items.forEach(item => seedNode(item));
  }

  public getRootNode(): Observable<GetObjectsResponseItemsInner> {
    let parentNode: Observable<GetObjectsResponseItemsInner>
    parentNode = this._objectManagerService.getChildObjects(undefined).pipe(
      take(1),
      shareReplay({ bufferSize: 1, refCount: true }),
      map((obj) => {
        return obj.items[0]
      }),
      tap((node) => {
        node = this.setItemExpanded(node);
        this.navTreeCache.set(node.id, of(node));
      }),
    );


    return parentNode.pipe(
      concatMap((obj) => {
        let childObjs;
        if (isObjectEntityInTree(obj) && obj.items.length > 0) {
          childObjs = obj.items;
        } else {
          return of(obj);
        }
        return combineLatest(
          childObjs.map(obj => this.getNode(obj.id, obj))
        ).pipe(
          map((children) => {
            return { ...obj, children };
          })
        );

      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap((objs) => {
        this.navTreeSubject$.next(objs);
      }),
    );
  }
  //Online: 'type: object.values.update, data: [{"item":{"apduRetries":4,"id":"44fc78fc-a5c2-5c61-9c10-d3f9443622c2","itemReference":"DESKTOP-VM:NS-NAE01"},"condition":{"apduRetries":{"reliability":"reliabilityEnumSet.reliable","priority":"writePriorityEnumSet.priorityNone"}},"subscriptionId":"c8f399d8-e6aa-41b5-996e-553e5d5c6f14"},{"item":{"siteDirectorOnline":true,"id":"44fc78fc-a5c2-5c61-9c10-d3f9443622c2","itemReference":"DESKTOP-VM:NS-NAE01"},"condition":{"siteDirectorOnline":{"reliability":"reliabilit…nce":"DESKTOP-VM:NS-NAE01/FC-1"},"condition":{"name":{"reliability":"reliabilityEnumSet.reliable","priority":"writePriorityEnumSet.priorityNone"}},"subscriptionId":"00b94fcd-8c53-4fce-8ba4-96438e95c0dc"},{"item":{"apduTimeout":6000,"id":"fba10b59-f3d9-58d5-b541-19d75967d806","itemReference":"DESKTOP-VM:NS-NAE01/FC-1"},"condition":{"apduTimeout":{"reliability":"reliabilityEnumSet.reliable","priority":"writePriorityEnumSet.priorityNone"}},"subscriptionId":"00b94fcd-8c53-4fce-8ba4-96438e95c0dc"}]'
  //Offline: 'type: object.values.error, data: [{"item":{"apduRetries":null,"id":"44fc78fc-a5c2-5c61-9c10-d3f9443622c2","itemReference":"DESKTOP-VM:NS-NAE01"},"condition":{"apduRetries":{"error":"statusEnumSet.deviceOffline"}},"attribute":"attributeEnumSet.apduRetries","subscriptionId":"c8f399d8-e6aa-41b5-996e-553e5d5c6f14"},{"item":{"siteDirectorOnline":null,"id":"44fc78fc-a5c2-5c61-9c10-d3f9443622c2","itemReference":"DESKTOP-VM:NS-NAE01"},"condition":{"siteDirectorOnline":{"error":"statusEnumSet.deviceOffl…1-19d75967d806","itemReference":"DESKTOP-VM:NS-NAE01/FC-1"},"condition":{"name":{"error":"statusEnumSet.deviceOffline"}},"attribute":"attributeEnumSet.name","subscriptionId":"00b94fcd-8c53-4fce-8ba4-96438e95c0dc"},{"item":{"apduTimeout":null,"id":"fba10b59-f3d9-58d5-b541-19d75967d806","itemReference":"DESKTOP-VM:NS-NAE01/FC-1"},"condition":{"apduTimeout":{"error":"statusEnumSet.deviceOffline"}},"attribute":"attributeEnumSet.apduTimeout","subscriptionId":"00b94fcd-8c53-4fce-8ba4-96438e95c0dc"}]'
  //* If condition statusEnumSet.deviceOffline
  public getNode(objectId: string, obj?: ObjectEntityInTree): Observable<GetObjectsResponseItemsInner> {
    let navNode = this.navTreeCache.get(objectId);

    if (!navNode) {
      const item$ = this.refreshNodeSubject$.pipe(
        filter(refreshId => refreshId === objectId),
        startWith(null),
        switchMap(() => this._objectManagerService.getChildObjects(objectId, this.childObjectsParams)),

        catchError((err) => {
          //* If device is offline 
          if (err.status == 504) {
            // this._networkDeviceManagerService.getNetworkDevices().pipe(
            //   tap((data) => {
            //     console.log(data);
            //   }),
            // )
            if (obj) {
              return of(obj);
            } else {
              return throwError(() => err);
            }
          } else {

            this._loggerService.error('NavigationTreeService getNode Error:', err.message);
            return throwError(() => err);
          }
        }),
        map((data) => {//data.items[0].itemReference == '"DESKTOP-VM:NS-NAE01/FC-1.M4-CGM'
          let primaryNode;
          if (data && data.items && data.items.length > 0) {
            primaryNode = this.setItemExpanded(data.items.find(i => i.id === objectId)!);
          } else {
            primaryNode = obj ?? {} as GetObjectsResponseItemsInner;
          }

          if (primaryNode?.hasChildrenMatchingQuery) {
            this.checkChildNodes(primaryNode!);
          }
          return primaryNode;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.navTreeCache.set(objectId, item$);
    }

    return this.navTreeCache.get(objectId)!;
  }

  private checkChildNodes(obj: GetObjectsResponseItemsInner): void {
    //TODO: `addNode` find a way to take each of the child nodes that were fetched with the parent node and create an observable similar to the one returned from `getNode`, however, the *source* is the object value (not the `getchildnodes()` function), and if the refreshNodeSubject$ is *nexted* switch out the source for a getChildNodes request
    if (isObjectEntityInTree(obj)) {
      let childItems = obj.items;
      childItems.forEach((item) => {
        if (!item.hasChildrenMatchingQuery) {
          this.navTreeCache.set(item.id, undefined);
        }
      });
    }
    return;
  }

  private setItemExpanded(item: GetObjectsResponseItemsInner): GetObjectsResponseItemsInner {
    const childItems = isObjectEntityInTree(item) ? item.items : [];
    // item.expanded = item.parentUrl == null && item.hasChildrenMatchingQuery;
    if (item.parentUrl == null && item.hasChildrenMatchingQuery) {
      item.expanded = true;
    }
    childItems.forEach((child) => this.setItemExpanded(child));
    return item;
  }

  public updateNode(item: GetObjectsResponseItemsInner): void {
    if (!item || !item.id) {
      this._loggerService.error('updateNode Error:', 'Invalid item provided');
      return;
    }

    // Wrap the item in an observable so it matches the Map's value type
    const updatedNode$ = of(item).pipe(
      tap(() => this._loggerService.debug(`Node ${item.id} updated in navTreeCache`)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    // Update or insert into cache
    this.navTreeCache.set(item.id, updatedNode$);

    // Optional: if this node has children, ensure they are also initialized in cache
    this.checkChildNodes(item);
  }

  public refreshNode(id: string): void {
    this.refreshNodeSubject$.next(id);
  }

  //* Called by object.component when an object is clicked (selected) and when it is double-clicked (displayed)

  public onTreeNodeSelect(event: ItemClickedEvent) {
    this.nodeSelectedEventSubject$.next(event);
  }

  public onPickerNodeSelect(event: ItemClickedEvent): void {
    const current = this.pickerSelectedNodesSubject$.value;
    let next: ItemSelectedData[];

    if (event.modifiers.ctrlKey) {
      next = current.some((item) => item.id === event.id)
        ? current.filter((item) => item.id !== event.id)
        : [...current, event];
    } else {
      next = [event];
    }

    this.pickerSelectedNodesSubject$.next(next);
  }

  public setPickerSelectedNodes(itemSelectedData: ItemSelectedData[]): void {
    this.contextMenuInitialSelectionSubject$.next(itemSelectedData);
    this.pickerSelectedNodesSubject$.next(itemSelectedData);
  }

  public resolvePickerSelection(itemReferences: string[]): Observable<ItemSelectedData[]> {
    return this.getRootNode().pipe(
      take(1),
      map((root) => itemReferences
        .map((itemReference) => this.findItemSelectedDataByReference(root, itemReference))
        .filter((item): item is ItemSelectedData => item != null)),
    );
  }

  private findItemSelectedDataByReference(
    node: GetObjectsResponseItemsInner | undefined,
    itemReference: string,
  ): ItemSelectedData | null {
    if (!node) {
      return null;
    }

    if (node.itemReference === itemReference) {
      return {
        id: node.id,
        itemReference: node.itemReference,
        parentId: node.parentUrl?.match(lastSegment)?.[0] ?? '',
        objectType: node.objectType,
        name: node.name,
      };
    }

    const children = (node as GetObjectsResponseItemsInner & { items?: GetObjectsResponseItemsInner[] }).items ?? [];
    for (const child of children) {
      const found = this.findItemSelectedDataByReference(child, itemReference);
      if (found) {
        return found;
      }
    }

    return null;
  }

  public replaceSelectedNodes(nodes: ItemSelectedData[]): void {
    this.initSelectedObjectsSubject$.next(nodes);
  }

  public onTreeNodeDisplay(event: ItemClickedEvent) {
    this.nodeDisplayEventSubject$.next(event);
  }

  //*********************** */

  public checkForUnsavedChanges() {
    let unsavedChangesWarn$: Observable<any> | undefined;
    let unsavedChanges = this._formService.unsavedChangesSubject$.value
    if (unsavedChanges.length > 0) {
      const warnMsg = `There are still unsaved changes for the objects present in the display panel. Would you like to save existing changes before performing this operation?`;
      const unsavedOids = unsavedChanges.map(c => c.objectId);

      unsavedChangesWarn$ = from(unsavedChanges).pipe(
        concatMap((c) => this.getNode(c.objectId).pipe(
          take(1),
          filterNull())),
        toArray(),
        exhaustMap((nodes) => {
          let responseSubscriber: Subscriber<any>;
          return new Observable<any>((sub: Subscriber<any>) => {
            responseSubscriber = sub;
            const initUnsaved = unsavedChanges.length;

            //TODO: If any saves fail, we need to monitor that and cancel the save operation. Alternatively, we can just have a `timeout` operator that errors if the unsaved changes length doesn't go to 0 after Xms
            const doSomethingFn$ = this._formService.unsavedChangesUpdate$.pipe(
              tap({ subscribe: () => this._formService.saveAllSubject$.next() }),
              takeWhile((c) => unsavedChanges.length != 0),
              map((unsaved) => {
                const remaining = unsaved.length;
                const completed = initUnsaved - remaining;
                return Math.round((completed / initUnsaved) * 100);
              }),
              tap({
                complete: () => {
                  unsavedOids.forEach((id) => {
                    this.refreshItem$.next(id);
                  })
                },
              }),

            );

            const actionWarn: ActionWarnEvent = {
              operation: 'copy',
              message: warnMsg,
              doSomething: 'Save',
              ignore: 'Continue',
              nodes: nodes,
              doSomethingFn$: doSomethingFn$,
              res$: responseSubscriber
            };

            this.dialogActionsSubject$.next(actionWarn);
          }).pipe(
            take(1),
            tap((data) => {
              console.log(data);
            }),
          )

        })
      );


    }
    return unsavedChangesWarn$;
  }

  public listenForUnsavedChanges(objectId: string): Observable<boolean> {
    return this._formService.unsavedChangesUpdate$.pipe(
      map((unsavedChanges) => {
        return unsavedChanges.some((cArr) => cArr.objectId == objectId)
        // return unsavedChanges.find(c => c.objectId == objectId);
      }),
      // filter((unsaved) => unsaved != undefined),
    )
  }

}
