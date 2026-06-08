import { Component, EventEmitter, inject, Output, signal, WritableSignal, effect, Signal, computed, ViewChild } from '@angular/core';
import { RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from '@angular/material/icon';
import { NavigationTreeService } from '../navigation-tree.service';
import { ObjectOperationsService } from '../object-operations.service';
import { CommonModule } from '@angular/common';
import { MatDivider } from "@angular/material/divider";
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, finalize, map, merge, Observable, switchMap, take, tap } from 'rxjs';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActionDialogComponent } from '../dialog-components/action-dialog/action-dialog.component';
import { DeleteDialogComponent } from '../dialog-components/delete-dialog /delete-dialog.component';
import { PasteDialogComponent } from '../dialog-components/paste-dialog/paste-dialog.component';
import { ActionWarnEvent, CopyProgressState } from '../models/dialog.models';
import { ObjectSnapshot } from '../models/copied-object.models';
import { StreamService } from '../stream.service';
import { ItemClickedEvent } from '../models/event.models';

interface ToolBarMessages {
  copy: string,
  paste: string,
  delete: string,
}

@Component({
  selector: 'app-sidenav-main',
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatMenuModule,
    MatDivider,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './sidenav-main.component.html',
  styleUrl: './sidenav-main.component.scss'
})
export class SidenavMainComponent {
  @Output() copyItemEvent = new EventEmitter<Observable<any>>

  @ViewChild(MatMenuTrigger) contextMenuTrigger!: MatMenuTrigger;
  public contextMenuPosition = { x: '0px', y: '0px' };
  public contextMenuNodeId: string | null = null;

  private _dialog = inject(MatDialog);
  private _snackBar = inject(MatSnackBar);

  public navTreeService = inject(NavigationTreeService);
  public objectOpsService = inject(ObjectOperationsService);
  public _streamService = inject(StreamService);
  public activeDisplay: "navTree" | "none" | undefined = undefined;
  public selected$ = this.navTreeService.selectedNodesSubject$;
  public selSignal = toSignal(this.selected$);
  public pasteAllowed: WritableSignal<boolean> = signal(false);
  public pasteInProgress: WritableSignal<boolean> = signal(false);
  public pendingCopiedItems: ObjectSnapshot[] = [];

  public loadingDeleteData: WritableSignal<boolean> = signal(false);
  public loadingCopyData: WritableSignal<boolean> = signal(false);
  public operationLoading: Signal<boolean> = computed(() => {
    return this.loadingDeleteData() || this.loadingCopyData();
  });

  /** Entries from the copy progress failed subtrees map, for use in @for in the template. */
  public copyProgressFailedEntries = computed(() => {
    const progress = this.objectOpsService.copyProgress();
    if (!progress) return [];
    return Array.from(progress.failedSubtrees.entries());
  });

  public toolBarMessages: WritableSignal<ToolBarMessages> = signal({
    copy: 'Copy selected objects',
    paste: 'Paste copied objects',
    delete: 'Delete selected objects',
  });

  constructor() {
    effect(() => {
      const clipboardItems = this.objectOpsService.clipboard();
      const pasteAllowed = this.pasteAllowed();

      this.toolBarMessages.update((messages) => {
        if (clipboardItems.length > 0) {
          messages.copy = `Current clipboard contents:\n${clipboardItems.join(`,\n`)}`;

          if (!pasteAllowed) {
            messages.paste = 'Paste copied objects (destination will be validated on click)';
          } else {
            messages.paste = 'Paste copied objects';
          }

        } else {
          messages.copy = `Copy selected objects`;//`Current clipboard contents:\ntest-item-0,\ntest-item-1,\ntest-item-2,\ntest-item-3\n`
          messages.paste = `Paste copied objects`;
        }

        return messages;
      })

    });


    this.navTreeService.dialogActionsSubject$.pipe(
      takeUntilDestroyed(),
      tap((data) => {
        if (data.operation == 'copy') {
          // this.loadingCopyData.set(false);
        } else if (data.operation == 'delete') {
          this.loadingDeleteData.set(false);
        }
        const dialogRef = this._dialog.open(ActionDialogComponent, {
          data: data, disableClose: true, width: '80vw'
        })
        dialogRef.afterClosed().subscribe(data.res$ ?? (() => { }));
      }),
    ).subscribe();

    this.objectOpsService.deleteDialogSubject$.pipe(
      takeUntilDestroyed(),
      tap((data) => {
        if (data.operation == 'copy') {
          // this.loadingCopyData.set(false);
        } else if (data.operation == 'delete') {
          this.loadingDeleteData.set(false);
        }
        const dialogRef = this._dialog.open(DeleteDialogComponent, {
          data: data, disableClose: true, width: '80vw'
        })
        dialogRef.afterClosed().subscribe(data.res$ ?? (() => { }));
      }),
    ).subscribe();

    this.navTreeService.contextMenuTrigger$.pipe(
      takeUntilDestroyed(),
      tap(({ event, nodeId }) => {
        this.contextMenuPosition.x = event.clientX + 'px';
        this.contextMenuPosition.y = event.clientY + 'px';
        this.contextMenuNodeId = nodeId;
        this.contextMenuTrigger.openMenu();
      }),
    ).subscribe();

  }


  public onAddClick() {

  }

  public onRefreshNodeClick() {
    if (this.contextMenuNodeId) {
      this.navTreeService.refreshNode(this.contextMenuNodeId);
    }
  }
  public onDeleteClick() {

    this.waitForDialog(this.loadingDeleteData).subscribe();

    merge(this.objectOpsService.deleteSelectedNodes(this.selected$.value.map(n => n.id))).pipe(
      tap((data) => {
        console.log(data);
      }),
    ).subscribe();
  }

  public onViewClick() {
    // this.navTreeService.onTreeNodeDisplay(clickEvent);
    // const clickEvent: ItemClickedEvent = {

    // }

    //   const clickEvent: ItemClickedEvent = {
    //     id: this.item.id,
    //     parentId: this.item.parentUrl?.match(lastSegment)?.[0] ?? '',
    //     itemReference: this.item.itemReference,
    //     objectType: this.item.objectType,
    //     classification: this.item.classification,
    //     name: this.item.name,
    //     modifiers: eventModifiers,
    //   }

    // createClickedEvent(event: MouseEvent): ItemClickedEvent {
    //   const ctrlKey = this.pickerMode
    //     ? this.forceMultiSelect
    //     : (this.forceMultiSelect ? true : event.ctrlKey);
    //   const eventModifiers: EventModifiers = {
    //     ctrlKey: ctrlKey,
    //     shiftKey: event.shiftKey,
    //     altKey: event.altKey,
    //   };

    //   return clickEvent;
    // }
  }


  public onCopyClick() {
    this.objectOpsService.copySelectedRecursive().pipe(
      tap({
        subscribe: () => {
          this.loadingCopyData.set(true);
          this.objectOpsService.copyProgress.set(null);
        },
        finalize: () => {
          this.loadingCopyData.set(false);
        },
      }),
      tap((progress) => {
        if (progress.done) {
          this.pasteAllowed.set(progress.successCount > 0);
          this.pendingCopiedItems = this.pendingCopiedItems.filter(snapshot => { return !this.objectOpsService.copiedSnapshots.some(cSnap => cSnap.sourceObjectId == snapshot.sourceObjectId) })
        }
      }),
    ).subscribe();
  }

  public onRetryCopySubtree(failedRootId: string): void {
    this.objectOpsService.retryCopySubtree(failedRootId).pipe(
      tap({
        subscribe: () => this.loadingCopyData.set(true),
        finalize: () => this.loadingCopyData.set(false),
      }),
      tap((progress) => {
        if (progress.done) {
          this.pasteAllowed.set(progress.successCount > 0);
          this.pendingCopiedItems = this.objectOpsService.copiedSnapshots;
        }
      }),
    ).subscribe();
  }

  public onPasteClick() {
    if (!this.pasteAllowed() || this.pendingCopiedItems.length !== 0) {
      return;
    }

    this.objectOpsService.validatePasteLocationForCurrentSelection().pipe(
      take(1),
      switchMap((pasteEvent) => {
        if (!pasteEvent.valid) {
          this._snackBar.open(
            'Invalid paste location. Select exactly one destination object that supports all copied object types.',
            'Ok',
            {
              panelClass: ['snackbar-error'],
              verticalPosition: 'top',
              horizontalPosition: 'center',
            },
          );
          return EMPTY;
        }

        return this.objectOpsService.preloadPasteSiblingContext(pasteEvent.parentId, pasteEvent.items).pipe(
          map((siblingContext) => ({ pasteEvent, siblingContext })),
        );
      }),
      take(1),
      tap(({ pasteEvent, siblingContext }) => {
        const { parentId, items, ignoredNodes } = pasteEvent;
        const data: ActionWarnEvent = {
          operation: 'paste',
          message: `Configure paste settings for ${items.length} object${items.length > 1 ? 's' : ''}`,
          doSomething: 'Paste',
          pasteItems: items,
          pasteParentId: parentId,
          ignoredNodes,
          pasteSiblingContext: siblingContext,
        };

        const dialogRef = this._dialog.open(PasteDialogComponent, {
          data, disableClose: true, width: '80vw',
        });
        dialogRef.afterClosed().subscribe((result: string) => {
          if (result !== 'Cancel') {
            this.pendingCopiedItems = [];
            this.pasteAllowed.set(false);
          }
        });
      }),
      tap({
        subscribe: () => {
          this.objectOpsService.fetchingPasteData.set(true);
        },
        finalize: () => {
          this.objectOpsService.fetchingPasteData.set(false);
        },
      }),

    ).subscribe();
  }

  private waitForDialog(loadingSignal: WritableSignal<boolean>): Observable<void> {
    return this.navTreeService.dialogActionsSubject$.asObservable().pipe(
      take(1),
      switchMap(() => EMPTY),
      tap({
        subscribe: () => loadingSignal.set(true),
        complete: () => loadingSignal.set(false),
      }),
    )
  }



  // private


}
