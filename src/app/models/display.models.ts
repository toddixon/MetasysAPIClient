import { Observable } from "rxjs";
import { GetObject200Response, GetObjectsResponseItemsInner } from "../api";
import { FormControlWithMetaData } from "./formControlWithMetadata.model";
import { ItemClickedEvent } from "./event.models";

export interface ItemData extends Pick<ItemClickedEvent, 'id' | 'parentId' | 'objectType' | 'classification' | 'itemReference' | 'name'> { }

export interface DisplayItem {
  title: string;
  itemData: ItemData;
  item$: Observable<GetObject200Response>;
  node$: Observable<GetObjectsResponseItemsInner | undefined>
}



//* All of these properties are present in the 'viewGroupEnumSet.displayGrp' for any item, and the properties included will depend on the type of the `presentValue`
//* If metasysType='float' (type='number') we'll check for properties: `units`, and `displayPrecision`
//* If metasysType='enum' (type='string') we'll check for properties: `statesText`
export interface LocalDynamicProperties {
  units?: Observable<any>,
  displayPrecision?: Observable<any>,
};

export type ClientFormDynamicProperties = 'units' | 'displayPrecision';

// export type FloatDynamicProperties = Required<Pick<LocalDynamicProperties, 'type' | 'units' | 'displayPrecision'>>  


export type ViewName =
  "viewNameEnumSet.focusView" |
  "viewNameEnumSet.configView" |
  "viewNameEnumSet.optionsView" |
  "viewNameEnumSet.trendView" |
  "viewNameEnumSet.totalizationView" |
  "viewNameEnumSet.averagingView" |
  "viewNameEnumSet.ssFocusView"


export enum DisplayPrecisionEnumSet {
  "displayPrecisionPt000001" = 0.000001,
  "displayPrecisionPt00001" = 0.00001,
  "displayPrecisionPt0001" = 0.0001,
  "displayPrecisionPt001" = 0.001,
  "displayPrecisionPt01" = 0.01,
  "displayPrecisionPt1" = 0.1,
  "displayPrecision1" = 1,
  "displayPrecision10" = 10,
  "displayPrecision100" = 100,
  "displayPrecision1000" = 1000,
  "displayPrecision10000" = 10000,
  "displayPrecision100000" = 100000,
  "displayPrecision1000000" = 1000000,
}

export interface UnsavedChangesObj {
  objectId: string,
  objectName: string,
  changes?: Record<string, any>
}

export function isDisplayPrecisionEnumValue(value: string): value is keyof typeof DisplayPrecisionEnumSet {
  const key = value.split('.').pop()!;
  return key in DisplayPrecisionEnumSet;
}

export function resolveDisplayPrecision(value: string): number | undefined {
  const key = value.split('.').pop()!;

  if (!(key in DisplayPrecisionEnumSet)) {
    return undefined;
  }

  return DisplayPrecisionEnumSet[
    key as keyof typeof DisplayPrecisionEnumSet
  ];
}

export function getPrecision(value: string | number, precision: number): string {
  if (typeof value == 'string') value = parseFloat(value);

  if (precision >= 1) {
    const roundedValue = Math.round(value / precision) * precision;
    return roundedValue.toString();
  } else {
    const decimalPlaces = precision.toString().split('.')[1].length || 0;

    const precisionValue = value.toFixed(decimalPlaces);
    return precisionValue;
  }

}