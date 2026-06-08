import { ObjectEntityInTree } from "../api/model/objectEntityInTree";
import { ObjectMinimalList } from "../api/model/objectMinimalList";



export function isObjectEntityInTree(
  obj: ObjectEntityInTree | ObjectMinimalList
): obj is ObjectEntityInTree {
  return Array.isArray((obj as any).items);
}


export function isObjectMinimalList(
  obj: ObjectEntityInTree | ObjectMinimalList
): obj is ObjectMinimalList {
  return !Array.isArray((obj as any).items);
}