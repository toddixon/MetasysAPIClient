import { HttpEvent, HttpHandlerFn, HttpRequest } from "@angular/common/http";
import { inject } from "@angular/core";
import { AuthenticationManagerService } from "../authentication-manager.service";
import { finalize, Observable, of } from "rxjs";
import { authRoutes, streamRoutes } from "../constants/api.constants";

export function PerformanceInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {

  if (req.url.includes(streamRoutes.stream)) {

  }
  const startTime = Date.now();
  return next(req).pipe(
    finalize(() => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      // console.log(`API Call to ${req.urlWithParams} took ${duration}ms`);
      // You can send this data to a monitoring service or store it locally
    })
  );

}