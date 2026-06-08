import { Component, effect, inject, Signal, signal, TrackByFunction, WritableSignal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CommonModule } from '@angular/common';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { BehaviorSubject, delay, filter, map, merge, Observable, of, scan, Subject, Subscriber, takeWhile, tap } from 'rxjs';
import { GetObjectsResponseItemsInner } from '../../api';
import { MatTableModule } from '@angular/material/table';
import { ProgressState, RequestResult, trackRequestProgress } from '../../helpers/rxjs.helpers';
import { ActionWarnEvent, ObjectOperationUpdate, ObjectOperation, Status } from '../../models/dialog.models';
import { NavigationTreeService } from '../../navigation-tree.service';
import { lastSegment } from '../../constants/api.constants';

@Component({
  selector: 'app-action-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogActions,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatTableModule,
    MatDividerModule,
    MatProgressBarModule
  ],
  templateUrl: './delete-dialog.component.html',
  styleUrl: './delete-dialog.component.scss',
})
export class DeleteDialogComponent {
  readonly dialogRef = inject(MatDialogRef<DeleteDialogComponent>);
  protected _navTreeService = inject(NavigationTreeService);

  public data: ActionWarnEvent = inject(MAT_DIALOG_DATA);
  public obs$: Observable<any> | undefined;

  public progress: WritableSignal<ProgressState>;

  public progressSubscriber!: Subscriber<ObjectOperationUpdate>;
  public progress$: Observable<any>;

  public processedSubject$: Subject<ObjectOperationUpdate> = new Subject();
  public objectOperations: Array<ObjectOperation> = [];

  public disableButtons: WritableSignal<boolean> = signal(false);
  public allProcessed: WritableSignal<boolean> = signal(false);

  public objectOperationColumns: string[] = ['name', 'reference', 'status', 'actions'];

  public objNames = this.data.nodes?.map(n => n.name);

  /** Child nodes that were selected but will be ignored because their parent is also being deleted. */
  public ignoredNodes = this.data.ignoredNodes ?? [];

  /** For each parent being deleted that had selected children, the full list of its direct children. */
  public parentChildrenEntries: { parentName: string; children: GetObjectsResponseItemsInner[] }[] =
    this.data.parentChildrenMap
      ? Array.from(this.data.parentChildrenMap.entries()).map(([parentId, children]) => ({
        parentName: this.data.nodes?.find(n => n.id === parentId)?.name ?? parentId,
        children,
      }))
      : [];

  constructor() {
    effect(() => {
      let f = this.progress();
      console.log(f)
    })


    this.data.nodes?.forEach(n => {
      this.objectOperations.push({
        objectId: n.id,
        name: n.name.length > 0 ? n.name : n.label,
        reference: n.itemReference,
        status: 'Idle',
      });
    });

    this.progress = signal({
      total: this.objectOperations.length,
      completed: 0,
      percentage: 0,
      successes: 0,
      errors: 0,
      results: [],
    });

    this.progress$ = new Observable((subs: Subscriber<ObjectOperationUpdate>) => {
      this.progressSubscriber = subs;
    }).pipe(
      map((data) => {
        data.status == 'Processing' ? this.processedSubject$.next(data) : undefined;
        return data as ObjectOperationUpdate;
      }),
      filter((update) => {
        return update.status == 'Success' || update.status == 'Error';
      }),
      map<ObjectOperationUpdate, RequestResult>((update) => {
        let result: RequestResult = { id: update.objectId, status: update.status as 'Success' | 'Error' };
        return result;
      }),
      trackRequestProgress(this.objectOperations.length),
      tap((progressUpdate) => {
        this.progress.set(progressUpdate);
      })
    );

    this.progress$.subscribe();

    this.processedSubject$.asObservable().pipe(
      scan<ObjectOperationUpdate, number>((acc, val) => {
        acc = acc - 1;
        return acc;
      }, this.objectOperations.length),
      takeWhile((p) => p != 0),
    ).subscribe({
      complete: () => this.allProcessed.set(true)
    })

    if (this.data.doSomethingFn$) {
      this.obs$ = this.data.doSomethingFn$.pipe(
        tap((res) => {
          const idx = this.objectOperations.findIndex(obj => obj.objectId == res.objectId);
          if (idx !== -1) {
            Object.assign(this.objectOperations[idx], res);
          }
        }),
      ) as Observable<ObjectOperationUpdate>
    }

  }

  public doSomethingFn() {

    this.obs$?.pipe(
      tap((data) => {
        console.log(data);
      }),
      tap({
        subscribe: () => {
          this.disableButtons.set(true);
        },
        finalize: () => {
          //TODO: Figure out whether we want the dialog to close right after completion and/or present the user a snackbar message, etc.. 
          this.disableButtons.set(false);
          this.progressSubscriber.complete();

          const uniqueParentIds = new Set(
            this.objectOperations
              .filter(op => op.status === 'Success')
              .map(op => this.data.nodes?.find(n => n.id === op.objectId))
              .filter((node): node is GetObjectsResponseItemsInner => !!node?.parentUrl)
              .map(node => node.parentUrl!.match(lastSegment)?.[0])
              .filter((id): id is string => !!id)
          );
          uniqueParentIds.forEach(parentId => this._navTreeService.refreshNode(parentId));
        }
      }),
    ).subscribe(this.progressSubscriber);

  }

  public trackById: TrackByFunction<ObjectOperation> = (index: number, item: ObjectOperation) => {
    return item.objectId;
  }

  getStatusClass(status: Status): string {
    switch (status) {
      case 'Success': return 'status-success';
      case 'Error': return 'status-error';
      case 'Processing': return 'status-deleting';
      default: return '';
    }
  }

  public retryItem(op: ObjectOperation) {
    if (!this.data.retryFn) return;
    this.data.retryFn(op.objectId).subscribe({
      next: (update) => {
        const idx = this.objectOperations.findIndex(o => o.objectId === update.objectId);
        if (idx !== -1) {
          Object.assign(this.objectOperations[idx], update);
        }
        if (update.status === 'Success' || update.status === 'Error') {
          this.recomputeProgress();
        }
      },
    });
  }

  protected recomputeProgress() {
    const total = this.objectOperations.length;
    const successes = this.objectOperations.filter(o => o.status === 'Success').length;
    const errors = this.objectOperations.filter(o => o.status === 'Error').length;
    const completed = successes + errors;
    this.progress.set({
      total,
      completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      successes,
      errors,
      results: [],
    });
    if (completed === total) {
      this.allProcessed.set(true);
    }
  }

}
