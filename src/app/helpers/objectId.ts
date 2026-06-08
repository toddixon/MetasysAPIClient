import { paramSeparator } from "../constants/router.constants";

export const OBJECT_ID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export const OBJECT_ID_REGEX_ANYWHERE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/;

export const OBJECT_ID_LIST_REGEX =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}[^,]?/;

export const OID_LIST_REGEX =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}(?:\s*,\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})*/;

export function parseAndValidateOids(raw: string): string {
  const validIds = raw.match(OID_LIST_REGEX)![0].split(paramSeparator);
  const uniqueIds = checkForDuplicates(validIds);
  return uniqueIds.join(paramSeparator);
};


export function checkForDuplicates(oidArr: string[]): string[] {
  const uniqueIds = [...new Set(oidArr)];
  return uniqueIds;
}


export function extractObjectId(str: string): string {
  return str.match(OBJECT_ID_REGEX_ANYWHERE)![0];
};

export function extractOidsString(url: string): string {
  const match = url.match(OID_LIST_REGEX);
  return match ? match[0] : '';
}
