import { Injectable } from '@angular/core';
import { environment } from '../environments/environment';
import { Observable, Subject, Subscriber } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { GetObjectsResponseItemsInner } from './api';



export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  Off = 4
}

@Injectable({
  providedIn: 'root'
})
export class LoggerService {
  logLevel: LogLevel = environment.production ? LogLevel.Error : LogLevel.Debug;
  public errorSubject$: Subject<HttpErrorResponse> = new Subject();
  public successSubject$: Subject<string> = new Subject();
  private logServices: boolean = true;

  debug(message: string, ...optionalParams: any[]): void {
    if (this.logLevel <= LogLevel.Debug) {
      console.debug(`[DEBUG] ${message}`, ...optionalParams);
    }
  }

  info(message: string, color: string | undefined = '#6495ED', ...optionalParams: any[]): void {
    if (this.logLevel <= LogLevel.Info) {
      // console.info(`%c[INFO] ${message}`, `color: ${color || '#6495ED'}`, ...optionalParams);
    }
  }

  service(message: string, color: string | undefined = '#6495ED', ...optionalParams: any[]): void {
    if (this.logServices) {
      console.info(`%c[SERVICE] ${message}`, `color: ${color || '#6495ED'}`, ...optionalParams);
    }
  }

  warn(message: string, ...optionalParams: any[]): void {
    if (this.logLevel <= LogLevel.Warn) {
      console.warn(`[WARN] ${message}`, ...optionalParams);
    }
  }

  error(message: string, ...optionalParams: any[]): void {
    if (this.logLevel <= LogLevel.Error) {
      console.error(`[ERROR] ${message}`, ...optionalParams);
    }
  }

  getErrorMsg(err: any): any {
    if (typeof err == 'object') {
      let errDetails = err.error.details;
      let errMsg = err.error.message;
      let httpErrMsg = err.error.message;
      let httpErrStatus = err.error.status;

      return errMsg
    } else if (typeof err == 'string') {
      return err;
    } else {
      this.error(`getErrorMsg error: typeof err isn't of type 'object' or 'string': ${typeof err}, ${err}`);
      return err
    }

  }


}



