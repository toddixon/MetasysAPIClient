import { inject, Injectable, Injector, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';
import { BehaviorSubject, catchError, EMPTY, from, iif, map, of, switchMap, tap, throwError, timeout, timer } from 'rxjs';
import { environment } from '../environments/environment.development';
import { AuthenticationService, Configuration, LoginRequest, LoginResponse } from './api';
import { getTimeDiff } from './helpers/dates';
import { filterNull } from './helpers/rxjs.helpers';
import { LoggerService } from './logger.service';
import { authResponse, LoginFormData } from './models/auth.models';
import { SettingsService } from './settings.service';
import { StreamService } from './stream.service';
import { ApiConfigService } from './app.config';

@Injectable({
  providedIn: 'root'
})
export class AuthenticationManagerService implements OnInit {
  private _authService = inject(AuthenticationService);
  private _streamService = inject(StreamService);
  private _apiConfigService = inject(ApiConfigService);

  private _settingsService = inject(SettingsService);
  private _loggerService = inject(LoggerService);
  private _router = inject(Router);
  private _configuration = inject(Configuration);
  public readonly authSubject$ = new BehaviorSubject<authResponse | null>(null);

  constructor() {
    this.getToken();

    timer(0, environment.tokenRefreshInterval).pipe(
      switchMap(() => this.authSubject$.asObservable()),
      takeUntilDestroyed(),
      filterNull(),
      switchMap((auth: authResponse) => {
        const diff = getTimeDiff(new Date(), new Date(auth.expires));
        return iif(() => diff <= environment.tokenRefreshDeltaT,
          this.refreshToken().pipe(
            catchError((err) => {
              console.error(`Error refreshing token:, ${err.status}`);
              return this.logout();
            }),
            tap((data) => {
              console.log(data);
            }),
          ),
          of(auth),
        )
      }),
      catchError((err) => {
        console.error(err);
        return EMPTY;
      }),
      tap({
        subscribe: () => this._loggerService.info('AuthenticationService: tokenRefresh$ Subscribed to'),
        unsubscribe: () => this._loggerService.info('AuthenticationService: tokenRefresh$ Unsubscribed to'),
        complete: () => this._loggerService.info('AuthenticationService: tokenRefresh$ Completed'),
        error: () => this._loggerService.error('AuthenticationService: tokenRefresh$ error'),
      }),
    ).subscribe();
  }

  ngOnInit(): void {
    from(this._router.navigate(['/home'])).subscribe();
  }

  private getToken(): void {
    const accessToken: string | null = localStorage.getItem(environment.storageKeys.token);
    if (accessToken) {
      this.authSubject$.next(JSON.parse(accessToken) as LoginResponse | null);
    }
  }

  private setToken(res: LoginResponse): void {
    localStorage.setItem(environment.storageKeys.token, JSON.stringify(res));
    this.authSubject$.next(res);
  }

  private refreshToken(): Observable<LoginResponse> {
    return this._authService.getToken().pipe(
      tap((res) => {
        this.setToken(res);
      })
    );
  }

  public login(data: LoginFormData): Observable<LoginResponse> {
    //* Configuration instance changes (basePath)
    this.initBaseUrl(data.host, data.version);

    const creds = { username: data.username, password: data.password } as LoginRequest;
    // this._authService = this.injector.get(AuthenticationService);
    // this._authService = ;

    return this._authService.createToken(creds).pipe(
      timeout({
        each: environment.loginTimeout,
        with: () => throwError(() => new Error('TIMEOUT')),//status: 408
      }),
      tap((res: authResponse) => {
        this.setToken(res);
        localStorage.setItem(environment.storageKeys.version, data.version);
        // localStorage.setItem(environment.storageKeys.baseUrl, this._settingsService.getUrl());
      }),
      catchError((error) => {
        let msg;
        if (error.status === 0) {
          msg = 'Network Error or Invalid Metasys API Version';
        } else if (error.status === 401) {
          msg = 'Metasys Server Issue or Invalid Credentials';
        } else if (error.message == 'TIMEOUT') {
          msg = 'Login request timeout';
        } else {
          console.error('Login error', error);
          msg = error.message;
        }
        localStorage.clear();
        return throwError(() => new Error(`Login failed: ${msg}`));
      })
    );
  }


  private initBaseUrl(host: string, version: string): string {
    let baseUrl = `http://${host}/api/${version}`;
    if (environment.apiBaseUrl) {
      baseUrl = `${environment.apiBaseUrl}/${version}`;
    }
    localStorage.setItem(environment.storageKeys.baseUrl, baseUrl);
    this._apiConfigService.setBasePath(baseUrl);
    return baseUrl;
  }


  public logout(): Observable<any> {
    return of(null).pipe(
      tap(() => {
        Object.values(environment.storageKeys).map(k => localStorage.removeItem(k));
        this.authSubject$.next(null);
        this._streamService.stopStream();
      }),
      switchMap(() => from(this._router.navigate(['/login']))),
    );
  }

  //!TODO: If the local storage has an authentication key (accessToken & expires) but doesn't have the baseURL, we gotta do something about that.
  public isAuthenticated(): Observable<boolean> {
    return this.authSubject$.pipe(
      switchMap((token) =>
        iif(() => token == null,
          throwError(() => 'No access token found'),
          this._streamService.initStream()
        )
      ),
      timeout(environment.streamConnectionTimeout),
      switchMap((res) => {
        if (res.type == 'hello') {
          const id = (res.data as string).replace(/['"]/g, "");
          localStorage.setItem(environment.storageKeys.streamId, id);
          return of(true);
        } else if (res.type == 'heartbeat') {
          return throwError(() => 'Did not get first response. instead we just got a "heartbeat"');
        };
        return throwError(() => 'Error when connecting stream');
      }),
      catchError((err) => {
        console.error(err);
        return this.logout().pipe(
          map(() => false)
        );
      })
    )
  };



}

