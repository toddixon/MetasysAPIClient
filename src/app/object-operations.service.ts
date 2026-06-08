import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { HttpParams } from '@angular/common/http';
import {
  BehaviorSubject, catchError, concat, concatMap, delay, exhaustMap, filter,
  finalize, forkJoin, from, map, merge, mergeMap, Observable, of, Subject, Subscriber,
  switchMap, take, takeWhile, tap, throwError, toArray,
} from 'rxjs';
import { environment } from '../environments/environment.development';
import { lastSegment } from './constants/api.constants';
import { filterNull } from './helpers/rxjs.helpers';
import { ObjectManagerService } from './objectManager.service';
import { LoggerService } from './logger.service';
import { FormService } from './form.service';
import { PasteEvent } from './models/event.models';
import { ActionWarnEvent, CopyNodeState, CopyNodeStatus, CopyProgressState, ObjectOperationUpdate } from './models/dialog.models';
import {
  GetObjectsResponseItemsInner,
  GetObjectSupportedChildTypes200ResponseInner, GetObjectTypeSchema200Response,
  ObjectEntityInTree,
  ObjectMinimalList,
  PostObjectsBatch200Response,
  PostObjectsBatchRequestRequestsInner,
  PostObjectsRequest,
} from './api';
import { isObjectEntityInTree } from './api-extensions';
import { getCopiedObjectSchema, ObjectSnapshot, parseBatchAttributeResponse } from './models/copied-object.models';
import { NavigationTreeService } from './navigation-tree.service';
import { isSchema } from './models/object-schema.models';

@Injectable({
  providedIn: 'root'
})
export class ObjectOperationsService {
  private _navTreeService = inject(NavigationTreeService);
  private _objectManagerService = inject(ObjectManagerService);
  private _loggerService = inject(LoggerService);
  private _formService = inject(FormService);

  public pasteDialogSubject$ = new Subject<ActionWarnEvent>();
  public deleteDialogSubject$ = new Subject<ActionWarnEvent>();

  public DEV_DELETELIST: string[] = []; //!DEV

  public clipboard: WritableSignal<string[]> = signal([]);
  public fetchingPasteData: WritableSignal<boolean> = signal(false);
  private _copiedSnapshots: WritableSignal<ObjectSnapshot[]> = signal([]);
  private _copiedRootSourceObjectIds: WritableSignal<Set<string>> = signal(new Set<string>());
  private _ignoredCopiedNodes: WritableSignal<GetObjectsResponseItemsInner[]> = signal([]);

  public get copiedSnapshots(): ObjectSnapshot[] {
    return this._copiedSnapshots();
  }

  private _getRootSnapshotsForValidation(items: ObjectSnapshot[]): ObjectSnapshot[] {
    const copiedRoots = this._copiedRootSourceObjectIds();
    if (copiedRoots.size > 0) {
      const rootItems = items.filter((item) => copiedRoots.has(item.sourceObjectId));
      if (rootItems.length > 0) {
        return rootItems;
      }
    }

    // Fallback for legacy/older clipboard payloads: roots are items whose parent is not also in the copied set.
    const copiedIds = new Set(items.map((item) => item.sourceObjectId));
    return items.filter((item) => !item.sourceParentId || !copiedIds.has(item.sourceParentId));
  }

  public buildCopiedObjectSnapshot(
    // item: { objectType: string; parentUrl?: string | null },
    node: GetObjectsResponseItemsInner,
    prefetched: { schema: GetObjectTypeSchema200Response; batchResponse: PostObjectsBatch200Response },
  ): ObjectSnapshot {
    const sourceParentId = node.parentUrl?.match(lastSegment)?.[0] ?? null;
    return {
      sourceObjectId: node.id,
      sourceParentId,
      objectType: node.objectType,
      classification: node.classification,
      name: node.name,
      label: node.label,
      itemReference: node.itemReference,
      hasChildrenMatchingQuery: node.hasChildrenMatchingQuery,
      schemaResponse: prefetched.schema,
      batchAttributeResponse: prefetched.batchResponse,
    };
  }

  public buildCopiedObjectSnapshotFromNode(objectId: string, node?: GetObjectsResponseItemsInner): Observable<ObjectSnapshot> {
    const node$ = node ? of(node) : this._navTreeService.getNode(objectId).pipe(
      filterNull(),
      take(1),
    );

    return forkJoin([
      this._objectManagerService.getObject(objectId, true),
      node$,
    ]).pipe(
      switchMap(([item, resolvedNode]) => {
        const sourceParentId = item.parentUrl?.match(lastSegment)?.[0] ?? null;
        const schema$ = sourceParentId
          ? this._objectManagerService.getObjectTypeSchema(item.objectType, sourceParentId)
          : of({ schema: item.schema, views: item.views } as GetObjectTypeSchema200Response);

        return schema$.pipe(
          switchMap((schemaResponse) => {
            const batchRequests = isSchema(schemaResponse.schema)
              ? this._objectManagerService.buildBatchRequestInner(objectId, Object.keys(schemaResponse.schema.properties))
              : [];
            const batch$ = batchRequests.length > 0
              ? this._objectManagerService.fetchAttributesBatch(batchRequests)
              : of<PostObjectsBatch200Response>({ responses: [] });
            return batch$.pipe(
              map((batchResponse) => this.buildCopiedObjectSnapshot(resolvedNode, { schema: schemaResponse, batchResponse })),
            );
          }),
        );
      }),
    );
  }

  private _buildCreatePayload(snapshot: ObjectSnapshot, overrides: Record<string, any>): Record<string, any> | null {
    const schema = getCopiedObjectSchema(snapshot);
    if (!schema) {
      return null;
    }

    const snapshotItem = parseBatchAttributeResponse(snapshot.batchAttributeResponse, snapshot.sourceObjectId);
    const mergedItem = { ...snapshotItem, ...overrides };

    const createItem: Record<string, any> = {};
    for (const propertyName of schema.required) {
      if (mergedItem[propertyName] !== undefined) {
        createItem[propertyName] = mergedItem[propertyName];
        continue;
      }

      const schemaProperty = (schema.properties as Record<string, any>)[propertyName];
      if (schemaProperty?.default !== undefined) {
        createItem[propertyName] = schemaProperty.default;
      } else {
        return null;
      }
    }

    return createItem;
  }

  private _buildPatchPayload(snapshot: ObjectSnapshot, overrides: Record<string, any>): Record<string, any> {
    const schema = getCopiedObjectSchema(snapshot);
    if (!schema) {
      return {};
    }

    const snapshotItem = parseBatchAttributeResponse(snapshot.batchAttributeResponse, snapshot.sourceObjectId);
    const mergedItem = { ...snapshotItem, ...overrides };

    return Object.entries(mergedItem).reduce<Record<string, any>>((acc, [key, value]) => {
      const schemaProperty = (schema.properties as Record<string, any>)[key];
      if (!schemaProperty || schemaProperty.readOnly === true || schema.required.includes(key)) {
        return acc;
      }

      acc[key] = value;
      return acc;
    }, {});
  }

  //TODO: If objects are copied, we need to figure out whether or not we what to allow the user to use some of the other navigation tree operations (e.g. delete, add, etc)
  public copySelected(): Observable<{ items: ObjectSnapshot[]; ignoredNodes: GetObjectsResponseItemsInner[] }> {
    const unsavedChangesWarn$ = this._navTreeService.checkForUnsavedChanges();

    //* Improving copy speed

    //* Improving copy speed: pre-fetch schemas for every copied object in parallel, then fetch
    //* all attributes for all objects in a single batch request.
    //* Schemas are deduplicated — objects of the same type under the same parent share one request.
    const copyNodes$ = this._navTreeService.selectedNodesSubject$.pipe(
      take(1),
      exhaustMap((objects) => {
        if (objects.length === 0) {
          return of(new Map<string, { schema: GetObjectTypeSchema200Response; batchResponse: PostObjectsBatch200Response }>());
        }

        // Deduplicate schema fetches by objectType+parentId
        const schemaFetchMap = new Map<string, { objectType: string; parentId: string; ids: string[] }>();
        objects.forEach(obj => {
          const key = `${obj.objectType}::${obj.parentId}`;
          if (!schemaFetchMap.has(key)) {
            schemaFetchMap.set(key, { objectType: obj.objectType, parentId: obj.parentId, ids: [] });
          }
          schemaFetchMap.get(key)!.ids.push(obj.id);
        });

        // Step 1: fetch all schemas in parallel //! DON'T fetch in parallel, fetch all of these in one instance.
        return forkJoin(
          Array.from(schemaFetchMap.values()).map(({ objectType, parentId, ids }) =>
            this._objectManagerService.getObjectTypeSchema(objectType, parentId, true).pipe(
              map(schema => ({ ids, schema })),
              catchError((err) => {//! TODO: retries on request fail reguardless of response occurr in the requestQueueService 
                if (err.status == 400) {
                  return throwError(() => new Error(`Unsupported object type "${objectType}" at the paste location. This object and any of its children will be ignored.`));
                }
                else {
                  return throwError(() => new Error(`Failed to fetch schema for object type "${objectType}". This object and any of its children will be ignored. Error details: ${err.message}`));
                }
              }),
            )
          )
        ).pipe(
          // Step 2: build one batch request for all objects' attributes and execute it once
          switchMap((schemaResults) => {
            const schemaByObjectId = new Map<string, GetObjectTypeSchema200Response>();
            schemaResults.forEach(result => {
              if (!result) return;
              result.ids.forEach(id => schemaByObjectId.set(id, result.schema));
            });

            const batchRequests: PostObjectsBatchRequestRequestsInner[] = objects.flatMap(obj => {
              const schemaData = schemaByObjectId.get(obj.id);
              if (!schemaData || !isSchema(schemaData.schema)) return [];
              return this._objectManagerService.buildBatchRequestInner(obj.id, Object.keys(schemaData.schema.properties));
            });

            const batch$ = batchRequests.length > 0
              ? this._objectManagerService.fetchAttributesBatch(batchRequests)
              : of<PostObjectsBatch200Response>({ responses: [] });

            return batch$.pipe(
              map((batchResponse) => {
                // Partition the single batch response into per-object slices
                const prefetchMap = new Map<string, { schema: GetObjectTypeSchema200Response; batchResponse: PostObjectsBatch200Response }>();
                objects.forEach(obj => {
                  const schema = schemaByObjectId.get(obj.id);
                  if (!schema) return;
                  const prefix = `${obj.id}:`;
                  const objResponses = batchResponse.responses.filter(r => r.id.startsWith(prefix));
                  prefetchMap.set(obj.id, { schema, batchResponse: { responses: objResponses } });
                });
                return prefetchMap;
              }),
            );
          }),
        );
      }),
    );

    const selectedItemNodes$ = this._navTreeService.selectedNodesSubject$.pipe(
      take(1),
      exhaustMap((selectedNodes) => {
        if (selectedNodes.length === 0) {
          return of<Array<ObjectEntityInTree | ObjectMinimalList>>([]);
        }

        const items = selectedNodes.map((selectedNode) =>
          this._navTreeService.getNode(selectedNode.id).pipe(
            filterNull(),
            take(1),
          ),
        );

        const resolveItems$ = from(items).pipe(
          mergeMap((item) => item),
          toArray(),
        );

        return resolveItems$;
      }),
    );

    const itemNodes$ = !unsavedChangesWarn$
      ? of(true)
      : unsavedChangesWarn$.pipe(
        take(1),
        map((res) => {
          if (res === 'Continue') {
            this._formService.unsavedChangesSubject$.next([]);
          }
          return res !== 'Cancel';
        }),
      );

    return forkJoin({ canProceed: itemNodes$, selectedItemNodes: selectedItemNodes$, prefetchMap: copyNodes$ }).pipe(
      switchMap(({ canProceed, selectedItemNodes, prefetchMap }) => {
        if (!canProceed) {
          return of(null);
        }

        const selectedIds = new Set(selectedItemNodes.map((node) => node.id));
        const ignoredNodes = selectedItemNodes
          .map((node) => node)
          .filter((node) => {
            const parentId = node.parentUrl?.match(lastSegment)?.[0];
            return !!parentId && selectedIds.has(parentId);
          });
        const ignoredIds = new Set(ignoredNodes.map((node) => node.id));
        const effectiveItemNodes = selectedItemNodes.filter((node) => !ignoredIds.has(node.id));

        const items: ObjectSnapshot[] = effectiveItemNodes
          .map((node) => {
            const prefetched = prefetchMap.get(node.id);
            if (!prefetched) return null;
            return this.buildCopiedObjectSnapshot(node, prefetched);
          })
          .filter((s): s is ObjectSnapshot => s !== null);

        return of({ items, ignoredNodes });
      }),
      filterNull(),
      tap(({ items, ignoredNodes }) => {
        this.clipboard.set(items.map((item) => item.name || item.label));
        this._copiedSnapshots.set(items);
        this._copiedRootSourceObjectIds.set(new Set(items.map((item) => item.sourceObjectId)));
        this._ignoredCopiedNodes.set(ignoredNodes);
        this._loggerService.successSubject$.next(`Successfully copied selected items: ${items.map((item) => item.label).join(', ')}`);
        navigator.clipboard.writeText(JSON.stringify(items)).catch(() => {
          console.warn('Could not write to system clipboard');
        });
      }),
      map(({ items, ignoredNodes }) => ({ items, ignoredNodes })),
    );
  }

  // ---------------------------------------------------------------------------
  // Recursive copy
  // ---------------------------------------------------------------------------

  /** Signal exposing the live progress state for the current recursive copy run. */
  public copyProgress: WritableSignal<CopyProgressState | null> = signal(null);

  /**
   * Flattens an `ObjectEntityInTree` tree into a list of `{ node, depth }` pairs.
   * Only includes nodes up to `maxDepth` levels deep (depth 0 = root itself).
   */
  private _flattenTree(
    root: ObjectEntityInTree,
    maxDepth: number,
    currentDepth: number = 0,
  ): Array<{ node: ObjectEntityInTree; depth: number }> {
    const result: Array<{ node: ObjectEntityInTree; depth: number }> = [{ node: root, depth: currentDepth }];
    if (currentDepth < maxDepth && root.items?.length) {
      for (const child of root.items) {
        result.push(...this._flattenTree(child, maxDepth, currentDepth + 1));
      }
    }
    return result;
  }

  private _emptyProgressState(total: number): CopyProgressState {
    return {
      total,
      completed: 0,
      currentObjectName: '',
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      failedSubtrees: new Map(),
      done: false,
      configuredDepth: environment.copyMaxDescendantDepth,
    };
  }

  /**
   * Copies the currently selected objects plus their full descendant trees up to
   * `environment.copyMaxDescendantDepth` levels deep.
   *
   * Emits `CopyProgressState` updates as work proceeds.
   * On completion the `_copiedSnapshots` signal is updated with all successful snapshots.
   */
  public copySelectedRecursive(): Observable<CopyProgressState> {
    return new Observable<CopyProgressState>((subscriber) => {
      this._doCopyRun(
        () => this._navTreeService.selectedNodesSubject$.pipe(take(1)).toPromise().then(nodes => nodes?.map(n => n.id) ?? []),
        subscriber,
      ).catch((err) => subscriber.error(err));
    });
  }

  /** Retry a failed subtree (the failed root + all descendants that were skipped due to its failure). */
  public retryCopySubtree(failedRootId: string): Observable<CopyProgressState> {
    return new Observable<CopyProgressState>((subscriber) => {
      this._doCopyRun(
        async () => [failedRootId],
        subscriber,
        /* isRetry */ true,
      ).catch((err) => subscriber.error(err));
    });
  }

  private async _doCopyRun(
    getRootIds: () => Promise<string[]>,
    subscriber: import('rxjs').Subscriber<CopyProgressState>,
    isRetry: boolean = false,
  ): Promise<void> {
    const maxDepth = environment.copyMaxDescendantDepth;
    const rootIds = await getRootIds();
    if (rootIds.length === 0) {
      subscriber.complete();
      return;
    }

    if (!isRetry) {
      this._copiedRootSourceObjectIds.set(new Set(rootIds));
    }

    // ------------------------------------------------------------------
    // Phase 1: Discovery — one getChildObjects call per root, flatten trees
    // ------------------------------------------------------------------
    const discoveredPairs: Array<{ node: ObjectEntityInTree; depth: number }> = [];
    for (const rootId of rootIds) {
      const params = new HttpParams().set('depth', String(maxDepth));
      let treeResponse;
      try {
        treeResponse = await this._objectManagerService.getChildObjects(rootId, params, 'background').toPromise();
      } catch {
        // If we can't even fetch the root, report it as an error and continue
        const errorState: CopyNodeState = {
          objectId: rootId,
          name: rootId,
          status: 'Error',
          errorMessage: 'Failed to fetch object tree',
          depth: 0,
        };
        const progress = this.copyProgress() ?? this._emptyProgressState(1);
        progress.errorCount++;
        progress.completed++;
        progress.failedSubtrees.set(rootId, { rootState: errorState, skippedDescendants: [] });
        this.copyProgress.set({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
        subscriber.next({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
        continue;
      }

      if (!treeResponse?.items?.length) continue;

      for (const rootItem of treeResponse.items) {
        if (!isObjectEntityInTree(rootItem)) continue;
        discoveredPairs.push(...this._flattenTree(rootItem, maxDepth));
      }
    }

    if (discoveredPairs.length === 0) {
      subscriber.complete();
      return;
    }

    const allNodes = discoveredPairs.map(p => p.node);
    const progress = this._emptyProgressState(allNodes.length);
    if (isRetry) {
      // Merge into existing progress: remove old failed/skipped state for these nodes
      const existing = this.copyProgress();
      if (existing) {
        progress.successCount = existing.successCount;
        progress.total = existing.total - existing.errorCount - existing.skippedCount + allNodes.length;
      }
    }
    this.copyProgress.set({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
    subscriber.next({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });

    // ------------------------------------------------------------------
    // Phase 2: Batch schema + attributes
    // ------------------------------------------------------------------
    const schemaFetchMap = new Map<string, { objectType: string; parentId: string; nodeIds: string[] }>();
    for (const { node } of discoveredPairs) {
      const parentId = node.parentUrl?.match(lastSegment)?.[0] ?? '';
      const key = `${node.objectType}::${parentId}`;
      if (!schemaFetchMap.has(key)) {
        schemaFetchMap.set(key, { objectType: node.objectType, parentId, nodeIds: [] });
      }
      schemaFetchMap.get(key)!.nodeIds.push(node.id);
    }

    // Track which node IDs had a schema-fetch error so we can skip their descendants
    const schemaErrorNodeIds = new Set<string>();
    let schemaResults: Array<{ nodeIds: string[]; schema: GetObjectTypeSchema200Response }> = [];

    try {//* Build observable that fetches all of our object type schemas  
      const schemaFetches = Array.from(schemaFetchMap.values()).map(({ objectType, parentId, nodeIds }) =>
        this._objectManagerService.getObjectTypeSchema(objectType, parentId, true).pipe(
          map(schema => ({ nodeIds, schema })),
          catchError(() => {
            nodeIds.forEach(id => schemaErrorNodeIds.add(id));
            return of(null);
          }),
        )
      );
      const rawResults = await forkJoin(schemaFetches).toPromise();//* Execute all schema fetches in parallel, wait for all to complete, and partition results into successes vs failures
      schemaResults = (rawResults ?? []).filter((r): r is { nodeIds: string[]; schema: GetObjectTypeSchema200Response } => r !== null);
    } catch {
      subscriber.error(new Error('Schema fetch phase failed'));
      return;
    }

    const schemaByNodeId = new Map<string, GetObjectTypeSchema200Response>();
    for (const { nodeIds, schema } of schemaResults) {
      for (const id of nodeIds) schemaByNodeId.set(id, schema);
    }

    // Identify nodes that are descendants of schema-failed nodes
    const nodeById = new Map<string, ObjectEntityInTree>(allNodes.map(n => [n.id, n]));
    const isDescendantOfError = (node: ObjectEntityInTree): boolean => {
      const parentId = node.parentUrl?.match(lastSegment)?.[0];
      if (!parentId) return false;
      if (schemaErrorNodeIds.has(parentId)) return true;
      const parentNode = nodeById.get(parentId);
      return parentNode ? isDescendantOfError(parentNode) : false;
    };

    // Mark error/skipped states
    const nodeStateMap = new Map<string, CopyNodeState>();
    for (const { node, depth } of discoveredPairs) {
      let nodeState: CopyNodeState;
      if (schemaErrorNodeIds.has(node.id)) {
        nodeState = { objectId: node.id, name: node.name ?? node.id, status: 'Error', errorMessage: 'Schema fetch failed', depth };
      } else if (isDescendantOfError(node)) {
        nodeState = { objectId: node.id, name: node.name ?? node.id, status: 'Skipped', skipReason: 'schema-failed-parent', depth };
      } else {
        nodeState = { objectId: node.id, name: node.name ?? node.id, status: 'Queued', depth };
      }
      nodeStateMap.set(node.id, nodeState);
    }

    // Build failed subtree entries
    for (const failedId of schemaErrorNodeIds) {
      const rootState = nodeStateMap.get(failedId);
      if (!rootState) continue;
      const skippedDescendants = discoveredPairs
        .map(p => p.node)
        .filter(n => {
          const s = nodeStateMap.get(n.id);
          return s?.status === 'Skipped' && s.skipReason === 'schema-failed-parent' && isDescendantOfError(n) && n.parentUrl?.match(lastSegment)?.[0] === failedId;
        })
        .map(n => nodeStateMap.get(n.id)!);
      progress.failedSubtrees.set(failedId, { rootState, skippedDescendants });
      progress.errorCount++;
      progress.completed++;
    }

    // Count skipped
    for (const [, state] of nodeStateMap) {
      if (state.status === 'Skipped') {
        progress.skippedCount++;
        progress.completed++;
      }
    }

    //* Nodes eligible for attribute fetch
    const eligiblePairs = discoveredPairs.filter(({ node }) => {
      const s = nodeStateMap.get(node.id);
      return s && s.status === 'Queued';
    });

    if (eligiblePairs.length === 0) {
      progress.done = true;
      this.copyProgress.set({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
      subscriber.next({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
      subscriber.complete();
      return;
    }

    //* Single mega batch for all eligible nodes
    const batchRequests: PostObjectsBatchRequestRequestsInner[] = eligiblePairs.flatMap(({ node }) => {
      const schema = schemaByNodeId.get(node.id);
      if (!schema || !isSchema(schema.schema)) return [];//! Currently, there is no accounting for objects we're copying if the schema isn't valid, and it's still presented as a successful operation in the progress
      return this._objectManagerService.buildBatchRequestInner(node.id, Object.keys(schema.schema.properties));
    });

    let batchResponse: PostObjectsBatch200Response = { responses: [] };
    if (batchRequests.length > 0) {
      try {
        batchResponse = (await this._objectManagerService.fetchAttributesBatch(batchRequests).toPromise())!;
      } catch {
        subscriber.error(new Error('Attribute batch fetch failed'));
        return;
      }
    }

    //* Build snapshots for each eligible node. This is where we filter all of the batch requests to their corresponding objectSnapshot object
    const successfulSnapshots: ObjectSnapshot[] = [];
    for (const { node } of eligiblePairs) {
      const schema = schemaByNodeId.get(node.id);
      if (!schema) continue;
      const prefix = `${node.id}:`;
      const objResponses = batchResponse.responses.filter(r => r.id.startsWith(prefix)).map(r => ({ ...r, id: r.id.substring(prefix.length) }));
      const snapshot = this.buildCopiedObjectSnapshot(node, { schema, batchResponse: { responses: objResponses } });

      const state = nodeStateMap.get(node.id)!;
      state.status = 'Success';
      progress.successCount++;
      progress.completed++;
      progress.currentObjectName = node.name ?? node.id;
      successfulSnapshots.push(snapshot);
    }

    progress.done = true;
    this.copyProgress.set({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });
    subscriber.next({ ...progress, failedSubtrees: new Map(progress.failedSubtrees) });

    // Merge successful snapshots into clipboard
    const existing = this._copiedSnapshots();
    if (isRetry) {
      // Replace snapshots for retried nodes
      const retriedIds = new Set(eligiblePairs.map(p => p.node.id));
      const kept = existing.filter(s => !retriedIds.has(s.sourceObjectId));
      this._copiedSnapshots.set([...kept, ...successfulSnapshots]);
    } else {
      this._copiedSnapshots.set(successfulSnapshots);
    }
    this.clipboard.set(this._copiedSnapshots().map(s => s.name || s.label));

    const names = successfulSnapshots.map(s => s.label).join(', ');
    if (names) {
      this._loggerService.successSubject$.next(`Recursive copy complete: ${names}`);
    }
    navigator.clipboard.writeText(JSON.stringify(this._copiedSnapshots())).catch(() => {
      console.warn('Could not write to system clipboard');
    });

    subscriber.complete();
  }

  public validatePasteLocationForCurrentSelection(): Observable<PasteEvent> {
    const items = this._copiedSnapshots();
    const rootItems = this._getRootSnapshotsForValidation(items);
    const ignoredNodes = this._ignoredCopiedNodes();

    if (items.length === 0) {
      return of({
        valid: false,
        parentId: '',
        items: [],
      });
    }

    return this._navTreeService.selectedNodesSubject$.pipe(
      take(1),
      switchMap((objects) => {
        if (objects.length !== 1) {
          return of({
            valid: false,
            parentId: objects[0]?.id ?? '',
            items,
            ignoredNodes: ignoredNodes.length > 0 ? ignoredNodes : undefined,
          } satisfies PasteEvent);
        }

        const selectedNode = objects[0];
        this._loggerService.debug(`Checking validity of paste location for copied items against currently selected node: ${selectedNode.name}`);

        return this._objectManagerService.listSupportedChildTypes(selectedNode.id).pipe(
          map((supportedTypes: Array<GetObjectSupportedChildTypes200ResponseInner>) => {
            const validPasteLocation = rootItems.length > 0 && rootItems.every((item) => {
              const objectType = item.objectType.split('.').pop() ?? item.objectType;
              return supportedTypes.some((supportedType) => supportedType.objectType === objectType);
            });

            return {
              valid: validPasteLocation,
              parentId: selectedNode.id,
              items,
              ignoredNodes: ignoredNodes.length > 0 ? ignoredNodes : undefined,
            } satisfies PasteEvent;
          }),
          catchError((err) => {
            this._loggerService.errorSubject$.next(err);
            return of({
              valid: false,
              parentId: selectedNode.id,
              items,
              ignoredNodes: ignoredNodes.length > 0 ? ignoredNodes : undefined,
            } satisfies PasteEvent);
          }),
        );
      }),
    );
  }

  /**
   * Fetches sibling uniqueness context for the given destination parent before the paste dialog opens.
   * Returns sibling labels, occupied unique-property values, and available MAC addresses in 4–127.
   */
  public preloadPasteSiblingContext(
    parentId: string,
    pasteItems: ObjectSnapshot[],
  ): Observable<import('./models/dialog.models').PasteSiblingContext> {
    const relevantProperties = Array.from(new Set(
      pasteItems.flatMap((item) => {
        const schema = getCopiedObjectSchema(item);
        if (!schema) return [];
        const props = schema.properties ?? {};
        const required: string[] = (schema as any).required ?? [];
        return Object.keys(props).filter(
          (p): p is import('./models/copied-object.models').MainPageUniqueProperty =>
            required.includes(p) && ['instanceNumber', 'macAddress', 'trunkNumber'].includes(p),
        );
      }),
    ));

    return this._navTreeService.getNode(parentId).pipe(
      take(1),
      switchMap((parentNode) => {
        const siblings = isObjectEntityInTree(parentNode) ? (parentNode.items ?? []) : [];
        const siblingLabels = siblings.map((s) => (s.label ?? '').trim().toLowerCase());

        if (siblings.length === 0 || relevantProperties.length === 0) {
          return of({
            siblingLabels,
            siblingUniqueValues: new Map<import('./models/copied-object.models').MainPageUniqueProperty, Set<string>>(),
            availableMacAddresses: this._computeAvailableMacs(new Set()),
          });
        }

        const batchRequests: PostObjectsBatchRequestRequestsInner[] = siblings.flatMap((s) =>
          this._objectManagerService.buildBatchRequestInner(s.id, relevantProperties),
        );

        return this._objectManagerService.fetchAttributesBatch(batchRequests).pipe(
          map((batchResponse) => {
            const siblingUniqueValues = new Map<import('./models/copied-object.models').MainPageUniqueProperty, Set<string>>();
            const occupiedMacs = new Set<number>();

            siblings.forEach((s) => {
              const attrs = parseBatchAttributeResponse(batchResponse.responses, s.id);
              relevantProperties.forEach((prop) => {
                const raw = attrs[prop];
                if (raw === null || raw === undefined) return;
                const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : `${raw}`;
                if (!normalized) return;
                const existing = siblingUniqueValues.get(prop) ?? new Set<string>();
                existing.add(normalized);
                siblingUniqueValues.set(prop, existing);
                if (prop === 'macAddress') {
                  const num = Number(raw);
                  if (!isNaN(num)) occupiedMacs.add(num);
                }
              });
            });

            return {
              siblingLabels,
              siblingUniqueValues,
              availableMacAddresses: this._computeAvailableMacs(occupiedMacs),
            };
          }),
          catchError(() => of({
            siblingLabels,
            siblingUniqueValues: new Map<import('./models/copied-object.models').MainPageUniqueProperty, Set<string>>(),
            availableMacAddresses: this._computeAvailableMacs(new Set()),
          })),
        );
      }),
    );
  }

  private _computeAvailableMacs(occupied: Set<number>): number[] {
    const available: number[] = [];
    for (let i = 4; i <= 127; i++) {
      if (!occupied.has(i)) available.push(i);
    }
    return available;
  }

  /** Paste a copied snapshot under `parentId` using the given `localUniqueIdentifier`.
   *  Returns the newly created object's ID on success, or `null` on failure. */
  public pasteSingleObject(
    snapshot: ObjectSnapshot,
    parentId: string,
    localUniqueIdentifier: string,
    overrides: Record<string, any> = {},
  ): Observable<string | null> {
    const createItem = this._buildCreatePayload(snapshot, overrides);
    if (!createItem) {
      return of(null);
    }

    const patchItem = this._buildPatchPayload(snapshot, overrides);
    const postObjReq: PostObjectsRequest = {
      parentId,
      localUniqueIdentifier,
      objectType: snapshot.objectType,
      item: createItem,
    };

    return this._objectManagerService.pasteSingleObject(postObjReq).pipe(
      concatMap((newId) => {
        if (!newId) {
          return of(null);
        }

        if (Object.keys(patchItem).length === 0) {
          return of(newId);
        }

        return this._objectManagerService.updateObject(newId, patchItem).pipe(
          map(() => newId),
        );
      }),
      tap((newId) => {
        if (newId) {
          this._navTreeService.refreshNode(parentId);
        }
      }),
      catchError((err) => {
        this._loggerService.errorSubject$.next(err);
        return of(null);
      }),
    );
  }

  public pasteChildObject(
    snapshot: ObjectSnapshot,
    newParentId: string,
    localUniqueIdentifier: string,
    overrides: Record<string, any> = {},
  ): Observable<string | null> {
    return this.pasteSingleObject(snapshot, newParentId, localUniqueIdentifier, overrides).pipe(
      catchError((err) => {
        this._loggerService.errorSubject$.next(err);
        return of(null);
      }),
    );
  }

  //TODO: If the user has selected a parent node and child nodes to that parent, we need a way to merge all of that into 1 operaiton and present that to the user as well
  //TODO: If an operation fails, allow the user to retry the operation on the dialog
  public deleteSelectedNodes(selectedNodes: string[]): Observable<any> {

    interface processErr {
      id: string,
      msg: string
    }

    return from(selectedNodes).pipe(
      concatMap<string, Observable<GetObjectsResponseItemsInner>>((deleteId) => {
        return this._navTreeService.getNode(deleteId).pipe(
          take(1),
          catchError((err) => {
            return of(err);
          }),
        );
      }),
      toArray(),
      delay(1000), //* for dev purposes
      switchMap((nodes) => {

        // Identify which selected nodes have their parent also selected — those should be ignored.
        const selectedIds = new Set(selectedNodes);
        const ignoredNodes: GetObjectsResponseItemsInner[] = [];
        const toDeleteNodes: GetObjectsResponseItemsInner[] = [];

        for (const node of nodes) {
          const parentId = node?.parentUrl?.match(lastSegment)?.[0];
          if (parentId && selectedIds.has(parentId)) {
            ignoredNodes.push(node);
          } else {
            toDeleteNodes.push(node);
          }
        }

        // For each parent that has ignored children, fetch its full child list so the user
        // can see ALL nodes that will be implicitly deleted (not just the ones they selected).
        const parentsWithIgnoredChildren = toDeleteNodes.filter(n =>
          ignoredNodes.some(ignored => ignored.parentUrl?.match(lastSegment)?.[0] === n.id)
        );

        const childrenFetch$: Observable<{ parentId: string; node: GetObjectsResponseItemsInner | null }[]> =
          parentsWithIgnoredChildren.length > 0
            ? forkJoin(parentsWithIgnoredChildren.map(parent =>
              this._navTreeService.getNode(parent.id).pipe(
                take(1),
                map(node => ({ parentId: parent.id, node })),
                catchError(() => of({ parentId: parent.id, node: null as GetObjectsResponseItemsInner | null })),
              )
            ))
            : of([]);

        return childrenFetch$.pipe(
          switchMap((childResults) => {
            const parentChildrenMap = new Map<string, GetObjectsResponseItemsInner[]>();
            childResults.forEach(({ parentId, node }) => {
              if (node && isObjectEntityInTree(node) && node.items?.length) {
                parentChildrenMap.set(parentId, node.items);
              }
            });

            const deleteMsg = ignoredNodes.length > 0
              ? `${ignoredNodes.length === 1 ? '1 selected child node' : `${ignoredNodes.length} selected child nodes`} will be ignored — deleting the parent will remove it and ALL of its child nodes. Review the details below.`
              : `Are you sure you would like to delete the currently selected network object${toDeleteNodes.length > 1 ? 's' : ''}?`;

            let responseSubs: Subscriber<any>;
            return new Observable<any>((sub: Subscriber<any>) => {
              responseSubs = sub;

              const pauseSubject$ = new BehaviorSubject<boolean>(false);
              const opStartedSubject$ = new Subject<ObjectOperationUpdate>();

              let testErrcounter = 0; //!

              const deleteOp$: Observable<ObjectOperationUpdate> = from(toDeleteNodes).pipe(
                concatMap((node) => {
                  testErrcounter++;
                  return pauseSubject$.pipe(
                    filter(paused => !paused),
                    take(1),
                    switchMap(() => {
                      const parentId = node?.parentUrl?.match(lastSegment)![0];
                      const deleteId = node.id;
                      if (!parentId) {
                        opStartedSubject$.next({
                          objectId: deleteId,
                          status: 'Processing',
                        });
                        throw { id: node.id, msg: `Selected node does not have a valid parent id` } as processErr;
                      } else {
                        if (testErrcounter % 2 == 0) { //!
                          opStartedSubject$.next({ //!
                            objectId: deleteId, //!
                            status: 'Processing', //!
                          }); //!
                          throw { id: deleteId, msg: `Test error!` } as processErr; //!
                        } //!

                        return of(deleteId).pipe(
                          delay(1000),
                          tap(id => this.DEV_DELETELIST.push(id)),
                        ).pipe( //!DEV
                          // return this._objectManagerService.deleteObject(deleteId).pipe(//TODO: un-comment this line after we're done testing function
                          tap({
                            subscribe: () => {
                              opStartedSubject$.next({
                                objectId: deleteId,
                                status: 'Processing',
                              });
                            },
                          }),

                          tap(() => {
                            console.log(`Deleted Node: ${node.name}`);

                            this._navTreeService.removeFromDisplay$.next(deleteId);
                            this._navTreeService.navTreeCache.delete(deleteId);
                            this._navTreeService.refreshNode(parentId);

                          }),
                          map((err) => {
                            const errorResult: ObjectOperationUpdate = {
                              objectId: deleteId,
                              status: 'Success'
                            }
                            return errorResult;
                          }),
                        );

                      }
                    }),
                    catchError((err) => {
                      if (err.id && err.msg) {
                        err = err as processErr;
                        const errorResult: ObjectOperationUpdate = {
                          objectId: err.id,
                          message: err.msg,
                          status: 'Error'
                        }
                        return of(errorResult);
                      }
                      const errMsg = this._loggerService.getErrorMsg(err);
                      const errorResult: ObjectOperationUpdate = {
                        objectId: node.id,
                        message: errMsg,
                        status: 'Error'
                      }
                      return of(errorResult);
                    }),
                  )

                }),
                tap({
                  complete: () => {
                    opStartedSubject$.complete();
                  },
                }),
              );

              const doSomething$ = merge(opStartedSubject$, deleteOp$).pipe(
                tap((data) => {
                  console.log(data);
                }),
              );

              const retryFn = (objectId: string): Observable<ObjectOperationUpdate> => {
                const node = toDeleteNodes.find(n => n.id === objectId);
                if (!node) {
                  return of({ objectId, status: 'Error', message: 'Node not found for retry' } as ObjectOperationUpdate);
                }
                const parentId = node.parentUrl?.match(lastSegment)?.[0];
                if (!parentId) {
                  return of({ objectId, status: 'Error', message: 'Selected node does not have a valid parent id' } as ObjectOperationUpdate);
                }
                // return this._objectManagerService.deleteObject(objectId).pipe(//TODO: un-comment this line after we're done testing function
                return concat(
                  of({ objectId, status: 'Processing' } as ObjectOperationUpdate),
                  of(objectId).pipe(
                    delay(1000), //!
                    exhaustMap((id) => {
                      console.log(`Retried delete for Node: ${node.name}`);
                      this._navTreeService.removeFromDisplay$.next(objectId);
                      this._navTreeService.navTreeCache.delete(objectId);
                      this._navTreeService.refreshNode(parentId);
                      return of({ objectId, status: 'Success' } as ObjectOperationUpdate);
                    }),
                    catchError((err) => {
                      let errMsg: string;
                      try {
                        errMsg = this._loggerService.getErrorMsg(err);
                      } catch {
                        errMsg = err.msg ?? 'Unknown error during retry';
                      }
                      return of({ objectId, status: 'Error', message: errMsg } as ObjectOperationUpdate);
                    }),
                  ),
                );
              };

              const deleteDialogData: ActionWarnEvent = {
                operation: 'delete',
                message: deleteMsg,
                doSomething: 'Delete',
                nodes: toDeleteNodes,
                ignoredNodes: ignoredNodes.length > 0 ? ignoredNodes : undefined,
                parentChildrenMap: parentChildrenMap.size > 0 ? parentChildrenMap : undefined,
                doSomethingFn$: doSomething$,
                retryFn,
                pause$: pauseSubject$,
                res$: responseSubs
              };

              this.deleteDialogSubject$.next(deleteDialogData);

            });
          }),
        );
      }),
    )
  }

}
