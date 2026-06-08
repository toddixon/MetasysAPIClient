import { HttpEvent, HttpHandlerFn, HttpRequest } from "@angular/common/http";
import { Observable } from "rxjs";
import { environment } from "../../environments/environment.development";
import { BASE_URL_REGEX } from "../helpers/httpParams";

export function ProxyInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  // if (environment.envName == 'mock-api') {
  //   return next(req);
  // } else {
    const reqProx = req.clone({
      url: req.url.replace(BASE_URL_REGEX, '')
    })
    return next(reqProx);
  // }
}
