import { HttpParams } from "@angular/common/http";

export function toHttpParams(obj: any): HttpParams {
  let params = new HttpParams();

  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value !== undefined && value !== null) {
      params = params.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }
  });

  return params;
}

export const BASE_URL_REGEX = /https?:\/{2}[^\\/]*/