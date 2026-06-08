//! UNUSED
import { inject, Injectable, Injector, Type } from '@angular/core';
import { ApiConfigService } from './app.config';

@Injectable({
  providedIn: 'root',
})
export class ApiFactoryService {
  private injector = inject(Injector);
  private apiConfigService = inject(ApiConfigService);
  private initializedServices = new Map<Type<any>, any>();

  getService<T>(serviceType: Type<T>): T {
    // Check if already initialized
    if (this.initializedServices.has(serviceType)) {
      return this.initializedServices.get(serviceType);
    }

    // Ensure BASE_PATH is set
    const basePath = this.apiConfigService.getBasePath();
    if (!basePath) {
      throw new Error('BASE_PATH not configured. Please login first.');
    }

    // Inject the service now that BASE_PATH is ready
    const service = this.injector.get(serviceType);
    this.initializedServices.set(serviceType, service);
    return service;
  }

  reset(): void {
    this.initializedServices.clear();
  }

}
