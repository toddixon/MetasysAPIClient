import { Classification, GetObjectsResponseItemsInner } from "../api";
import { ObjectSnapshot } from "./copied-object.models";

export type EventModifiers = {
  ctrlKey: boolean,
  shiftKey: boolean,
  altKey: boolean,
}

export type ItemClickedEvent = {
  id: string,
  parentId: string,
  objectType: string,
  classification?: Classification,
  itemReference: string,
  name: string,
  modifiers: EventModifiers,
}

export interface ItemSelectedData extends Omit<ItemClickedEvent, 'modifiers'> { }

export const isItemClickedEvent = (value: unknown): value is ItemClickedEvent => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).id === 'string' &&
    typeof (value as any).name === 'string' &&
    typeof (value as any).modifiers === 'object' &&
    typeof (value as any).modifiers.ctrlKey === 'boolean' &&
    typeof (value as any).modifiers.shiftKey === 'boolean' &&
    typeof (value as any).modifiers.altKey === 'boolean'
  );
};

export const isItemSelectedData = (value: unknown): value is ItemSelectedData => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).id === 'string' &&
    typeof (value as any).name === 'string'
  );
};


export interface PasteEvent {
  valid: boolean;
  parentId: string;
  items: ObjectSnapshot[];
  ignoredNodes?: GetObjectsResponseItemsInner[];
}




