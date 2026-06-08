import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { Configuration, LoginResponse } from './app/api';
import { environment } from './environments/environment.development';

export function apiConfigFactory() {
  return new Configuration({
    basePath: '',
    // basePath: localStorage.getItem(environment.storageKeys.baseUrl) ?? '',
    credentials: {
      Authorization: () => localStorage.getItem(environment.storageKeys.token) ?? '',
      Stream: () => localStorage.getItem(environment.storageKeys.streamId) ?? '',// Last-Event-Id

    },
  })
}

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
