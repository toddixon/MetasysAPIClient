import { Component, inject, Signal, signal, TrackByFunction, WritableSignal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BehaviorSubject, delay, filter, map, Observable, of, Subject, Subscriber, tap } from 'rxjs';
import { GetObjectsResponseItemsInner } from '../../api';
import { MatTableModule } from '@angular/material/table';
import { ProgressState, RequestResult, trackRequestProgress } from '../../helpers/rxjs.helpers';
import { ActionWarnEvent, ObjectOperationUpdate, ObjectOperation } from '../../models/dialog.models';

@Component({
  selector: 'app-action-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogActions,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatTableModule,
    MatDividerModule,
    MatProgressBarModule
  ],
  templateUrl: './action-dialog.component.html',
  styleUrl: './action-dialog.component.scss',
})
export class ActionDialogComponent {
  readonly dialogRef = inject(MatDialogRef<ActionDialogComponent>);
  public data: ActionWarnEvent = inject(MAT_DIALOG_DATA);
  public obs$: Observable<any> | undefined;
  // public progress: WritableSignal<number> = signal(0);

  public progressSubscriber!: Subscriber<ObjectOperationUpdate>;
  public progress$: Observable<any>;
  // public objectOperations$?: BehaviorSubject<ObjectOperationResult[]>;
  public objectOperations: Array<ObjectOperation> = [];

  public disableActions: WritableSignal<boolean> = signal(false);

  public objNames = this.data.nodes?.map(n => n.name);

  constructor() {
    this.progress$ = new Observable((subs: Subscriber<ObjectOperationUpdate>) => {
      this.progressSubscriber = subs;
    });

    if (this.data.doSomethingFn$) {
      this.obs$ = this.data.doSomethingFn$.pipe(
        tap({
          next: (progress) => {
            // this.progress.set(progress);
          },
          complete: () => {
            // this.progress.set(100);
            setTimeout(() => {
              // this.obs$ = undefined;
              this.dialogRef.close('Save');
            }, 200);
          }
        })
      );
    }

  }

  public doSomethingFn() {

    this.obs$?.pipe(
      tap({
        subscribe: () => {
          this.disableActions.set(true);
        },
        finalize: () => {
          // this.disableActions.set(false);
          this.progressSubscriber.complete();
        }
      }),
    ).subscribe(this.progressSubscriber);

  }


}
