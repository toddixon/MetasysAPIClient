import { HttpEvent, HttpHandlerFn, HttpRequest } from "@angular/common/http";
import { inject } from "@angular/core";
import { AuthenticationManagerService } from "../authentication-manager.service";
import { Observable } from "rxjs";
import { authRoutes, streamHeaders, streamRoutes } from "../constants/api.constants";
import { environment } from "../../environments/environment.development";
import { ApiConfigService } from "../app.config";

export function AuthInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  const authService = inject(AuthenticationManagerService);
  const apiConfigService = inject(ApiConfigService);

  if (req.url.startsWith('assets/icons/')) {
    return next(req);
  } else if (req.url.includes('API/signalr/ping')) {
    return next(req);
  }

  if (req.url.includes(authRoutes.login)) {
    const authReq = req.clone({
      setHeaders: {
        'User-Agent': 'API-Client'
      }
    })
  } else if (req.url.endsWith('.svg') || req.url.includes('fonts.googleapis.com')) {
    return next(req);
  } else if (req.url.includes(`/trendAttributes/presentValue/samples`)) {
    req = req.clone({
      // url: settingsService.getUrl() + req.url,
      setHeaders: {
        'METASYS-SUBSCRIBE': localStorage.getItem(environment.storageKeys.streamId) || '',
      }
    })
  } else if (req.url.includes(`/attributes/`)) {//req.headers.lazyUpdate.map(h => h.name = 'METASYS-SUBSCRIBE')
    let l;
  }

  const token = authService.authSubject$.value?.accessToken;
  const baseUrl = apiConfigService.getBasePath();
  let url = req.url.toLocaleLowerCase().includes(baseUrl.toLocaleLowerCase()) ? req.url : baseUrl + req.url;
  const authReq = req.clone({
    url: url,
    setHeaders: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'API-Client',

    }
  });
  return next(authReq);
}
