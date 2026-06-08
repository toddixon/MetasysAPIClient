// import { , OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Component, inject, Input, OnChanges, OnInit, SimpleChanges, OnDestroy, WritableSignal, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer } from '@angular/platform-browser';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { BehaviorSubject, catchError, defer, distinctUntilChanged, EMPTY, filter, forkJoin, from, isObservable, map, mergeMap, Observable, of, shareReplay, Subject, switchMap, take, takeUntil, tap, throwError, withLatestFrom } from 'rxjs';
import { ngxSkeletonThemes } from '../constants/ngxSkeleton.consants';
import { DisplayItem, UnsavedChangesObj } from '../models/display.models';
import { FormService } from '../form.service';
import { DisplayGroup, DisplayViewPage, isFloatType } from '../models/object-views.models';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { EnumMember, isEnumMemberArr } from '../models/enum-set.models';
import { environment } from '../../environments/environment.development';
import { LoggerService } from '../logger.service';
import { ControlGroupComponent } from "../control-group/control-group.component";
import { ObjectManagerService } from '../objectManager.service';
import { NavigationTreeService } from '../navigation-tree.service';
import { StreamService } from '../stream.service';
import { GetObjectCommands200ResponseItemsInner, GetObjectsResponseItemsInner, GetObjectTypeSchema200Response, GetObjectViews200ResponseItemsInner } from '../api';
import { MatMenuModule } from '@angular/material/menu';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ObjectCommandDialogComponent } from '../object-command-dialog/object-command-dialog.component';
import { DivFormControlDirective } from "../directives/divFormControl";
import { PriorityArray } from '../models/object-attribute.models';
import { CommandPriorityEntry } from '../models/objectCommand.models';
import { FormControlWithMetaData, ObjectReferenceEditorConfig } from '../models/formControlWithMetadata.model';
import { FormGroupWithMetaData } from '../models/formGroupWithMetadata.model';
import { filterNull } from '../helpers/rxjs.helpers';
import { lastSegment } from '../constants/api.constants';
import { isSchema, Schema } from '../models/object-schema.models';
import { ObjectReferencePickerDialogComponent, ObjectReferencePickerDialogResult } from '../dialog-components/object-reference-picker-dialog/object-reference-picker-dialog.component';
import { isItemSelectedData, ItemSelectedData } from '../models/event.models';

@Component({
  selector: 'app-dynamic-form',
  host: { '[class.dynamic-form--compact]': 'isMulti' },
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatTabsModule,
    MatCheckboxModule,
    MatMenuModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatDividerModule,
    NgxSkeletonLoaderComponent,
    ControlGroupComponent,
    DivFormControlDirective,
    MatRippleModule,
    MatIcon,
  ],
  templateUrl: './dynamic-form.component.html',
  styleUrl: './dynamic-form.component.scss',
})
export class DynamicFormComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) displayItem!: DisplayItem;
  @Input() isMulti: boolean = false;
  private _sanitizer = inject(DomSanitizer);
  private _loggerService = inject(LoggerService);
  private _formService = inject(FormService);
  private _dialog = inject(MatDialog);
  private _objectManagerService = inject(ObjectManagerService);
  private _navigationTreeService = inject(NavigationTreeService);
  private _streamService = inject(StreamService);
  public useDisplayFieldComponent: boolean = false;
  public displayViews$!: Observable<DisplayViewPage>;
  public nodeData$!: Observable<GetObjectsResponseItemsInner | undefined>;
  public isObservable = isObservable;
  public isFloatType = isFloatType;
  public disableSave: WritableSignal<boolean> = signal(true);
  public cardCollapsed = signal(false);
  public collapsedViews: WritableSignal<Set<string>> = signal(new Set());
  public keyFlash = signal(false);
  public objectStatus$!: Observable<{ status?: string | null; alarmState?: string | null }>;
  private _flashTimer?: ReturnType<typeof setTimeout>;

  private stopSubject$: Subject<void> = new Subject();

  public controlRippleColor: string = 'hsla(0, 0%, 100%, 0.39)';
  public controlRippleRadius: number = 100;

  /** When true the refresh button shows a spinning animation */
  public refreshSpinning: boolean = false;

  public remoteUpdates$!: Observable<any>;

  public mainForm!: FormGroupWithMetaData;
  public views$!: Observable<any>;

  /** All view metadata items returned by the views endpoint. */
  public altViewList = signal<GetObjectViews200ResponseItemsInner[]>([]);
  /** Built DisplayViewPage for each alternative view, keyed by view id. */
  public altViewPages = signal<Map<string, DisplayViewPage>>(new Map());
  /** Set of view ids currently being fetched/built. */
  public altViewsLoading = signal<Set<string>>(new Set());


  public ngxSkeletonThemes = ngxSkeletonThemes;
  public skeletonViewCount: Array<number> = [0, 1, 2];

  public objectData!: Observable<any>;
  public isProd: boolean = environment.production;
  public objectCommands$!: Observable<Array<GetObjectCommands200ResponseItemsInner>>;
  private commandPrioritySupported: boolean = false;
  private updateSubject$: Subject<any> = new Subject();
  private objectChanges$!: Observable<Record<string, any>>;
  private enabledCtrls: FormControlWithMetaData[] = [];

  constructor() {
    // this.mainForm = new FormGroupWithMetaData({} as Record<string, FormGroupWithMetaData>);



  }

  ngOnInit(): void {

    this.nodeData$ = defer(() => this.displayItem.node$).pipe(
      tap((data) => {
        console.log(data);
      }),
      // shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.objectCommands$ = defer(() => this._objectManagerService.getObjectCommands(this.displayItem.itemData.id)).pipe(
      takeUntil(this.stopSubject$),
      tap((items) => {
        console.log(items);
      })
    );

    this._formService.saveAllSubject$.pipe(
      takeUntil(this.stopSubject$),
      filter(() => !this.disableSave()),
      mergeMap(() => this.onSaveClick()),
      tap({
        complete: () => console.log(`saveAllObject$ for ${this.displayItem.itemData.id} Completed!`),
      }),
    ).subscribe();

    this.objectStatus$ = defer(() =>
      this._streamService.listenToObjectStatus(this.displayItem.itemData.id)
    ).pipe(
      takeUntil(this.stopSubject$),
      shareReplay({ bufferSize: 1, refCount: false }),
    );


    this.displayViews$ = defer(() => this.displayItem.item$).pipe(
      //TODO: Find a way to have when the item$ is refreshed don't entirely rebuild the form from the schema
      distinctUntilChanged((prevItem, currItem) => prevItem.item['id'] == currItem.item['id']),//* This will work for now. by subscribing to remote changes and local ones, this should guarentee that the form is up to date
      takeUntil(this.stopSubject$),
      tap((data: any) => {
        this.commandPrioritySupported = data.item.prioritySupported;
      }),
      map((item) => this._formService.buildFormFromSchema(item)),
      tap((data) => {
        const controls: Record<string, FormGroupWithMetaData> = {};
        if (data.keyView) {
          const id = data.keyView.group.id.split('.')[1] ?? data.keyView.group.id;
          controls[id] = data.keyView.group;
        }
        data.views.forEach((v) => {
          v.views.forEach((v) => {
            const id = v.group.id.split('.')[1] ?? v.group.id;
            controls[id] = v.group;
          })
        })
        this.enabledCtrls = this.getEnabledCtrls(controls);
        this.mainForm = new FormGroupWithMetaData(controls, { id: data.objectId, title: data.name });
        this._formService.attachAlarmValuesValidators(this.mainForm);
        this.listenToChanges(this.mainForm);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.remoteUpdates$ = this.displayViews$.pipe(
      takeUntil(this.stopSubject$),
      switchMap((viewPage) => {
        return this._objectManagerService.getAttributesBatch(viewPage.objectId, viewPage.dynamicProperties).pipe(
          map((updates) => ({ viewPage, updates })),
        );
      }),//? Would adding a 'buffer'/scan operator here to catch multiple updates first and then performing the update result in better performance? 
      mergeMap((v) => {
        return this._formService.updateDisplayPageControls(v);
      }),
    );

    this.remoteUpdates$.subscribe(this.updateSubject$);

    // Flash the command button when the server pushes a new key-attribute value
    this.updateSubject$.pipe(
      takeUntil(this.stopSubject$),
      withLatestFrom(this.displayViews$),
      filter(([update, viewPage]) =>
        viewPage.keyView?.keyAttribute != null &&
        update.control?.name === viewPage.keyView.keyAttribute
      ),
    ).subscribe(() => this._triggerKeyFlash());
    // After the default view loads, eagerly fetch and build all alternative views.
    this.displayViews$.pipe(
      switchMap(viewPage => {
        //* At this point, the default view for the object has been fetched. Now we want to fetch the list of all available views for this object, and then fetch/build each of those views in turn.
        this.altViewList.set([]);
        this.altViewPages.set(new Map());
        this.altViewsLoading.set(new Set());
        return this._objectManagerService.getObjectViews(viewPage.objectId).pipe(
          tap(viewsResponse => {
            let uniqueViews = viewsResponse.items.filter((view, idx, self) =>
              view.id !== 'viewNameEnumSet.ssFocusView' && self.findIndex(v => v.id === view.id) === idx
            );
            this.altViewList.set(uniqueViews);
            this.altViewsLoading.set(new Set(uniqueViews.map(v => v.id)));
          }),
          switchMap(viewsResponse =>
            from(viewsResponse.items).pipe(
              mergeMap(viewItem => {
                const shortViewId = viewItem.id.split('.').pop() ?? viewItem.id;
                return this._objectManagerService.getObjectView(viewPage.objectId, shortViewId).pipe(
                  map(data => ({ viewId: viewItem.id, data })),
                  catchError(() => {
                    this.altViewsLoading.update(s => { const n = new Set(s); n.delete(viewItem.id); return n; });
                    return EMPTY;
                  }),
                );
              }),
            )
          ),
        );
      }),
      takeUntil(this.stopSubject$),
    ).subscribe(({ viewId, data }) => {
      const page = this._formService.buildFormFromSchema(data);
      this.altViewPages.update(m => new Map(m).set(viewId, page));
      this.altViewsLoading.update(s => { const n = new Set(s); n.delete(viewId); return n; });
    });

  }

  public toggleCardCollapse(): void {
    this.cardCollapsed.update(v => !v);
  }

  /** Converts a Metasys view enum id (e.g. `viewNameEnumSet.focusView`) to a human-readable label. */
  public viewIdToLabel(viewId: string): string {
    const short = viewId.split('.').pop() ?? viewId;
    return short.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
  }

  public toggleViewCollapse(viewId: string): void {
    this.collapsedViews.update(current => {
      const next = new Set(current);
      next.has(viewId) ? next.delete(viewId) : next.add(viewId);
      return next;
    });
  }

  public isViewCollapsed(viewId: string): boolean {
    return this.collapsedViews().has(viewId);
  }

  /** Maps a Metasys object status/alarmState enum value to a CSS class. */
  public getStatusClass(status?: string | null, alarmState?: string | null): string {
    const active = (alarmState && alarmState !== 'objectStatusEnumSet.osNormal') ? alarmState : status;
    if (!active || active === 'objectStatusEnumSet.osNormal') return '';
    if (active.includes('osAlarmUnacknowledged')) return 'status--alarm-unack';
    if (active.includes('osAlarm')) return 'status--alarm';
    if (active.includes('Warning')) return 'status--warning';
    if (active.includes('osOffline') || active.includes('csOffline') || active.includes('CommDisable')) return 'status--offline';
    if (active.includes('Override') || active.includes('osOverride')) return 'status--override';
    if (active.includes('osFault') || active.includes('osUnreliable')) return 'status--fault';
    if (active.includes('osDisabled')) return 'status--disabled';
    return '';
  }

  /** Returns a human-readable label for the active status/alarmState. */
  public getStatusLabel(status?: string | null, alarmState?: string | null): string {
    const active = (alarmState && alarmState !== 'objectStatusEnumSet.osNormal') ? alarmState : status;
    if (!active || active === 'objectStatusEnumSet.osNormal') return '';
    if (active.includes('osAlarmUnacknowledged')) return 'Alarm (Unack)';
    if (active.includes('osAlarm')) return 'Alarm';
    if (active.toLowerCase().includes('highwarning')) return 'High Warning';
    if (active.toLowerCase().includes('lowwarning')) return 'Low Warning';
    if (active.includes('Warning')) return 'Warning';
    if (active.includes('osOffline') || active.includes('csOffline') || active.includes('CommDisable')) return 'Offline';
    if (active.includes('Override') || active.includes('osOverride')) return 'Operator Override';
    if (active.includes('osFault')) return 'Fault';
    if (active.includes('osUnreliable')) return 'Unreliable';
    if (active.includes('osDisabled')) return 'Disabled';
    return '';
  }

  private _triggerKeyFlash(): void {
    this.keyFlash.set(true);
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => this.keyFlash.set(false), 1400);
  }

  ngOnDestroy(): void {
    this.stopSubject$.next();
    this._streamService.removeObjectSubscriptions(this.displayItem.itemData.id);
    clearTimeout(this._flashTimer);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (Object.keys(changes).includes('isMulti')) {
      if (changes['isMulti'].currentValue == false && this.cardCollapsed() == true) {
        this.cardCollapsed.set(false);
      }
    }

    //? Could we have a feature that looks at the point type, and if the point 
    //? type is the same as the previous we could have it use the same existing schema 
    if (Object.keys(changes).includes('item') && changes['item'].previousValue) {
      // console.log('changes!!!');
      // this.newItemSubject$.next();
    }

  }

  public listenToChanges(form: FormGroupWithMetaData) {
    const initialValue$ = new BehaviorSubject<any>(form.value);//TODO: when changes are saved, update the initial value parameter

    const remoteUpdates$ = this.updateSubject$.pipe(
      filter((update) => {
        return update.control.parent.id !== 'viewGroupEnumSet.noGrp' && update.control.enabled == true
      }),
      map((update) => {
        let updatedInit = initialValue$.value;
        let groupName = update.control.parent.id.split('.')[1] ?? update.control.parent.id;
        try {
          updatedInit[groupName][update.control.name] = update.value;
        } catch (err) {
          let c = updatedInit[groupName][update.control.name]
          let y = update.value
          let f = err
          this._loggerService.errorSubject$.next(c);

        }
        return updatedInit;
      })
    )
    //TODO: For string input formcontrols, we should have some sort of debounce/throttle operator so that we aren't updating the controls changes each character the user types 
    this.objectChanges$ = form.valueChanges.pipe(
      takeUntil(this.stopSubject$),
      distinctUntilChanged(),
      map((update) => {
        return Object.fromEntries(Object.entries(update).filter(([k, v]) => k !== 'noGrp'));
      }),
      withLatestFrom(initialValue$),
      map(([update, initVal]) => {
        let changes: Record<string, any> = {};
        Object.entries(update).forEach(([groupName, groupCtrls]: [string, any]) => {
          Object.keys(groupCtrls).forEach((ctrlName) => {
            if (!this.compareObjs(groupCtrls[ctrlName], initVal[groupName][ctrlName])) {
              let ctrlRef = [groupName, ctrlName].join('.');
              changes[ctrlRef] = groupCtrls[ctrlName];
            }
          })
        })

        this.disableSave.set(!(Object.keys(changes).length > 0));
        return changes;
      }),
      distinctUntilChanged((prev, curr) => {
        return this.compareObjs(curr, prev);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
      tap((changes) => {
        let objUnsavedChng: UnsavedChangesObj = { objectId: this.displayItem.itemData.id, objectName: this.displayItem.title };
        if (Object.keys(changes).length > 0) {
          objUnsavedChng.changes = changes;
        }

        this._formService.unsavedChangesUpdateSubject$.next(objUnsavedChng);
      }),
      tap({
        complete: () => {
          this._formService.unsavedChangesUpdateSubject$.next(this.displayItem.itemData.id);
        },
      }),
    )

    remoteUpdates$.subscribe(initialValue$);
    this.objectChanges$.subscribe();

  }

  private compareObjs(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;

    if (obj1 instanceof Date || obj2 instanceof Date) {
      if (!(obj1 instanceof Date) || !(obj2 instanceof Date)) {
        return false;
      }
      return obj1.getTime() === obj2.getTime();
    }

    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.compareObjs(obj1[key], obj2[key])) return false;
    }

    return true;
  }

  private getEnabledCtrls(formGroups: Record<string, FormGroupWithMetaData>): FormControlWithMetaData[] {
    const enabledCtrls: FormControlWithMetaData[] = [];
    Object.entries(formGroups).forEach(([grpName, grp]) => Object.entries(grp.controls).forEach(([grpName, ctrl]) => ctrl.enabled ? enabledCtrls.push(ctrl as FormControlWithMetaData) : undefined));
    return enabledCtrls;
  }

  private toggleEnabledCtrls(enable: boolean) {
    this.enabledCtrls.forEach((ctrl) => {
      enable ? ctrl.enable({ emitEvent: false }) : ctrl.disable({ emitEvent: false });
    })
  }


  public findControlInViewPage(displayPage: DisplayViewPage, name: string): FormControlWithMetaData | void {
    let control: FormControlWithMetaData | undefined;
    displayPage.views.find(v => {
      v.views.find(g => {
        control = g.group.get(name) as FormControlWithMetaData ?? undefined;
        return control;
      });
      return control ? true : false;
    })
    return control;
  }

  public getControl(form: FormGroupWithMetaData, name: string): FormControlWithMetaData {
    let control = form.get(name);

    return control as FormControlWithMetaData;
  }

  public isEnumSet(obj: string | EnumMember[] | EnumMember, control?: any) {
    let f = control
    return isEnumMemberArr(obj);
  }

  public isEnumMember(obj: string | EnumMember[] | EnumMember): obj is EnumMember {
    return !Array.isArray(obj) && typeof obj !== 'string';
  }

  public openCommandDialog(command: GetObjectCommands200ResponseItemsInner, keyGroup: DisplayGroup) {
    let priorityArray$: Observable<{ commandEntry: CommandPriorityEntry[], enumSet: EnumMember[] }> | undefined;
    if (this.commandPrioritySupported) {
      const priorityEnumSet = this._objectManagerService.getEnumSet('writePriorityEnumSet').pipe(
        map((set) => set.oneOf),
        tap((data) => {
          let f = data;
        }),
      );
      const valueControl = keyGroup.group.get(keyGroup.keyAttribute ?? 'command') as FormControlWithMetaData;
      const valueEnumSet = isObservable(valueControl.type) ? valueControl.type : of(null);

      let enumSets$ = forkJoin({ priorityEnumSet, valueEnumSet });

      priorityArray$ = this._objectManagerService.getAttributeValue(this.displayItem.itemData.id, 'priorityArray', false).pipe(
        switchMap((res) => {
          if ('priorityArray' in res.item && Array.isArray(res.item.priorityArray) && res.item.priorityArray.some(p => p !== null)) {
            const pArr = res.item.priorityArray as PriorityArray;

            return enumSets$.pipe(
              map(({ priorityEnumSet, valueEnumSet }) => {
                const p: Array<CommandPriorityEntry> = [];
                pArr.forEach((v, i) => {
                  if (v) {
                    const member = priorityEnumSet[i + 1];
                    const priorityTitle: string = member.title;
                    const valueTitle: string = valueEnumSet?.find(m => m.const == v)?.title ?? v;
                    const priorityEntry: CommandPriorityEntry = { priority: priorityTitle, value: valueTitle, memberId: member.memberId! };
                    p.push(priorityEntry);
                  }
                });
                return { commandEntry: p, enumSet: priorityEnumSet };
              }),
            );
          } else {
            return of({ commandEntry: [], enumSet: [] });
          }
        }),
        tap((data) => {
          console.log(data);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }

    const dialogRef = this._dialog.open(ObjectCommandDialogComponent, {
      enterAnimationDuration: '250ms', exitAnimationDuration: '250ms', data: { objectId: this.displayItem.itemData.id, command: command, keyGroup: keyGroup, priorityArray$: priorityArray$ }, width: '60%',
    });
    dialogRef.afterClosed().pipe(
      tap((data) => {
        console.log(data);
      }),
    ).subscribe();
  }

  public onObjectReferencePickerRequested(controlOrGroup: FormControlWithMetaData | FormGroupWithMetaData): void {
    let editorConfig: ObjectReferenceEditorConfig | undefined;
    let title: string;
    let initialSelection: string[] = [];

    if (controlOrGroup instanceof FormGroupWithMetaData) {
      editorConfig = controlOrGroup.contextualEditor;
      title = controlOrGroup.title;
      const refControl = controlOrGroup.get('objectReference') as FormControlWithMetaData | null;
      const currentValue = refControl?.value;
      initialSelection = Array.isArray(currentValue)
        ? currentValue.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : typeof currentValue === 'string' && currentValue.length > 0
          ? [currentValue]
          : [];
    } else {
      editorConfig = (controlOrGroup as FormControlWithMetaData).contextualEditor;
      title = (controlOrGroup as FormControlWithMetaData).title;
      const currentValue = (controlOrGroup as FormControlWithMetaData).value;
      initialSelection = Array.isArray(currentValue)
        ? currentValue.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : typeof currentValue === 'string' && currentValue.length > 0
          ? [currentValue]
          : [];
    }

    if (!editorConfig) {
      return;
    }

    const dialogRef = this._dialog.open(ObjectReferencePickerDialogComponent, {
      width: '80vw',
      maxWidth: '1100px',
      data: {
        title: title,
        type: editorConfig.type,
        objectTypes: editorConfig.objectTypes,
        selectionMode: editorConfig.selectionMode,
        allowClear: !!editorConfig.allowClear,
        initialSelection,
        itemData: this.displayItem.itemData,
        referencedObject: controlOrGroup.contextualEditor?.referencedObject ?? undefined
      },
      enterAnimationDuration: '200ms',
      exitAnimationDuration: '160ms',
    });

    dialogRef.afterClosed().pipe(
      filter((result: ObjectReferencePickerDialogResult | undefined) => {
        return result?.selectedObjects?.every(res => isItemSelectedData(res)) ?? false;
      }),
      tap((result) => {
        if (controlOrGroup instanceof FormGroupWithMetaData) {
          const refControl = controlOrGroup.get('objectReference') as FormControlWithMetaData | null;
          const attributeControl = controlOrGroup.get('attribute') as FormControlWithMetaData | null;
          refControl?.patchValue(result?.selectedObjects[0]?.itemReference ?? null, { emitEvent: true });

          let attributeValue = result?.attribute ? `attributeEnumSet.${result.attribute}` : null;
          attributeControl?.patchValue(attributeValue, { emitEvent: true });
          // if (attributeControl && result?.attribute) {
          //   let attributeValue = `attributeEnumSet.${result.attribute}`
          //   attributeControl?.patchValue(attributeValue ?? null, { emitEvent: true });
          // }
        } else {
          const ctrl = controlOrGroup as FormControlWithMetaData;
          if (editorConfig?.selectionMode === 'multi') {
            ctrl.patchValue(result?.selectedObjects.map(res => res.itemReference), { emitEvent: true });
          } else {
            ctrl.patchValue(result?.selectedObjects[0]?.itemReference ?? null, { emitEvent: true });
          }
        }
        // }

        if (controlOrGroup.contextualEditor && controlOrGroup.contextualEditor.referencedObject) {
          controlOrGroup.contextualEditor.referencedObject.objectName = result?.selectedObjects[0]?.name ?? '';
          controlOrGroup.contextualEditor.referencedObject.objectUrl = result?.selectedObjects[0]?.id ?? '';
          controlOrGroup.contextualEditor.referencedObject.attributeUrl = result?.attribute ? `attributeEnumSet.${result.attribute}` : '';
          // controlOrGroup.contextualEditor.referencedObject = {
          //   objectName: result?.selectedObjects![0].name ?? '',
          //   objectUrl: result?.selectedObjects![0].id ?? '',
          //   attributeUrl: result?.attribute
          // }
        }



      }),
    ).subscribe();
  }

  private flattenCtrlValues(obj: object) {
    return Object.assign({}, ...Object.values(obj));
  }

  private toMetasysDateValue(value: unknown): unknown {
    if (value instanceof Date) {
      return {
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        dayOfMonth: value.getDate(),
      };
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return {
          year: parsed.getFullYear(),
          month: parsed.getMonth() + 1,
          dayOfMonth: parsed.getDate(),
        };
      }
    }

    return value;
  }

  private toMetasysTimeValue(value: unknown): unknown {
    if (value instanceof Date) {
      return {
        hour: value.getHours(),
        minute: value.getMinutes(),
        second: value.getSeconds(),
        hundredth: 0,
      };
    }

    if (typeof value === 'string') {
      const parts = value.split(':').map((v) => Number(v));
      if (parts.length >= 2 && parts.every((v) => Number.isFinite(v))) {
        return {
          hour: parts[0],
          minute: parts[1],
          second: parts[2] ?? 0,
          hundredth: 0,
        };
      }
    }

    return value;
  }

  private serializeMetasysDateTimeValues(values: Record<string, any>, schema: Schema): Record<string, any> {
    const serialized = { ...values };
    const schemaProperties = schema.properties as Record<string, any>;

    Object.entries(schemaProperties).forEach(([key, property]) => {
      if (!(key in serialized)) {
        return;
      }

      const metasysType = property?.metasysType;
      if (metasysType === 'date') {
        serialized[key] = this.toMetasysDateValue(serialized[key]);
      } else if (metasysType === 'time') {
        serialized[key] = this.toMetasysTimeValue(serialized[key]);
      }
    });

    return serialized;
  }

  public onRefreshClick($event?: any) {
    this._navigationTreeService.refreshItem$.next(this.displayItem.itemData.id);
  }

  public onRefreshButtonClick(): void {
    // start spin animation and call the refresh logic
    this.refreshSpinning = true;
    // call the existing refresh handler
    this.onRefreshClick();
    // stop spinning after animation duration
    setTimeout(() => { this.refreshSpinning = false; }, 300);
  }


  public onSaveClick(): Observable<any> {
    let successMsg = `Successfully modified properties for ${this.mainForm.title}: `;
    return this.displayItem.node$.pipe(
      filterNull(),
      map((node) => {
        const parentUrl = node.parentUrl!.match(lastSegment)![0];
        return { objectType: node.objectType, parent: parentUrl };
      }),
      take(1),
      switchMap((res) => this._objectManagerService.getObjectTypeSchema(res.objectType, res.parent).pipe(
        switchMap((objSchema: GetObjectTypeSchema200Response) => { return isSchema(objSchema.schema!) ? of(objSchema!.schema!) : throwError(() => { 'Invalid Schema type' }) }),

      )),
      withLatestFrom(this.objectChanges$.pipe(
        map((changes) => {
          const c = Object.fromEntries(Object.entries(changes).map(([key, val]) => {
            const propName = key.split('.')[1] ?? key;
            return [propName, val];
          }))
          return c as Record<string, any>;
        }),
      )),
      map(([objSchema, changes]: [Schema, Record<string, any>]): [Record<string, any>, Record<string, any>] => {
        const objectValues = this.serializeMetasysDateTimeValues(this.flattenCtrlValues(this.mainForm.value), objSchema);
        const serializedChanges = this.serializeMetasysDateTimeValues(changes, objSchema);

        const updateObj: Record<string, any> = {};
        (objSchema.required as string[]).forEach((p: string) => {//* Assign all required fields
          updateObj[p] = objectValues[p] ?? (objSchema.properties as any)[p].default;
        })
        Object.assign(updateObj, serializedChanges);//* Assign all changed values (required or not required)

        return [updateObj, serializedChanges];
      }),

      switchMap(([updateObj, actualChanges]: [Record<string, any>, Record<string, any>]) => this._objectManagerService.updateObject(this.displayItem.itemData.id, updateObj).pipe(
        tap({
          subscribe: () => {
            this.disableSave.set(true);
            this.toggleEnabledCtrls(false);
          },
          finalize: () => {
            this.toggleEnabledCtrls(true);
          }
        }),
        catchError((err) => {
          this._loggerService.errorSubject$.next(err);
          this.disableSave.set(false);
          return of(err);
        }),
        map((res) => {
          successMsg = `${successMsg} ${Object.keys(actualChanges).join(', ')}`
          actualChanges
        }),
        tap({
          complete: () => {
            //TODO: Call the refresh node here as well
            this.disableSave.set(true);
            this._formService.unsavedChangesUpdateSubject$.next({ objectId: this.displayItem.itemData.id, objectName: this.displayItem.title });
            this._loggerService.successSubject$.next(successMsg);
            this.listenToChanges(this.mainForm);
          },
        }),
      )),
    )

  }

}

