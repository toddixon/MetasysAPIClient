import { HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { LoggerService } from './logger.service';
import { RequestPriority, RequestQueueService } from './requestQueue.service';
import { Classification, GetObjectAttributeResponse, NetworkDevices, NetworkDevicesService, ObjectsService, PostObjectsBatch200Response, PostObjectsBatch200ResponseResponsesInner, PostObjectsBatchRequest, PostObjectsBatchRequestRequestsInner } from './api';
import { map, Observable, of, switchMap, tap, throwError } from 'rxjs';
import { StreamService } from './stream.service';
import { classificationTypes } from './models/api-object.models';
import { environment } from '../environments/environment.development';

export interface ObjectStatusBatchTarget {
  objectId: string;
  classification?: Classification | string;
}

export interface ObjectStatusState {
  status?: string;
  alarmState?: string;
}

export interface ObjectStatusBatchSubscription {
  subscriptionLocation: string;
  initialStates: Map<string, ObjectStatusState>;
}

@Injectable({
  providedIn: 'root',
})
export class NetworkDeviceManagerService {
  private _networkService = inject(NetworkDevicesService);
  private _objectsService = inject(ObjectsService);
  private _streamService = inject(StreamService)
  private _queueService = inject(RequestQueueService);
  private _loggerService = inject(LoggerService);
  public hostnameDevicehost = new RegExp(/^[^/]+:[^/:]+$/)//Only matches "{hostname}:{deviceHostname}",
  // public

  constructor() {
    // this.getNetworkDevices(['device']).pipe(
    //   map((devices) => {
    //     let f = devices;
    //     devices.items.forEach(item => {
          
    //     })
    //   })
    // ).subscribe();

  }

  public getStatusAttributeName(classification?: Classification | string): 'status' | 'presentValue' {
    return classification === Classification.Controller ? 'presentValue' : 'status';
  }

  public buildObjectStatusBatchRequests(targets: ObjectStatusBatchTarget[]): Array<PostObjectsBatchRequestRequestsInner> {
    return targets.flatMap(({ objectId, classification }) => {
      const statusAttribute = this.getStatusAttributeName(classification);
      return [
        {
          id: `${objectId}:status`,
          relativeUrl: `${objectId}/attributes/${statusAttribute}`,
        },
        {
          id: `${objectId}:alarmState`,
          relativeUrl: `${objectId}/attributes/alarmState`,
        },
      ];
    });
  }

  public parseObjectStatusBatchResponse(
    batch: PostObjectsBatch200Response | Array<PostObjectsBatch200ResponseResponsesInner>,
  ): Map<string, ObjectStatusState> {
    const responses = Array.isArray(batch) ? batch : batch.responses;
    const statusMap = new Map<string, ObjectStatusState>();

    responses.forEach((response) => {
      if (response.status !== 200 || !response.body) {
        return;
      }

      const separatorIndex = response.id.lastIndexOf(':');
      if (separatorIndex === -1) {
        return;
      }

      const objectId = response.id.slice(0, separatorIndex);
      const attributeId = response.id.slice(separatorIndex + 1);
      const body = response.body as GetObjectAttributeResponse;

      if (!body.item || typeof body.item !== 'object') {
        return;
      }

      const item = body.item as Record<string, string | undefined>;
      const current = statusMap.get(objectId) ?? {};

      if (attributeId === 'status') {
        current.status = item['status'] ?? item['presentValue'];
      } else if (attributeId === 'alarmState') {
        current.alarmState = item['alarmState'];
      }

      statusMap.set(objectId, current);
    });

    return statusMap;
  }

  public fetchCurrentObjectsStatus(
    targets: ObjectStatusBatchTarget[],
    priority: RequestPriority = 'background',
  ): Observable<Map<string, ObjectStatusState>> {
    if (targets.length === 0) {
      return of(new Map<string, ObjectStatusState>());
    }

    const requestBody: PostObjectsBatchRequest = {
      method: 'GET',
      requests: this.buildObjectStatusBatchRequests(targets),
    };

    return this._queueService.request<PostObjectsBatch200Response>(
      () => this._objectsService.postObjectsBatch(requestBody),
      { priority },
    ).pipe(
      map((res) => this.parseObjectStatusBatchResponse(res)),
    );
  }

  public subscribeToObjectsStatus(
    targets: ObjectStatusBatchTarget[],
    priority: RequestPriority = 'background',
  ): Observable<ObjectStatusBatchSubscription> {
    if (targets.length === 0) {
      return throwError(() => 'Cannot subscribe to object status without targets');
    }

    const lastEventId = localStorage.getItem(environment.storageKeys.streamId)!;
    const requestBody: PostObjectsBatchRequest = {
      method: 'GET',
      requests: this.buildObjectStatusBatchRequests(targets),
    };

    return this._queueService.request<HttpResponse<PostObjectsBatch200Response>>(
      () => this._objectsService.postObjectsBatch(requestBody, lastEventId, 'response'),
      { priority },
    ).pipe(
      switchMap((res) => {
        const subscriptionLocation = res.headers.get('metasys-subscription-location');
        if (!subscriptionLocation) {
          return throwError(() => `No subscription location header returned for object status batch (${targets.length} targets)`);
        }

        return of({
          subscriptionLocation,
          initialStates: this.parseObjectStatusBatchResponse(res.body?.responses ?? []),
        });
      }),
    );
  }

  public initObjectStatus() {
    // this._networkService.getNetworkDevices().pipe(
    //   map((devices) => {

    //   })
    // )
  }






  public getNetworkDevices(
    classification: Array<'device' | 'integration' | 'server' | 'controller'> = ['device'],
    priority: RequestPriority = 'background',
  ): Observable<NetworkDevices> {
    return this._queueService.request<NetworkDevices>(
      () => this._networkService.getNetworkDevices(undefined, undefined, undefined, undefined, classification),
      { priority },
    ).pipe(
      tap((data) => {
        data.items;
      }),
    )
  }

  public fetchCurrentObjectStatus(
    objectId: string,
    classification?: Classification | string,
    priority: RequestPriority = 'background',
  ): Observable<{ status?: string; alarmState?: string }> {
    return this.fetchCurrentObjectsStatus([{ objectId, classification }], priority).pipe(
      map((statusMap) => statusMap.get(objectId) ?? {}),
    );
  }

  public subscribeToObjectStatus(
    objectId: string,
    classification?: Classification | string,
    priority: RequestPriority = 'background',
  ): Observable<string> {
    return this.subscribeToObjectsStatus([{ objectId, classification }], priority).pipe(
      map(({ subscriptionLocation }) => this._streamService.addStatusSubscription(objectId, subscriptionLocation)),
    );
  }

  public listenToStatusBatch() {
    //
  }

  public isNetworkDevice(fqr: string, classification: classificationTypes): boolean {
    return classification == 'device' && this.hostnameDevicehost.test(fqr);
  }

  //Deletes an engine or a server which is a child device of the site director. 
  // Cannot be used to delete controllers, integrations, or the site director.
  public deleteNetworkDevice(networkDeviceId: string): Observable<any> {
    return this._networkService.deleteNetworkDevice(networkDeviceId);
  }




}
