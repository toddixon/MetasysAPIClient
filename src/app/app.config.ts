import { APP_INITIALIZER, ApplicationConfig, Injectable, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { AuthInterceptor } from './interceptors/auth.interceptor';
import { PerformanceInterceptor } from './interceptors/performance.interceptor';
import { provideNgxSkeletonLoader } from 'ngx-skeleton-loader';
import { BASE_PATH, Configuration } from './api';
import { apiConfigFactory } from '../main';
import { ProxyInterceptor } from './interceptors/proxy.interceptor';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../environments/environment.development';
import { IconService } from './icon.service';

// Create a service to hold the base path state
@Injectable({ providedIn: 'root' })
export class ApiConfigService {
  private basePathSubject$ = new BehaviorSubject<string | null>(localStorage.getItem(environment.storageKeys.baseUrl) || null);
  public basePath$ = this.basePathSubject$.asObservable();

  setBasePath(path: string): void {
    this.basePathSubject$.next(path);
  }

  getBasePath(): string {
    return this.basePathSubject$.value || '';
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes),
    {
      provide: Configuration,
      useFactory: apiConfigFactory,
    },
    // {
    //   provide: BASE_PATH,
    //   useFactory: (configService: ApiConfigService) => {
    //     return configService.getBasePath();
    //   },
    //   deps: [ApiConfigService]
    // },
    provideHttpClient(
      withFetch(),
      withInterceptors([
        PerformanceInterceptor,
        AuthInterceptor,
        ProxyInterceptor
      ])),
    {
      provide: APP_INITIALIZER,
      useFactory: (iconService: IconService) => () => iconService.preloadIcons(),
      deps: [IconService],
      multi: true,
    },
    provideNgxSkeletonLoader({
      theme: {
        extendsFromRoot: true,
        height: '30px',
      },
    }),
  ]
};
