import { Injectable } from '@angular/core';
import { environment } from '../environments/environment.development';

//! Repurpose this service to manage app settings like user preferences, theme, or other features that will be implemented in the future
@Injectable({
  providedIn: 'root'
})
export class SettingsService {

  private version = 'v6';
  private host = 'localhost';
  public apiUrl: string = '';
  public metasysServerUrl: string = `https://${this.host}/ui`;
  public doubleClickDelay = 200;
  constructor() {
    this.buildUrl();

  }

  getUrl(): string {
    return this.apiUrl.toLocaleLowerCase();
  }

  setHost(host: string): string {
    this.host = host;
    return this.buildUrl();
  }

  setVersion(version: string): string {
    this.version = version;
    return this.buildUrl();
  }

  private buildUrl(): string {
    const url = localStorage.getItem(environment.storageKeys.baseUrl)
    if (url) {
      return this.apiUrl = url;
    }
    return this.apiUrl = `https://${this.host}/api/${this.version}`;

  }









}
