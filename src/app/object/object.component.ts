import { CommonModule } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Input, OnDestroy, OnInit, Signal, signal, ViewChild, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon, MatIconModule } from '@angular/material/icon';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { EMPTY, filter, map, Observable, Subject, switchMap, take, takeUntil, takeWhile, tap, throwIfEmpty } from 'rxjs';
import { StreamService } from '../stream.service';
import { Classification, GetObjectsResponseItemsInner } from '../api';
import { isObjectEntityInTree, } from '../api-extensions';
import { objectSkeletonTheme } from '../constants/ngxSkeleton.consants';
import { fqrInPath } from '../helpers/itemReference';
import { lastSegment } from '../constants/api.constants';
import { IconService } from '../icon.service';
import { EventModifiers, isItemSelectedData, ItemClickedEvent, ItemSelectedData } from '../models/event.models';
import { fontIcons, ObjectTreeIcons } from '../models/icon-styling.models';
import { NavigationTreeService } from '../navigation-tree.service';
import { MatBadgeModule } from '@angular/material/badge';
import { ObjectOperationsService } from '../object-operations.service';


@Component({
  selector: 'app-object[item]',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    NgxSkeletonLoaderComponent,
  ],
  templateUrl: './object.component.html',
  styleUrl: './object.component.scss'
})
export class ObjectComponent implements OnInit, OnDestroy {
  @Input({ required: true }) item!: GetObjectsResponseItemsInner;
  @Input({ required: false }) parentId!: string;
  @Input() selectableObjectTypes: string[] | null = null;
  @Input() disableNonMatchingSelection: boolean = false;
  @Input() forceMultiSelect: boolean = false;
  @Input() pickerMode: boolean = false;
  @ViewChild('node') conversationBlock!: ElementRef<HTMLDivElement>;
  @ViewChild('icon', { static: true }) nodeIcon!: MatIcon;
  private _iconService = inject(IconService);
  private _streamService = inject(StreamService);
  private _destroyRef = inject(DestroyRef);
  public navigationTreeService = inject(NavigationTreeService);
  public objectOperationsService = inject(ObjectOperationsService);

  public showItems: WritableSignal<boolean> = signal(false);
  public icon!: ObjectTreeIcons;
  public node$!: Observable<GetObjectsResponseItemsInner | undefined>;
  public loading: WritableSignal<boolean> = signal(false);

  public selected$: Observable<any>;
  public displayed$: Observable<any>;
  public unsavedChanges$?: Observable<any>;
  public nodeClicked$: Subject<MouseEvent> = new Subject<MouseEvent>();
  public nodeDoubleClicked$: Subject<MouseEvent> = new Subject<MouseEvent>();

  public initExpanded: boolean | undefined;
  public isInSelectionFqr$!: Observable<any>;
  public isObjectEntityInTree = isObjectEntityInTree;
  public initFqrSource$!: Observable<string[] | ItemSelectedData[]>;

  public skeletonTheme = objectSkeletonTheme;

  //TODO: If the object is a child node and is destroyed by the parent by clicking the '-', we need to retain the state OR we can delete the subscription onDestroy and recreate it if created again
  public objectStatus: WritableSignal<string | null> = signal(null);
  public objectAlarmState: WritableSignal<string | null> = signal(null);
  public objectSubscriptionId: WritableSignal<string | null> = signal(null);
  public badgeReady = signal(false);

  // public testTrigger = signal(true);//! Remove after testing!

  public showBadge: Signal<boolean> = computed(() => {
    const status = this.objectStatus();
    const alarmState = this.objectAlarmState();
    if (status === 'objectStatusEnumSet.osOffline' || status === 'controllerStatusEnumSet.csOffline' || status === 'controllerStatusEnumSet.csCommDisable') return true;
    if (status === 'controllerStatusEnumSet.csOnline') return false;
    return !!alarmState && alarmState !== 'objectStatusEnumSet.osNormal';
  });

  public badgeIcon: Signal<string> = computed(() => {
    let iconEnumName = this.objectStatus() ?? '';
    if (!this.isOffline(this.objectStatus())) {
      iconEnumName = this.objectAlarmState() ?? '';
    }
    return this._iconService.getSvgIcon(iconEnumName);
  });

  public badgeIsSvg: Signal<boolean> = computed(() => this._iconService.isSvgIcon(this.badgeIcon()));

  constructor() {
    afterNextRender(() => this.badgeReady.set(true));

    effect(() => {
      const isExpanded = this.showItems();
      const objectId = this.item?.id;
      if (!objectId) {
        return;
      }

      if (isExpanded) {
        this.syncChildStatusBatch();
      } else {
        this._streamService.releaseChildObjectStatuses(objectId);
      }
    });

    this.selected$ = this.navigationTreeService.selectedNodes$.pipe(
      map((selectedNodes) => selectedNodes.some((node) => node.id === this.item.id)),
    );

    this.displayed$ = this.navigationTreeService.displayedNodes$.pipe(
      map((selectedNodes) => selectedNodes.some((node) => node.id === this.item.id)),
      // filter((isSelected) => isSelected),//!
      tap((isSelected) => {
        if (isSelected) {
          this.unsavedChanges$ = this.navigationTreeService.listenForUnsavedChanges(this.item.id).pipe(
            takeWhile(() => isSelected),
          )
        } else {
          this.unsavedChanges$ = EMPTY;
        }
      })
    );

    this.initFqrSource$ = this.navigationTreeService.selectedFqr$;

    this.nodeClicked$.pipe(
      switchMap(() => this.navigationTreeService.getNode(this.item.id)),
      tap((data) => {
        if (data) {
          this.item = data;
        }
      }),
      takeUntilDestroyed(),
    ).subscribe();



  }

  public isOffline(objectStatus: string | null): boolean {
    return objectStatus === 'objectStatusEnumSet.osOffline' || objectStatus === 'controllerStatusEnumSet.csOffline' || objectStatus === 'controllerStatusEnumSet.csCommDisable';
  }

  public getStateString(stateEnum: string | null): string | undefined {
    if (stateEnum) {
      return stateEnum.split('.')[1] ?? stateEnum;
    } return void 0;
  }

  private getStatusPriority(): 'interactive' | 'background' {
    return this.navigationTreeService.selectedNodesSubject$.value.some((node) => node.id === this.item.id)
      ? 'interactive'
      : 'background';
  }

  private getChildStatusTargets(): Array<{ objectId: string; classification?: Classification | string }> {
    if (!isObjectEntityInTree(this.item)) {
      return [];
    }

    return this.item.items
      .filter((child) => child.objectType !== 'objectTypeEnumSet.containerClass')
      .map((child) => ({
        objectId: child.id,
        classification: child.classification,
      }));
  }

  private syncChildStatusBatch(): void {
    const childTargets = this.getChildStatusTargets();
    if (childTargets.length === 0) {
      return;
    }

    this._streamService.provisionChildObjectStatuses(this.item.id, childTargets, this.getStatusPriority()).pipe(
      takeUntilDestroyed(this._destroyRef),
    ).subscribe();
  }

  ngOnInit(): void {
    if (this.item.name == '') {
      this.item.name = this.item.label;
    }



    const parentId = this.item.parentUrl?.match(lastSegment)?.[0];

    if (this.item.objectType !== 'objectTypeEnumSet.containerClass') {
      const status$ = parentId
        ? this._streamService.connectToManagedObjectStatus(this.item.id, this.item.classification, parentId, this.item.hasChildrenMatchingQuery)
        : this._streamService.listenToObjectStatus(this.item.id, this.item.classification, parentId, this.item.hasChildrenMatchingQuery, this.getStatusPriority());

      status$.pipe(
        tap((update) => {
          if (update.subscriptionId) {
            this.objectSubscriptionId.set(update.subscriptionId);
          }
        }),
        takeUntilDestroyed(this._destroyRef),
      ).subscribe(({ status, alarmState }) => {
        if (status !== undefined) this.objectStatus.set(status);
        if (alarmState !== undefined) this.objectAlarmState.set(alarmState);
      });
    }

    this.updateIcon();
    this.node$ = this.navigationTreeService.getNode(this.item.id).pipe(
      tap((data) => {
        if (data) {
          this.item = data;
          if (typeof (data.expanded) == 'boolean') {
            this.initExpanded = data.expanded;
            this.showItems.set(this.initExpanded);
          }
          if (this.showItems()) {
            this.syncChildStatusBatch();
          }
        }
      }),
    );

    if (this.pickerMode) {
      this.initFqrSource$ = this.navigationTreeService.contextMenuInitialSelection$;
      this.selected$ = this.navigationTreeService.pickerSelectedNodes$.pipe(
        map((nodes) => nodes.some((node) => node.id === this.item.id)),
      );
    }

    this.isInSelectionFqr$ = this.initFqrSource$.pipe(
      // take(1),
      tap((data: Array<string> | Array<ItemSelectedData>) => {
        const fqrs = [];
        if (data.every((fqr) => isItemSelectedData(fqr))) {
          data.forEach((d) => fqrs.push(d.itemReference));
        } else {
          fqrs.push(...(data as Array<string>));
        }
        if (!fqrs.includes(this.item.itemReference)) {//* If this current object instance is not a direct match to the FQR array  & ...
          if (!this.item.expanded) {
            fqrs.forEach(ref => {
              if (fqrInPath(this.item.itemReference, ref)) {
                this.showItems.set(true);
                this.item.expanded = true;
              }
            })

          }

        } else {
          if (this.item.hasChildrenMatchingQuery) {
            this.showItems.set(true);
            this.item.expanded = true;
          }
        }
        //* If child nodes are selected along with their parent node, the first if-statement, if we are on the parent node object component instance, ignores this and desn't set the 'expanded' property for the object
      }),
    )

    this.isInSelectionFqr$.subscribe();
  }

  ngOnDestroy(): void {
    this._streamService.releaseChildObjectStatuses(this.item.id);

    if (typeof (this.initExpanded) == 'boolean' && this.initExpanded != this.showItems()) {
      this.navigationTreeService.updateNode(this.item);
    }
  }

  public getObjectLabel(): string {
    return `${this.item.name.length > 0 ? this.item.name : this.item.label} {${this.item.label}}`;
  }

  updateIcon() {
    this.icon = this._iconService.getIconForClass(this.item);//* Retrieves the icon string based on the item's 'classification' and 'objectType' properties
    if (this._iconService.isSvgIcon(this.icon)) {
      this.nodeIcon.svgIcon = this.icon;
    } else if (fontIcons.includes(this.icon)) {
      this.nodeIcon.fontIcon = this.icon;
    } else {
      this.nodeIcon.fontIcon = 'help';
    }
  }

  onContextMenu(event: MouseEvent) {
    if (!this.pickerMode) {
      if (this.isSelectionDisabled()) {
        return;
      }
      event.preventDefault();
      //* if the user right-clicks on a node that is not currently selected, we select it first before opening the context menu. If the user right-clicks on a node that is already selected, we keep the current selection as is when opening the context menu
      if (!this.navigationTreeService.selectedNodesSubject$.value.some((node) => node.id === this.item.id)) {
        this.onClickNode(event);
      }
      this.navigationTreeService.contextMenuTrigger$.next({ event, nodeId: this.item.id });
    }
  }

  onClickNode(event: MouseEvent) {
    if (this.isSelectionDisabled()) { event.stopPropagation(); event.preventDefault(); return; }
    const clickEvent = this.createClickedEvent(event);
    if (this.pickerMode) {
      this.navigationTreeService.onPickerNodeSelect(clickEvent);
    } else {
      this.navigationTreeService.onTreeNodeSelect(clickEvent);
    }
  }

  onDoubleClickNode(event: MouseEvent) {
    if (!this.pickerMode) {
      if (this.isSelectionDisabled()) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      const clickEvent = this.createClickedEvent(event);
      if (this.navigationTreeService.displayedNodesSubject$.value.some((item) => this.item.id === item.id)) {
        if (clickEvent.modifiers?.ctrlKey) {
          this.navigationTreeService.onTreeNodeDisplay(clickEvent);
        }
      } else {
        this.navigationTreeService.onTreeNodeDisplay(clickEvent);
      }
    }
  }

  createClickedEvent(event: MouseEvent): ItemClickedEvent {
    const ctrlKey = this.pickerMode
      ? this.forceMultiSelect
      : (this.forceMultiSelect ? true : event.ctrlKey);
    const eventModifiers: EventModifiers = {
      ctrlKey: ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    const clickEvent: ItemClickedEvent = {
      id: this.item.id,
      parentId: this.item.parentUrl?.match(lastSegment)?.[0] ?? '',
      itemReference: this.item.itemReference,
      objectType: this.item.objectType,
      classification: this.item.classification,
      name: this.item.name,
      modifiers: eventModifiers,
    }
    return clickEvent;
  }

  public isSelectionDisabled(): boolean {
    if (!this.disableNonMatchingSelection) {
      return false;
    }
    if (!this.selectableObjectTypes || this.selectableObjectTypes.length === 0) {
      return false;
    }

    return !this.selectableObjectTypes.some((allowedType) => {
      return this.item.objectType === allowedType || this.item.objectType.endsWith(`.${allowedType}`);
    });
  }

  onExpandSubItemsClick(event: MouseEvent) {
    event.stopPropagation();
    this.showItems.set(!this.showItems());
    this.item.expanded = this.showItems();
  }

}
