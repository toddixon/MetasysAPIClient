import { Classification, GetObjectAttributeResponse, GetObjectTypeSchema200Response, PostObjectsBatch200Response, PostObjectsBatch200ResponseResponsesInner } from '../api';
import { ItemSelectedData } from './event.models';
import { isSchema, Schema } from './object-schema.models';

export const MAIN_PAGE_UNIQUE_PROPERTIES = ['instanceNumber', 'macAddress', 'trunkNumber'] as const;

export type MainPageUniqueProperty = typeof MAIN_PAGE_UNIQUE_PROPERTIES[number];

export interface ObjectSnapshot {
  sourceObjectId: string;
  sourceParentId: string | null;
  objectType: string;
  classification?: Classification;
  name: string;
  label: string;
  itemReference: string;
  hasChildrenMatchingQuery: boolean;
  schemaResponse: GetObjectTypeSchema200Response;
  batchAttributeResponse: PostObjectsBatch200Response;
}

export interface objectWithTypeSchema {
  object: ItemSelectedData,
  schema: GetObjectTypeSchema200Response
}

export function getCopiedObjectSchema(snapshot: ObjectSnapshot): Schema | null {
  return isSchema(snapshot.schemaResponse.schema) ? snapshot.schemaResponse.schema : null;
}

export function getMainPageUniqueProperties(snapshot: ObjectSnapshot): MainPageUniqueProperty[] {
  const schema = getCopiedObjectSchema(snapshot);
  if (!schema) {
    return [];
  }

  return MAIN_PAGE_UNIQUE_PROPERTIES.filter((property): property is MainPageUniqueProperty => {
    return schema.required.includes(property) && property in schema.properties;
  });
}

/**
 * Parses the batch attribute response for a single object, returning a flat map of
 * propertyName → value. Response IDs have the format `objectId:propertyName`.
 */
export function parseBatchAttributeResponse(batch: PostObjectsBatch200Response | PostObjectsBatch200ResponseResponsesInner[], objectId: string): Record<string, any> {
  const responses = Array.isArray(batch) ? batch : batch.responses;
  const prefix = `${objectId}:`;
  const result: Record<string, any> = {};
  for (const response of responses) {
    if (!response.id.startsWith(prefix) || response.status !== 200 || !response.body) {
      continue;
    }
    const propertyName = response.id.slice(prefix.length);
    const body = response.body as GetObjectAttributeResponse;
    if (body.item && typeof body.item === 'object') {
      const itemMap = body.item as Record<string, any>;
      result[propertyName] = itemMap[propertyName];
    }
  }
  return result;
}
