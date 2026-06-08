import { AfterViewInit, Component, effect, inject, OnInit, signal, ViewChild, ViewContainerRef, WritableSignal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { AuthenticationManagerService } from '../authentication-manager.service';
import { LoginFormData } from '../models/auth.models';
import { apiVersions } from '../constants/api.constants';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { environment } from '../../environments/environment.development';
import { Router } from '@angular/router';
import { Subject, BehaviorSubject, delay, merge, take, tap, switchMap, from, concatMap, of, Observable } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { CommonModule } from '@angular/common';
import { NavigationTreeService } from '../navigation-tree.service';
import { authGuard } from '../guards/auth.guard';
import { LoggerService } from '../logger.service';

@Component({
  selector: 'app-login-component',
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDividerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements AfterViewInit {
  private _router = inject(Router);
  private _authService = inject(AuthenticationManagerService);
  private _fb = inject(FormBuilder);
  private _snackBar = inject(MatSnackBar);
  private _metasysObjectService = inject(NavigationTreeService);
  private _loggerService = inject(LoggerService);
  public form: FormGroup;
  public hide: WritableSignal<boolean> = signal(true);
  public versions = apiVersions;
  public env = environment;

  @ViewChild('loginForm') loginForm!: ViewContainerRef;
  // loading$ emits true immediately when a login request is started and
  // emits false when the Observable completes or errors out.
  private loadingSubject$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public loading$: Observable<boolean>;

  constructor() {
    if (this._authService.authSubject$.value) {
      this._router.navigate(['/home']);
    }

    this.form = this._fb.group({
      // host: ['', [Validators.required]],
      host: [environment.host.toString(), [Validators.required]],
      // username: ['', [Validators.required]],
      username: [environment.username.toString(), [Validators.required]],
      // password: ['', [Validators.required]],
      password: [environment.password, [Validators.required]],
      version: [this.getDefaultVersion(), [Validators.required]],
    });

    this.loading$ = this.loadingSubject$.asObservable().pipe(
      tap((isLoading) => {
        if (isLoading) {
          this.form.disable();
        } else {
          this.form.enable();
        }
      })
    )
    this._authService.isAuthenticated().pipe(//! Do this instead and either do nothing or route to `/home`

    )

  }

  ngAfterViewInit(): void {
  }

  getDefaultVersion() {
    return localStorage.getItem(environment.storageKeys.version) || apiVersions[apiVersions.length - 1];
  }

  onPasswordVisibilityToggle(event: MouseEvent): void {
    this.hide.set(!this.hide());
    event.stopPropagation();
  }

  onLoginClick(data: LoginFormData): void {
    this.loadingSubject$.next(true);

    this._authService.login(data).subscribe({
      next: (res) => {
        console.log('Login successful');
        let snackbar = this._snackBar.open('Login successful: Redirecting to home page', 'Continue', {
          duration: environment.snackBarDurations.short,
          panelClass: ['snackbar-success'],
          verticalPosition: 'top',
          horizontalPosition: 'center',
        });

        snackbar.afterDismissed().pipe(
          take(1),
          tap({
            complete: () => {
              this._router.navigate(['/home'])
            },
          }),
        ).subscribe();
      },
      error: (err) => {
        console.error('Login failed', err?.message ?? err);
        const message = err?.message ?? (err?.toString?.() ?? 'Login failed');
        this._snackBar.open(message, 'Ok', {
          // duration: environment.snackBarDurations.long,
          panelClass: ['snackbar-error'],
          verticalPosition: 'top',
          horizontalPosition: 'center',
        });
        this.loadingSubject$.next(false);
      },
      complete: () => {
        console.log('Login request completed');
        this.loadingSubject$.next(false);
      }
    });
  }

}
