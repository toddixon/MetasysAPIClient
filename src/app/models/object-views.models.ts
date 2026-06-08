import { FormControl, FormGroup } from "@angular/forms";
import { EnumMember, EnumSet } from "./enum-set.models";
import { BehaviorSubject, Observable } from "rxjs";
import { GetObject200Response, ViewsInnerViewsInnerViewsInner } from "../api";
import { FormControlWithMetaData } from "./formControlWithMetadata.model";
import { FormArrayWithMetaData } from "./formArrayWithMetadata.model";
import { FormGroupWithMetaData } from "./formGroupWithMetadata.model";
import { DisplayPrecisionEnumSet } from "./display.models";


export interface DisplayViewPage {
  objectId: string,
  name: string,
  keyView?: DisplayGroup,
  views: Array<DisplayView>,
  dynamicProperties: Array<string>,
  displaySources$?: BehaviorSubject<Partial<DisplaySourceUpdate>>
}

//* For `focus` view, `options` view or `advanced` view
export interface DisplayView {
  title: string,
  views: Array<DisplayGroup>,
  id: string
}

//* Groups one top-level view (ViewsInner) with its built DisplayViewPage for the paste config tab
export interface ViewConfigGroup {
  id: string;
  title: string;
  page: DisplayViewPage;
}

export interface DisplayGroup extends ViewsInnerViewsInnerViewsInner {
  fields: Array<FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData>,//* Each index of `property[index]` from ViewGroup 
  group: FormGroupWithMetaData,
  keyAttribute?: string | null,
}

export type FieldDataType = Observable<EnumMember[]> | FloatType | string;

export interface FloatType {
  type: 'float',
  units?: string,
  precision?: number,
}

export interface DisplaySourceUpdate {
  units: string,
  displayPrecision: number,
  minPresValue: string,
  maxPresValue: string,
}

export function isPartialDisplaySourceUpdate(obj: unknown): obj is Partial<DisplaySourceUpdate> {
  if (typeof obj !== 'object' || obj === null) return false;
  const keys = Object.keys(obj) as Array<keyof DisplaySourceUpdate>;
  return keys.every(key => ['units', 'displayPrecision', 'minPresValue', 'maxPresValue'].includes(key));
}

export function isValidSourceKey(key: string): key is keyof DisplaySourceUpdate {
  return ['units', 'displayPrecision', 'minPresValue', 'maxPresValue'].includes(key);
}



export const SOURCE_TO_DISPLAY_KEY = {
  unitsSource: 'units',
  displayPrecisionSource: 'displayPrecision',
  minPresValueSource: 'minPresValue',
  maxPresValueSource: 'maxPresValue',
} as const;

export type SourcesObject = Record<string, string | number>;

export type ObjectSourcesInitValueRecord = Record<string, Record<string, string | number>>;

export interface SourceData {
  allSources: SourcesObject;
  objectSourcesMap: ObjectSourcesInitValueRecord;
};

export function isFloatType(obj: unknown): obj is FloatType {
  if (typeof obj !== 'object' || obj === null) return false;
  return Object.entries(obj).some(([k, v]) => k == 'type' && v == 'float');
}

export type ObjectTypeFormControl = {
  'overrideExpirationTime': FormControlWithMetaData,// category: 'attributeCategoryEnumSet.bacnetDateTimeCategory', 
  'version': FormControlWithMetaData,//category: 'attributeCategoryEnumSet.versionStructCategory'
}
