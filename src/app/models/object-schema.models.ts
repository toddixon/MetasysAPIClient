// import { ObjectView } from "./object-views.models";
import { DataTypeMetaSchema, GetObject200Response, GetObjectTypeSchema200Response } from "../api";
import { DisplayPrecisionEnumSet } from "./display.models";

// export interface ObjectSchema {
//   schema: Schema;
//   views: ObjectView[];
// }

export interface Schema {
  type: string;
  $schema: string;
  language: string;
  title: string;
  version: string;
  $id: string;
  properties: SchemaProperties;
  definitions?: Definitions;
  required: string[];
}


export function isSchema(obj: unknown): obj is Schema {
  if (typeof obj !== 'object' || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s['type'] === 'string' &&
    typeof s['$schema'] === 'string' &&
    typeof s['language'] === 'string' &&
    typeof s['title'] === 'string' &&
    typeof s['version'] === 'string' &&
    typeof s['$id'] === 'string' &&
    typeof s['properties'] === 'object' &&
    // typeof s['definitions'] === 'object' &&//! Not all schemas have this property.
    Array.isArray(s['required'])
  );
}

export interface ItemAndSchema {
  item: GetObject200Response,
  typeSchema: GetObjectTypeSchema200Response
}


export interface Definitions {
  "object-reference": ObjectReference;
  "attribute-reference": AttributeReference;
}


export interface FloatSchemaProperty {
  title: string,
  metasysType: 'float',
  type: 'number',
  prioritized?: boolean,
  readOnly?: boolean,
  dynamic?: boolean,
  minimum: number,
  minPresValueSource?: string,
  maximum: number,
  maxPresValueSource?: string,
  displayPrecision?: SchemaPrecision,
  displayPrecisionSource?: string,
  unit?: SchemaUnits,
  unitsSource?: string,
}


export type SourceKeys<T> = Extract<
  keyof T,
  `${string}Source`
>;


export type FloatSourceProperties = SourceKeys<FloatSchemaProperty>;

export function isFloatSourceProperty(str: unknown): str is FloatSourceProperties {
  if (typeof str !== 'string') return false;
  return (
    str === 'minPresValueSource' ||
    str === 'maxPresValueSource' ||
    str === 'unitsSource' ||
    str === 'displayPrecisionSource'
  );

}

export type SourceInitValueProperties = Pick<FloatSchemaProperty, 'minimum' | 'maximum' | 'unit' | 'displayPrecision'>;

export function GetSourceInitValueProperty(sourceProperty: FloatSourceProperties): keyof SourceInitValueProperties | void {
  switch (sourceProperty) {
    case 'minPresValueSource':
      return 'minimum';
    case 'maxPresValueSource':
      return 'maximum';
    case 'unitsSource':
      return 'unit';
    case 'displayPrecisionSource':
      return 'displayPrecision';
    default:
      return
  }
}

export type SchemaPrecision = {
  id: keyof typeof DisplayPrecisionEnumSet,
  displayMultipleOf: number,
}

export function isSchemaPrecision(obj: unknown): obj is SchemaPrecision {
  if (typeof obj !== 'object' || obj === null) return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p['id'] === 'string' &&
    typeof p['displayMultipleOf'] === 'number'
  );
}

export type SchemaUnits = {
  id: string,
  title: string,
}

export function isSchemaUnits(obj: unknown): obj is SchemaUnits {
  if (typeof obj !== 'object' || obj === null) return false;
  const u = obj as Record<string, unknown>;
  return (
    typeof u['id'] === 'string' &&
    typeof u['title'] === 'string'
  );
}

export function isFloatSchemaProperty(obj: unknown): obj is FloatSchemaProperty {
  if (typeof obj !== 'object' || obj === null) return false;
  const prop = obj as Record<string, unknown>;
  return (
    typeof prop['title'] === 'string' &&
    prop['metasysType'] === 'float' &&
    prop['type'] === 'number' &&
    typeof prop['minimum'] === 'number' &&
    typeof prop['maximum'] === 'number'
  );
}



export interface AttributeReference {
  $schema: string;
  $id: string;
  title: string;
  type: string;
  metasysType: string;
  allOf: AttributeReferenceAllOf[];
}

export interface AttributeReferenceAllOf {
  $ref?: string;
  type?: string;
  required?: string[];
  properties?: AllOfProperties;
}

export interface AllOfProperties {
  attribute: Attribute;
  referencedObject: PurpleReferencedObject;
}

export interface Attribute {
  $ref: string;
}

export interface PurpleReferencedObject {
  readOnly: boolean;
  type: string;
  properties: PurpleProperties;
}

export interface PurpleProperties {
  attributeUrl: AttributeURL;
  attributeName: AttributeName;
}

export interface AttributeName {
  type: string;
  metasysType: string;
}

export interface AttributeURL {
  type: string;
  metasysType: string;
  format: string;
}

export interface ObjectReference {
  $schema: string;
  $id: string;
  title: string;
  type: string;
  oneOf: ObjectReferenceOneOf[];
}

export interface ObjectReferenceOneOf {
  properties: OneOfProperties;
  required: string[];
  additionalProperties?: boolean;
}

export interface OneOfProperties {
  objectReference?: Object;
  referencedObject?: FluffyReferencedObject;
  objectBACoid?: BaCoid;
  deviceAddress?: DeviceAddress;
  deviceBACoid?: BaCoid;
}

export interface DeviceAddress {
  readOnly: boolean;
  type: string;
}

export interface BaCoid {
  readOnly: boolean;
  oneOf: Attribute[];
}

export interface Object {
  format: string;
  type: string;
}

export interface FluffyReferencedObject {
  type: string;
  properties: FluffyProperties;
  readOnly: boolean;
}

export interface FluffyProperties {
  objectName: OneOf;
  objectUrl: Object;
}

export interface OneOf {
  type: string;
}

export interface SchemaProperties {
  name: Name;
  defaultAttribute: string;
  description: Description;
  bacnetObjectType: BacnetObjectType;
  objectCategory: ObjectCategory;
  prioritySupported: PrioritySupported;
  minPresValue: CovIncrement;
  maxPresValue: CovIncrement;
  units: BacnetObjectType;
  displayPrecision: Ion;
  covIncrement: CovIncrement;
  relinquishDefault: CovIncrement;
  restoreCommandPriority: RestoreCommandPriority;
  connectedTo: ConnectedTo;
  direction: Ion;
  priorityForWritingToConnected: CovIncrement;
  overrideExpirationTime: object;
  version: object;
}

export type GenericSchemaProperty = { [K in keyof SchemaProperties]: SchemaProperties[K] }[keyof SchemaProperties];

export interface BacnetObjectType {
  title: string;
  readOnly?: boolean;
  allOf: AllOf[];
  default: string;
}



export interface AllOf {
  type?: string;//* 'string' | 'boolean' | 'object' | 'number' | 'integer' | 'array' | 'null'
  metasysType?: string;//* 'enum' | 'bool' | 'string' | 'float' | 'time' | 'byte' | 'ushort' | 'listof' | 'array' | 'attributeReference'
  $ref?: string;//* URL to fetch enum set for attribute
  lastMember?: string;
  enum?: Array<string>;
}


export type MetasysTypes = [
  "string",
  "any",
  "array",
  "attributeReference",
  "bitString",
  "bacOid",
  "bool",
  "byte",
  "choice",
  "date",
  "double",
  "enum",
  "enumMemberId",
  "flags",
  "float",
  "list",
  "listof",
  "long",
  "none",
  "numeric",
  "objectReference",
  "octetString",
  "oid",
  "short",
  "string",
  "struct",
  "time",
  "ulong",
  "ushort"
]

//* MetasysType structure
//* listof: [object Object]
//* array: [object Object], [object, Object], [object, Object], ...

export interface ConnectedTo {
  title: string;
  oneOf: ConnectedToOneOf[];
  metasysType: string;
  attributeFilter: string;
}

export interface ConnectedToOneOf {
  type?: string;
  $ref?: string;
}

export interface CovIncrement {
  title: string;
  unitsSource?: string;
  metasysType: string;
  type: string;
  minimum: number;
  maximum: number;
  default: number;
  displayPrecisionSource?: string;
  displayPrecision?: DisplayPrecision;
  maxPresValueSource?: string;
  minPresValueSource?: string;
}

export interface DisplayPrecision {
  id: string;
  displayMultipleOf: number;
}

export interface Description {
  title: string;
  oneOf: OneOf[];
  metasysType: string;
  maxLength: number;
}

export interface Ion {
  title: string;
  numberOfStates: number;
  allOf: AllOf[];
  default: string;
}

export interface Name {
  title: string;
  category: string;
  type: string;
  metasysType: string;
  maxLength: number;
  default: string;
}

export interface ObjectCategory {
  title: string;
  category: string;
  numberOfStates: number;
  allOf: AllOf[];
  default: string;
}

export interface PrioritySupported {
  title: string;
  type: string;
  metasysType: string;
  default: boolean;
}

export interface RestoreCommandPriority {
  title: string;
  category: string;
  type: string;
  metasysType: string;
  maxItems: number;
  minItems: number;
  items: Items;
  uniqueItems: boolean;
  default: Array<Array<boolean | string>>;
}

export interface Items {
  type: string;
  items: Item[];
}

export interface Item {
  allOf?: ItemAllOf[];
  type?: string;
}

export interface ItemAllOf {
  $ref?: string;
  enum?: string[];
}