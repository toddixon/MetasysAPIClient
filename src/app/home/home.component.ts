import { Component, EventEmitter, inject, OnInit, ViewChild } from '@angular/core';
import { CdkDragEnd, CdkDragMove, CdkDragStart, DragDropModule } from '@angular/cdk/drag-drop'
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatMenuModule } from '@angular/material/menu';
import { AuthenticationManagerService } from '../authentication-manager.service';
import { SidenavMainComponent } from "../sidenav-main/sidenav-main.component";
import { DisplayComponent } from "../display/display.component";
import { environment } from '../../environments/environment.development';
import { StreamService } from '../stream.service';
import { count, debounce, debounceTime, defer, filter, map, Observable, Observer, scan, startWith, tap, throttleTime } from 'rxjs';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpParams } from '@angular/common/http';
import { LoggerService } from '../logger.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BASE_URL_REGEX } from '../helpers/httpParams';
import { ActionSnackBarComponent } from '../snackbars/action-snack-bar.component';
import { MatDialog } from '@angular/material/dialog';
import { ActionDialogComponent } from '../dialog-components/action-dialog/action-dialog.component';
import { StreamEventsDialogComponent } from '../dialog-components/stream-events-dialog/stream-events-dialog.component';

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    DragDropModule,
    MatToolbarModule,
    MatSidenavModule,
    MatSnackBarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    SidenavMainComponent,
    DisplayComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild('resizer') resizer!: HTMLDivElement;

  private _streamService = inject(StreamService);
  private _authService = inject(AuthenticationManagerService);
  private _loggerService = inject(LoggerService);
  public isDev = !environment.production;
  public streamHeartbeats$: Observable<number>;
  private _snackBar = inject(MatSnackBar);
  private _dialog = inject(MatDialog);


  private _sideNavParams = environment.sideNavParams;
  public sideNavWidth: number = environment.sideNavParams.initWidth;
  private lastWidth: number = this.sideNavWidth;

  private eventObs!: Observer<CdkDragMove<any>>;
  private dragEvents$: Observable<CdkDragMove<any>> = new Observable((obs: typeof this.eventObs) => {
    this.eventObs = obs;
  }).pipe(
    takeUntilDestroyed(),
    throttleTime(500),
  );

  constructor() {
    this.dragEvents$.subscribe();

    this.streamHeartbeats$ = defer(() => this._streamService.getStream()).pipe(
      takeUntilDestroyed(),
      filter((m) => m.type == 'message'),
      startWith({} as MessageEvent),
      scan<MessageEvent<any>, number>((acc, m) => {
        acc = acc + 1
        return acc
      }, 0),
    );

    this._loggerService.errorSubject$.pipe(
      takeUntilDestroyed(),
      tap((err) => {
        const url = err.url?.replace(BASE_URL_REGEX, '');
        let errDetails = err.error.details;
        let errMsg = err.error.message;
        let httpErrMsg = err.error.message;
        let httpErrStatus = err.error.status;
        if (typeof errDetails == 'object') {
          errDetails = Object.entries(errDetails).find(([k, v]) => typeof v == 'string' && v.length > 0)?.join(': ');
        }
        const message = `Request failed for url ${url}, Http Error Status: ${httpErrStatus} ---- API Error Message: ${errMsg}, API Error Details: ${errDetails}`
        this._snackBar.open(message, 'Ok', {

          // duration: environment.snackBarDurations.long,
          panelClass: ['snackbar-error'],
          verticalPosition: 'top',
          horizontalPosition: 'center',
        });
      }),
    ).subscribe();

    this._loggerService.successSubject$.pipe(
      takeUntilDestroyed(),
      tap((data) => {
        this._snackBar.open(data, 'Ok', {
          duration: environment.snackBarDurations.long,
          panelClass: ['snackbar-success'],
          verticalPosition: 'top',
          horizontalPosition: 'center',
        });
      }),
    ).subscribe();

    // this._loggerService.dialogActionsSubject$.pipe(
    //   takeUntilDestroyed(),
    //   tap((data) => {
    //     const dialogRef = this._dialog.open(ActionDialogComponent, {
    //       data: data, disableClose: true, width: '80vw'
    //     })
    //     dialogRef.afterClosed().subscribe(data.res$);
    //   }),
    // ).subscribe();

  }


  ngOnInit(): void {
  }

  public onDragMoved(event: CdkDragMove<any>): void {
    const element = event.source.element.nativeElement as HTMLElement;
    element.style.transform = 'none';
    const newWidth = event.pointerPosition.x;
    this.sideNavWidth = Math.min(Math.max(newWidth, this._sideNavParams.minWidth), this._sideNavParams.maxWidth);
    // this.eventObs.next(event);
  }

  public onDragEnd(event: CdkDragEnd<any>) {
    this.lastWidth = this.sideNavWidth;
  }

  public onDragStart(event: CdkDragStart<any>) {
    let m = event.event as MouseEvent;
    // console.log(m.x);
  }


  public onCopyEvent(copyEvent$: Observable<any>) {

  }

  public onLogoutClick() {
    this._authService.logout().subscribe();
  }

  public openStreamDebug(): void {
    this._dialog.open(StreamEventsDialogComponent, {
      width: '92vw',
      maxHeight: '80vh',
      panelClass: 'stream-debug-dialog',
    });
  }



}
