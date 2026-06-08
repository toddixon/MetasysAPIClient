import { HttpClient, HttpHeaders, HttpParams, HttpParamsOptions, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ObjectTypes } from './models/api-object.models';
import { BehaviorSubject, catchError, concat, concatMap, count, defer, delay, exhaustMap, filter, from, iif, map, Observable, of, retry, shareReplay, switchMap, take, tap, throwError, timer } from 'rxjs';
import { childObjectsParams, lastSegment, networkObjectRoutes, objectRoutes, ReqOptions, reqOptions, streamHeaders, subReqOpts } from './constants/api.constants';
import { NetworkDevice } from './models/networkObject.models';
import { RequestPriority, RequestQueueService } from './requestQueue.service';
// import { CreateObjectBody, GetObjectQueryParams, GetObjectTypeSchemaQueryParams, SampleQueryParams } from './models/api-body.models';
import { toHttpParams } from './helpers/httpParams';
import { LoggerService } from './logger.service';
import { environment } from '../environments/environment.development';
import { daySubtractor } from './helpers/dates';
import { StreamService } from './stream.service';
import { ObjectSubscription } from './models/stream.models';
import { ObjectAttributeIDs, ObjectAttributes } from './models/object-attribute.models';
import { EnumMember, EnumSet } from './models/enum-set.models';
import { GetObject200Response, GetObjectAttributeResponse, GetObjectAttributes200Response, GetObjectCommands200Response, GetObjectCommands200ResponseItemsInner, GetObjectsResponse, GetObjectSupportedChildTypes200ResponseInner, GetObjectTypeSchema200Response, GetObjectViews200Response, ObjectEntityInTree, ObjectMinimalList, ObjectsService, ObjectsStreamValuesUpdateInner, PatchObjectRequest, PostObjectsBatch200Response, PostObjectsBatchRequest, PostObjectsBatchRequestRequestsInner, PostObjectsRequest, PutCommandRequest, SchemasService } from './api';
import { CommandPriorityEntry } from './models/objectCommand.models';
import { Schema } from './models/object-schema.models';

@Injectable({
  providedIn: 'root'
})
export class ObjectManagerService {
  private _objectsService = inject(ObjectsService);
  private _schemaService = inject(SchemasService);
  private _queueService = inject(RequestQueueService);
  private _loggerService = inject(LoggerService);
  private _streamService = inject(StreamService);
  private _enumSetStorage: Map<string, Observable<EnumSet>> = new Map();

  private getNumericParam(params: HttpParams | undefined, key: string): number | undefined {
    const value = params?.get(key);
    if (value == null || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private getBooleanParam(params: HttpParams | undefined, key: string): boolean | undefined {
    const value = params?.get(key);
    if (value == null || value === '') {
      return undefined;
    }

    return value === 'true';
  }

  public getChildObjects(
    objectId?: string | null,
    params?: HttpParams,
    priority: RequestPriority = 'interactive',
  ): Observable<GetObjectsResponse> {
    const depth = this.getNumericParam(params, 'depth');
    const flatten = this.getBooleanParam(params, 'flatten');
    const includeExtensions = this.getBooleanParam(params, 'includeExtensions');
    const pathTo = params?.get('pathTo') ?? undefined;
    const includeEffectivePermissions = this.getBooleanParam(params, 'includeEffectivePermissions');
    const objectType = params?.getAll('objectType') ?? undefined;
    const classification = params?.getAll('classification') as Array<
      'object' | 'device' | 'integration' | 'controller' | 'point' | 'site' | 'navList' | 'extension' | 'folder' | 'reference' | 'server' | 'archive'
    > | undefined;

    return this._queueService.request<GetObjectsResponse>(
      () =>
        objectId
          ? this._objectsService.getChildObjects(
            objectId,
            depth,
            flatten,
            includeExtensions,
            pathTo,
            objectType,
            classification,
            includeEffectivePermissions,
          )
          : this._objectsService.getObjects(depth, flatten, includeExtensions, pathTo, includeEffectivePermissions),
      { priority },
    ).pipe(
      // map((data) => {
      //   if (data.items[0].name == '') {
      //     data.items[0].name = data.items[0].label;
      //   }
      //   return data;
      // }),
    )
  }

  public getObject(objectId: string, includeSchema: boolean = true, bypassQueue: boolean = false): Observable<GetObject200Response> {
    return this._queueService.request<GetObject200Response>(() => this._objectsService.getObject(objectId, undefined, includeSchema), bypassQueue);
  }


  public getObjectTypeSchema(objectType: string, parent: string, bypassQueue: boolean = false): Observable<GetObjectTypeSchema200Response> {
    return this._queueService.request<any>(() => this._schemaService.getObjectTypeSchema(objectType, parent), bypassQueue);
  }

  public getObjectViews(objectId: string): Observable<GetObjectViews200Response> {
    return this._queueService.request<GetObjectViews200Response>(() => this._objectsService.getObjectViews(objectId));
  }

  public getObjectView(objectId: string, viewId: string): Observable<GetObject200Response> {
    return this._queueService.request<GetObject200Response>(() =>
      this._objectsService.getObject(objectId, viewId, true)
    );
  }

  public listSupportedChildTypes(objectId: string): Observable<Array<GetObjectSupportedChildTypes200ResponseInner>> {
    return this._queueService.request<Array<GetObjectSupportedChildTypes200ResponseInner>>(() => this._objectsService.getObjectSupportedChildTypes(objectId));
  }

  public watchAttributeValue(objectId: string, attributeId: ObjectAttributeIDs): Observable<any> {
    const objSubscription = this._streamService.checkSubscription(objectId, attributeId);
    if (objSubscription) {
      this._loggerService.info(`Object Attribute Subscription: Existing subscription found for ${objSubscription.attribute} attribute: ${objSubscription.subscriptionId}`);
      return this.getAttributeValue(objectId, attributeId, false).pipe(
        concatMap((res) => concat(of(res), this._streamService.listenToValueUpdates(objSubscription.subscriptionId))),
      )
    } else {
      this._loggerService.info(`Object Attribute Subscription: Creating new subscription for object (${objectId}) ${attributeId} attribute`);
      return this._queueService.request<HttpResponse<GetObjectAttributeResponse>>(() => this._objectsService.getObjectAttribute(objectId, attributeId, true, localStorage.getItem(environment.storageKeys.streamId)!, 'response')).pipe(
        tap({
          subscribe: () => console.log('getObjectAttributeSubscribe Subscribed to'),
          unsubscribe: () => console.log('getObjectAttributeSubscribe Unsubscribed to'),
          complete: () => console.log('getObjectAttributeSubscribe Completed!'),
        }),
        switchMap((res) => {
          const subscriptionLocation: string | null = res.headers.get('metasys-subscription-location');
          if (!subscriptionLocation) {
            return throwError(() => 'Subscription location header not present');
          }
          let subscriptionId = this._streamService.addSubscription(objectId, subscriptionLocation, attributeId);
          return of(subscriptionId);

        }),

        switchMap((sid) => this._streamService.listenToValueUpdates(sid)),
        retry({ count: environment.queryRetryCount, delay: environment.queryRetryDelay }),
      );
    }

  }

  public buildBatchRequestInner(objectId: string, properties: string[]): Array<PostObjectsBatchRequestRequestsInner> {
    const request: Array<PostObjectsBatchRequestRequestsInner> = [];
    properties.forEach((p, idx) => {
      const requestInner: PostObjectsBatchRequestRequestsInner = {
        id: `${objectId}:${p}`,
        // id: (requestBody.requests.length + 1).toString(),
        relativeUrl: `${objectId}/attributes/${p}`
      }
      request.push(requestInner);
    });
    return request;

  }

  public fetchAttributesBatch(requests: PostObjectsBatchRequestRequestsInner[]): Observable<PostObjectsBatch200Response> {
    const requestBody: PostObjectsBatchRequest = {
      method: 'GET',
      requests,
    };
    return this._queueService.request<PostObjectsBatch200Response>(
      () => this._objectsService.postObjectsBatch(requestBody),
    );
  }

  public getAttributesBatch(objectId: string, properties: Array<string>, subscribe: boolean = true): Observable<Array<ObjectsStreamValuesUpdateInner>> {
    const objSubscription = this._streamService.checkSubscription(objectId);
    const lastEventId = localStorage.getItem(environment.storageKeys.streamId)!;
    if (objSubscription) {
      return this._streamService.listenToValueUpdates(objSubscription.subscriptionId);
    } else {
      let requestBody: PostObjectsBatchRequest = {
        method: 'GET',
        requests: [],
      };
      // properties.forEach((p, idx) => {
      //   const requestInner: PostObjectsBatchRequestRequestsInner = {
      //     id: (requestBody.requests.length + 1).toString(),
      //     relativeUrl: `${objectId}/attributes/${p}`
      requestBody.requests = this.buildBatchRequestInner(objectId, properties);

      //   requestBody.requests.push(requestInner);


      return this._queueService.request<HttpResponse<PostObjectsBatch200Response>>(() => this._objectsService.postObjectsBatch(requestBody, lastEventId, 'response')).pipe(
        switchMap((res) => {
          const subscriptionLocation: string | null = res.headers.get('metasys-subscription-location');
          if (!subscriptionLocation) {
            return throwError(() => 'Subscription location header not present');
          }
          let subscriptionId = this._streamService.addSubscription(objectId, subscriptionLocation);
          return of(subscriptionId);
        }),
        switchMap((sid) => this._streamService.listenToValueUpdates(sid)),
        filter(updates => updates.length > 0),
        retry({ count: environment.queryRetryCount, delay: environment.queryRetryDelay }),
      );

    }

  }

  public getObjectCommands(objectId: string): Observable<Array<GetObjectCommands200ResponseItemsInner>> {
    return this._queueService.request(() => this._objectsService.getObjectCommands(objectId)).pipe(
      map((res) => res.items)
    );
  }

  public executeCommand(objectId: string, commandId: string, commandRequest: PutCommandRequest): Observable<any> {
    return this._queueService.request(() => this._objectsService.putObjectCommand(objectId, commandId, commandRequest));
  }

  public listObjectAttributes(objectId: string): Observable<GetObjectAttributes200Response> {
    return this._queueService.request<GetObjectAttributes200Response>(() => this._objectsService.getObjectAttributes(objectId));
  }

  public getAttributeValue(objectId: string, attributeId: string, subscribe: boolean = false): Observable<GetObjectAttributeResponse> {
    const sub = subscribe ? localStorage.getItem(environment.storageKeys.streamId)! : undefined;
    return this._queueService.request<GetObjectAttributeResponse>(() => this._objectsService.getObjectAttribute(objectId, attributeId, false, sub));
  }

  public pasteObjects(objReq: PostObjectsRequest): Observable<any> {
    return this._queueService.request(() => this._objectsService.postObjects(objReq));
  }

  /** Paste an object and return the newly created object's ID from the Location response header. */
  public pasteSingleObject(objReq: PostObjectsRequest): Observable<string | null> {
    return this._queueService.request<HttpResponse<any>>(() =>
      this._objectsService.postObjects(objReq, 'response')
    ).pipe(
      map((response: HttpResponse<any>) => {
        const location = response.headers.get('Location');
        return location ? location.match(/[^/]*$/)?.[0] ?? null : null;
      }),
    );
  }

  public deleteObject(objectId: string): Observable<any> {
    return this._queueService.request(() => this._objectsService.deleteObject(objectId));
  }

  public updateObject(objectId: string, changedValues: Record<string, any>): Observable<any> {
    return this._queueService.request(() => this._objectsService.patchObject(objectId, { item: changedValues })).pipe(
      tap((data) => {
        console.log(data);
      }),
    );
  }

  public copyPropertiesToSchema(item: GetObject200Response, schema: Schema) {

  };

  // public listTrendedAttributes(route: string): Observable<any> {
  //   return this._queueService.get<any>(route);// Takes the `trendedAttributesURL`
  // }


  public getEnumSet(ref: string, params?: HttpParams,
    priority: RequestPriority = 'interactive',): Observable<EnumSet> {
    const setName = ref.match(lastSegment)![0].split('?')[0];
    if (!this._enumSetStorage.get(setName)) {
      const set$ = this._queueService.request(
        () => this._schemaService.getEnumerationAsJsonSchema(setName).pipe(
          map((res) => res as EnumSet),
        ),
        { priority }
      ).pipe(
        tap({ error: () => this._enumSetStorage.delete(setName) }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this._enumSetStorage.set(setName, set$);
    }
    return this._enumSetStorage.get(setName)!;
  }

  public getObjectIdentifier(fqr: string): Observable<string> {
    return this._queueService.request<string>(() => this._objectsService.getObjectsIdentifiers(fqr));
  }

  public getObjectsPathTo(pathTo: string): Observable<GetObjectsResponse> {
    return this._queueService.request<GetObjectsResponse>(() =>
      this._objectsService.getObjects(undefined, undefined, undefined, pathTo)
    );
  }

}
