import { ObjectTypes } from "../models/api-object.models"
import { ObjectAttributeIDs } from "../models/object-attribute.models"

export const authRoutes = {
  login: '/login',
  refresh: '/refreshToken',
}

export const objectRoutes = {
  objects: '/objects',
  objectById: (id: string) => `/objects/${id}`,
  objectChildren: (id: string) => `/objects/${id}/objects`,
  objectParents: (id: string) => `/objects/${id}/parents`,
  objectSchema: (type: ObjectTypes) => `/schemas/objectTypes/${type}`,
  supportedChildTypes: (id: string) => `/objects/${id}/supportedChildTypes`,

  getAttributeValue: (id: string, attributeId: ObjectAttributeIDs = 'presentValue') => `/objects/${id}/attributes/${attributeId}`,
  listAttributes: (id: string) => `/objects/${id}/attributes`,
  attributeSamplesBuffer: (id: string, attributeId: ObjectAttributeIDs = 'presentValue') => `/objects/${id}/trendAttributes/${attributeId}/samples`,
  attributeSamplesRepo: (id: string, attributeId: ObjectAttributeIDs = 'presentValue') => `/timeSeries/${id}/trendAttributes/${attributeId}/samples`,
  subscriptionLocation: (eventId: string, subscriptionId: string) => `objects/streams/${eventId}/subscriptions/${subscriptionId}`
}

export const childObjectsParams = { depth: '2' }

export const networkObjectRoutes = {
  listDevices: '/networkDevices',
  listChildren: (id: string) => `networkDevices/${id}/networkDevices`,
}

export const spaceRoutes = {
  spaces: '/spaces',
  spacesSubtree: (id: string) => `/spaces/${id}`
}

export const streamRoutes = {
  stream: '/stream',
  samples: '/samples'
};

export const lastSegment = new RegExp(/[^/]*$/);

export const matchAllAfterfirstDot = new RegExp(/(?<=\.).*/);

export const streamHeaders = {
  lastEventId: 'Last-Event-Id',
  meatasysSubscribe: 'METASYS-SUBSCRIBE',
  subscriptionLocation: 'METASYS-SUBSCRIPTION-LOCATION'
};

export const apiVersions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];

// {
//   v1: '/v1',
//   v2: '/v2',
//   v3: '/v3',
//   v4: '/v4',
//   v5: '/v5',
//   v6: '/v6',
// }

export type reqObserve = 'body' | 'response' | 'events';

export interface ReqOptions {
  withCredentials: boolean;
  observe: reqObserve;
  responseType?: 'arraybuffer' | 'blob' | 'json' | 'text';
}

export const reqOptions: ReqOptions = {
  withCredentials: true,
  observe: 'body',
  responseType: 'json'
}

export const subReqOpts: ReqOptions = {
  withCredentials: true,
  observe: 'response',
  responseType: 'text'
}


