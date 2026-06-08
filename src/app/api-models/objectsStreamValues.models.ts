import { ConditionValue } from "../api/model/conditionValue";
import { ObjectsStreamValuesUpdateInner } from "../api/model/objectsStreamValuesUpdateInner";

export function isObjectsStreamValuesUpdateInner(value: unknown): value is ObjectsStreamValuesUpdateInner {
  if (typeof value !== "object" || value === null) return false;

  const v = value as Partial<ObjectsStreamValuesUpdateInner>;

  // item must exist and be an object
  if (typeof v.item !== "object" || v.item === null) return false;

  // subscriptionId must be string if present
  if (v.subscriptionId !== undefined && typeof v.subscriptionId !== "string") {
    return false;
  }

  // condition must be a record of ConditionValue if present
  if (v.condition !== undefined) {
    if (typeof v.condition !== "object" || v.condition === null) return false;

    for (const key of Object.keys(v.condition)) {
      const c = v.condition[key];
      // Replace the following check with your real ConditionValue validator
      if (!isConditionValue(c)) return false;
    }
  }

  // schema must be an object if present
  if (v.schema !== undefined) {
    if (typeof v.schema !== "object" || v.schema === null) return false;
  }

  return true;
}


export function isConditionValue(value: unknown): value is ConditionValue {
  if (typeof value !== "object" || value === null) return false;

  const v = value as ConditionValue;

  // Optional strings
  if (v.priority !== undefined && typeof v.priority !== "string") return false;
  if (v.reliability !== undefined && typeof v.reliability !== "string")
    return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;

  return true;
}