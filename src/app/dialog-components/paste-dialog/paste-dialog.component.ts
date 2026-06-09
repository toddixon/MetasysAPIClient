import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { catchError, concatMap, filter, forkJoin, finalize, from, map, of, switchMap, take, toArray, tap } from 'rxjs';
import { GetObjectsResponseItemsInner, PostObjectsBatch200Response, PostObjectsBatch200ResponseResponsesInner, PostObjectsBatchRequestRequestsInner } from '../../api';
import { isObjectEntityInTree } from '../../api-extensions';
import { ControlGroupComponent } from '../../control-group/control-group.component';
import { FormService } from '../../form.service';
import { FormControlWithMetaData, ObjectReferenceEditorConfig } from '../../models/formControlWithMetadata.model';
import { FormGroupWithMetaData } from '../../models/formGroupWithMetadata.model';
import { DisplayGroup, isFloatType, ViewConfigGroup } from '../../models/object-views.models';
import { getMainPageUniqueProperties, MainPageUniqueProperty, ObjectSnapshot, parseBatchAttributeResponse } from '../../models/copied-object.models';
import { ObjectOperation } from '../../models/dialog.models';
import { PasteSiblingContext } from '../../models/dialog.models';
import { DeleteDialogComponent } from '../delete-dialog /delete-dialog.component';
import { ObjectOperationsService } from '../../object-operations.service';
import { ObjectManagerService } from '../../objectManager.service';
import { IconService } from '../../icon.service';
import { environment } from '../../../environments/environment.development';
import { ObjectReferencePickerDialogComponent, ObjectReferencePickerDialogResult } from '../object-reference-picker-dialog/object-reference-picker-dialog.component';
import { isItemSelectedData } from '../../models/event.models';
import { ItemData } from '../../models/display.models';

const IDENTIFIER_PATTERN = /^[^\x00-\x1F\x7F\x22#'*,./:<>?@[\\\]|]+$/;
const MAIN_PAGE_UNIQUE_PROPERTY_SET = new Set<MainPageUniqueProperty>(['instanceNumber', 'macAddress', 'trunkNumber']);
const CONFIG_TAB_EXCLUDED_PROPERTIES = new Set<string>([...MAIN_PAGE_UNIQUE_PROPERTY_SET, 'localUniqueIdentifier', 'inputReference']);

type HeaderIssueSeverity = 'none' | 'warning' | 'error';

interface SnapshotDisplayMeta {
  icon: string;
  iconIsSvg: boolean;
  depth: number;
}

@Component({
  selector: 'app-paste-dialog',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatDividerModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    ControlGroupComponent,
  ],
  templateUrl: './paste-dialog.component.html',
  styleUrl: './paste-dialog.component.scss',
})
export class PasteDialogComponent extends DeleteDialogComponent implements OnInit, AfterViewInit {
  private _dialog = inject(MatDialog);
  private _fb = inject(FormBuilder);
  private _formService = inject(FormService);
  private _objectOpsService = inject(ObjectOperationsService);
  private _objectManagerService = inject(ObjectManagerService);
  private _iconService = inject(IconService);

  private _siblingLabels: string[] = [];
  private _siblingUniqueValues = new Map<MainPageUniqueProperty, Set<string>>();

  /** Warning messages keyed by `item-{index}-{propertyName}`. Warnings do not block submission. */
  private _controlWarnings = new Map<string, string>();
  public controlWarnings = signal<Map<string, string>>(new Map());
  public dev = !environment.production;

  /** Per-item list of MAC addresses available for selection (4..127 minus occupied siblings and other pasted items). */
  public macAvailableOptions = signal<number[][]>([]);
  /** Per-item toggle: true = manual numeric input, false = select from available list. */
  public macManualModes = signal<boolean[]>([]);

  public loadedChildren = signal<ObjectSnapshot[][]>([]);
  public loadingChildren = signal<boolean[]>([]);
  /** One array of ViewConfigGroups per top-level paste item (indexed by snapshot index). */
  public topLevelConfigPages = signal<ViewConfigGroup[][]>([]);
  /** [snapshotIndex][childIndex] → ViewConfigGroup[] for that child. */
  public childConfigPages = signal<ViewConfigGroup[][][]>([]);
  /** Filtered version of topLevelConfigPages — excludes properties already shown on the first tab. */
  public topLevelConfigurationPages = computed(() =>
    this.topLevelConfigPages().map((groups) => this._filterConfigGroupsForConfigTab(groups)),
  );
  /** Filtered version of childConfigPages — excludes properties already shown on the first tab. */
  public childConfigurationPages = computed(() =>
    this.childConfigPages().map((itemGroups) => itemGroups.map((groups) => this._filterConfigGroupsForConfigTab(groups))),
  );
  public snapshotDisplayMeta = computed(() => this._buildSnapshotDisplayMeta());
  public pasteStarted = signal(false);

  public keyControls: Array<FormControlWithMetaData> = [];


  public pasteForm: FormGroup;

  private readonly _siblingUniqueSeedProperties = ['macAddress', 'trunkNumber'] as const;


  constructor() {
    super();
    this.objectOperationColumns = ['name', 'reference', 'status'];


    const topLevelGroups = (this.data.pasteItems ?? []).map((item: ObjectSnapshot) => {
      item.batchAttributeResponse.responses = this._checkInitData(item);
      const viewConfigKeyControls: Array<FormControlWithMetaData> = [];

      const configGroups = this._formService.buildFormConfigGroups(item);//item.schemaResponse, item.batchAttributeResponse.responses

      const allFields = configGroups.flatMap(config =>
        config.page.views.flatMap(view =>
          view.views.flatMap(dg => dg.fields)
        )
      );

      viewConfigKeyControls.push(
        ...allFields
          .filter((field): field is FormControlWithMetaData => field instanceof FormControlWithMetaData)
          .filter((field) => CONFIG_TAB_EXCLUDED_PROPERTIES.has(field.name))
      );
      this.keyControls.push(...viewConfigKeyControls);

      return configGroups;
    });
    topLevelGroups.forEach((configGroups) => this._clearSiblingUniqueSeedValues(configGroups));
    this.topLevelConfigPages.set(topLevelGroups);

    //* Each item group represents the the primary/root item that the user selected, and has children formcontrols to represent the descendants 
    const itemGroups = (this.data.pasteItems ?? []).map((item, index) => this._buildItemFormGroup(item, topLevelGroups[index]));
    this.pasteForm = this._fb.group({ items: this._fb.array(itemGroups) });

    const count = this.data.pasteItems?.length ?? 0;
    this.loadedChildren.set(Array.from({ length: count }, () => []));
    this.loadingChildren.set(Array(count).fill(false));
    this.childConfigPages.set(Array.from({ length: count }, () => []));

    // Consume preloaded sibling context if provided
    const preloaded = this.data.pasteSiblingContext as PasteSiblingContext | undefined;
    if (preloaded) {
      this._siblingLabels = preloaded.siblingLabels;
      this._siblingUniqueValues = preloaded.siblingUniqueValues;
      const occupiedBySiblings = new Set(preloaded.siblingUniqueValues.get('macAddress') ?? new Set<string>());
      const baseMac = this._allMacRange().filter((v) => !occupiedBySiblings.has(`${v}`));
      this.macAvailableOptions.set(Array.from({ length: count }, () => [...baseMac]));
      this.macManualModes.set(Array(count).fill(false));
      this._checkTopLevelUniqueness();
      this.pasteForm.markAllAsTouched();
    } else {
      this.macAvailableOptions.set(Array.from({ length: count }, () => this._allMacRange()));
      this.macManualModes.set(Array(count).fill(false));
    }
  }

  ngAfterViewInit() {
    this.pasteForm.updateValueAndValidity();
  }


  ngOnInit() {
    const parentId = this.data.pasteParentId;
    const preloaded = this.data.pasteSiblingContext as PasteSiblingContext | undefined;
    if (parentId) {
      this._navTreeService.getNode(parentId).pipe(take(1)).subscribe({
        next: (parentNode) => {
          const siblings = isObjectEntityInTree(parentNode) ? (parentNode.items ?? []) : [];
          if (!preloaded) {
            this._siblingLabels = siblings.map((s) => (s.label ?? '').trim().toLowerCase());
            this._autofillTopLevelIdentifiers();
            this._loadSiblingUniqueValues(siblings);
          } else {
            this._autofillTopLevelIdentifiers();
          }
        },
      });
    }
  }



  get itemsArray(): FormArray<FormGroup> {
    return this.pasteForm.get('items') as FormArray<FormGroup>;
  }

  public objArr(obj: any): Array<any> {
    return Object.entries(obj);
  }

  private _buildPickerItemData(): ItemData {
    const fallback = this.data.pasteItems?.[0];
    return {
      id: fallback?.sourceObjectId ?? '',
      parentId: fallback?.sourceParentId ?? this.data.pasteParentId ?? '',
      objectType: fallback?.objectType ?? '',
      classification: fallback?.classification,
      itemReference: fallback?.itemReference ?? '',
      name: fallback?.name ?? fallback?.label ?? '',
    };
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
      editorConfig = controlOrGroup.contextualEditor;
      title = controlOrGroup.title;
      const currentValue = controlOrGroup.value;
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
        title,
        type: editorConfig.type,
        objectTypes: editorConfig.objectTypes,
        selectionMode: editorConfig.selectionMode,
        allowClear: !!editorConfig.allowClear,
        initialSelection,
        itemData: this._buildPickerItemData(),
        referencedObject: controlOrGroup.contextualEditor?.referencedObject ?? undefined,
      },
      enterAnimationDuration: '200ms',
      exitAnimationDuration: '160ms',
    });

    dialogRef.afterClosed().pipe(
      filter((result: ObjectReferencePickerDialogResult | undefined) => {
        return result?.selectedObjects?.every((res) => isItemSelectedData(res)) ?? false;
      }),
      tap((result) => {
        if (controlOrGroup instanceof FormGroupWithMetaData) {
          const refControl = controlOrGroup.get('objectReference') as FormControlWithMetaData | null;
          const attributeControl = controlOrGroup.get('attribute') as FormControlWithMetaData | null;
          refControl?.patchValue(result?.selectedObjects[0]?.itemReference ?? null, { emitEvent: true });

          const attributeValue = result?.attribute ? `attributeEnumSet.${result.attribute}` : null;
          attributeControl?.patchValue(attributeValue, { emitEvent: true });
        } else {
          if (editorConfig?.selectionMode === 'multi') {
            controlOrGroup.patchValue(result?.selectedObjects.map((res) => res.itemReference), { emitEvent: true });
          } else {
            controlOrGroup.patchValue(result?.selectedObjects[0]?.itemReference ?? null, { emitEvent: true });
          }
        }

        if (controlOrGroup.contextualEditor?.referencedObject) {
          controlOrGroup.contextualEditor.referencedObject.objectName = result?.selectedObjects[0]?.name ?? '';
          controlOrGroup.contextualEditor.referencedObject.objectUrl = result?.selectedObjects[0]?.id ?? '';
          controlOrGroup.contextualEditor.referencedObject.attributeUrl = result?.attribute ? `attributeEnumSet.${result.attribute}` : '';
        }
      }),
    ).subscribe();
  }


  //* Validates initial paste object name. This function may be added on to in the future
  private _checkInitData(snapshot: ObjectSnapshot): Array<PostObjectsBatch200ResponseResponsesInner> {

    const batchResponses = snapshot.batchAttributeResponse.responses.map(r => {
      if (r.id == 'name') {
        const nameResponseItem = (r.body as any)?.item as Record<string, any>;
        if (!nameResponseItem[r.id]) {
          nameResponseItem[r.id] = snapshot.label;
        }
      }
      return r;
    });
    return batchResponses;
  }

  private _getChildrenArray(itemIndex: number): FormArray<FormGroup> {
    return (this.itemsArray.at(itemIndex) as FormGroup).get('children') as FormArray<FormGroup>;
  }

  public getItemOperationStatus(index: number): ObjectOperation | undefined {
    return this.objectOperations[this._topLevelOpOffset(index)];
  }

  public getIssueIcon(severity: HeaderIssueSeverity): string {
    return severity === 'error' ? 'error' : severity === 'warning' ? 'warning_amber' : '';
  }

  /** Severity for the Paste Items tab: identifier + inline-unique field errors/warnings only. */
  public getPasteItemsTabSeverity(itemIndex: number): HeaderIssueSeverity {
    const itemGroup = this.itemsArray.at(itemIndex) as FormGroup | undefined;
    if (this._hasBlockingErrors(itemGroup)) return 'error';
    const snapshot = this.data.pasteItems?.[itemIndex];
    const configGroups = this.topLevelConfigPages()[itemIndex];
    const hasInlineUniqueErrors = this.getInlineUniqueControls(configGroups, snapshot).some(
      (c) => c.invalid && !c.disabled,
    );
    if (hasInlineUniqueErrors) return 'error';
    return this._hasItemWarnings(itemIndex) ? 'warning' : 'none';
  }

  /** Severity for the Configuration tab: config-only (non-inline) property errors. */
  public getConfigTabSeverity(itemIndex: number): HeaderIssueSeverity {
    return this._isConfigGroupsValid(this.topLevelConfigurationPages()[itemIndex] ?? []) ? 'none' : 'error';
  }

  /** Severity for child rows in the Paste Items tab: identifier + inline-unique field errors only. */
  public getPasteItemsChildSeverity(itemIndex: number, childIndex: number): HeaderIssueSeverity {
    const childGroup = this._getChildrenArray(itemIndex).at(childIndex) as FormGroup | undefined;
    if (this._hasBlockingErrors(childGroup)) return 'error';
    const childSnapshot = this.loadedChildren()[itemIndex]?.[childIndex];
    const childConfigGroups = this.childConfigPages()[itemIndex]?.[childIndex];
    const hasInlineUniqueErrors = this.getInlineUniqueControls(childConfigGroups, childSnapshot).some(
      (c) => c.invalid && !c.disabled,
    );
    return hasInlineUniqueErrors ? 'error' : 'none';
  }

  /** Severity for child rows in the Configuration tab: config-only property errors only. */
  public getConfigTabChildSeverity(itemIndex: number, childIndex: number): HeaderIssueSeverity {
    return this._isConfigGroupsValid(this.childConfigurationPages()[itemIndex]?.[childIndex] ?? []) ? 'none' : 'error';
  }

  public getSnapshotDepth(snapshot: ObjectSnapshot | undefined): number {
    if (!snapshot) {
      return 0;
    }

    return this.snapshotDisplayMeta().get(snapshot.sourceObjectId)?.depth ?? 0;
  }

  public getSnapshotIcon(snapshot: ObjectSnapshot | undefined): string {
    if (!snapshot) {
      return 'help';
    }

    return this.snapshotDisplayMeta().get(snapshot.sourceObjectId)?.icon ?? 'help';
  }

  public isSnapshotIconSvg(snapshot: ObjectSnapshot | undefined): boolean {
    if (!snapshot) {
      return false;
    }

    return this.snapshotDisplayMeta().get(snapshot.sourceObjectId)?.iconIsSvg ?? false;
  }

  // ── MAC helpers ────────────────────────────────────────────────────────────

  private _allMacRange(): number[] {
    return Array.from({ length: 124 }, (_, i) => i + 4);
  }

  public getMacAvailableOptions(itemIndex: number): number[] {
    const preloaded = this.data.pasteSiblingContext as PasteSiblingContext | undefined;
    const currentGroup = this._siblingGroupKey(itemIndex);
    const occupiedBySiblings = new Set(
      preloaded?.siblingUniqueValues.get('macAddress') ?? new Set<string>(),
    );
    const base = currentGroup === '__root__'
      ? this._allMacRange().filter((v) => !occupiedBySiblings.has(`${v}`))
      : this._allMacRange();

    const usedByOthers = new Set<number>();
    (this.data.pasteItems ?? []).forEach((_, i) => {
      if (i === itemIndex) return;
      if (this._siblingGroupKey(i) !== currentGroup) return;
      const ctrl = this.getConfigControl(this.topLevelConfigPages()[i], 'macAddress');
      const val = ctrl?.value;
      if (val !== null && val !== undefined && val !== '') {
        usedByOthers.add(Number(val));
      }
    });

    return base.filter((v) => !usedByOthers.has(v));
  }

  public toggleMacManualMode(itemIndex: number) {
    this.macManualModes.update((modes) => {
      const next = [...modes];
      next[itemIndex] = !next[itemIndex];
      return next;
    });
    this._checkTopLevelUniqueness();
  }

  // ── Warning helpers ─────────────────────────────────────────────────────────

  private _applyWarning(key: string, message: string | null) {
    if (message) {
      this._controlWarnings.set(key, message);
    } else {
      this._controlWarnings.delete(key);
    }
    this.controlWarnings.set(new Map(this._controlWarnings));
  }

  public hasItemControlWarning(itemIndex: number, propertyName: string): boolean {
    return this._controlWarnings.has(`item-${itemIndex}-${propertyName}`);
  }

  public getItemControlWarning(itemIndex: number, propertyName: string): string | null {
    return this._controlWarnings.get(`item-${itemIndex}-${propertyName}`) ?? null;
  }

  private _topLevelOpOffset(itemIndex: number): number {
    let offset = 0;
    for (let i = 0; i < itemIndex; i++) {
      offset += 1 + this._getChildrenArray(i).length;
    }
    return offset;
  }

  private _filterDisplayGroup(dg: DisplayGroup): DisplayGroup | null {
    const filteredProps = dg.properties.filter((p) => !CONFIG_TAB_EXCLUDED_PROPERTIES.has(p));
    if (filteredProps.length === 0) return null;
    return { ...dg, properties: filteredProps };
  }

  private _filterConfigGroupsForConfigTab(groups: ViewConfigGroup[]): ViewConfigGroup[] {
    return groups
      .map((group) => ({
        ...group,
        page: {
          ...group.page,
          keyView: group.page.keyView ? (this._filterDisplayGroup(group.page.keyView) ?? undefined) : undefined,
          views: group.page.views
            .map((view) => ({
              ...view,
              views: view.views
                .map((dg) => this._filterDisplayGroup(dg))
                .filter((dg): dg is DisplayGroup => dg !== null),
            }))
            .filter((view) => view.views.length > 0),
        },
      }))
      .filter((group) => group.page.keyView != null || group.page.views.some((v) => v.views.length > 0));
  }

  private _clearSiblingUniqueSeedValues(configGroups: ViewConfigGroup[]) {
    this._siblingUniqueSeedProperties.forEach((propertyName) => {
      const control = this.getConfigControl(configGroups, propertyName);
      if (control) {
        control.reset(null, { emitEvent: false });
      }
    });
  }

  //* Creates the primary control used in the `Paste Items` tab, one per pasted item (root or descendant)
  private _buildItemFormGroup(item: ObjectSnapshot, configGroups: ViewConfigGroup[]): FormGroup {
    const identCtrl = this._fb.nonNullable.control(item.label, [
      Validators.required,
      Validators.maxLength(32),
      Validators.pattern(IDENTIFIER_PATTERN),
    ]);
    identCtrl.valueChanges.subscribe(() => this._checkTopLevelUniqueness());

    getMainPageUniqueProperties(item).forEach((propertyName) => {
      const control = this.getConfigControl(configGroups, propertyName);
      control?.valueChanges.subscribe(() => this._checkTopLevelUniqueness());
    });

    return this._fb.group({
      localUniqueIdentifier: identCtrl,
      inputReference: this._fb.control<string | null>(item.itemReference ?? null),
      sourceParentId: this._fb.control<string | null>(item.sourceParentId ?? null),
      isChild: this._fb.nonNullable.control(!!item.sourceParentId),
      children: this._fb.array<FormGroup>([]),
    });
  }

  private _buildChildFormGroup(item: ObjectSnapshot, configGroups: ViewConfigGroup[]): FormGroup {
    const enabledCtrl = this._fb.nonNullable.control(true);
    const identCtrl = this._fb.control<string | null>(item.label, [
      Validators.required,
      Validators.maxLength(32),
      Validators.pattern(IDENTIFIER_PATTERN),
    ]);

    enabledCtrl.valueChanges.subscribe((enabled) => {
      enabled ? identCtrl.enable() : identCtrl.disable();
      this._checkChildrenUniqueness();
    });
    identCtrl.valueChanges.subscribe(() => this._checkChildrenUniqueness());

    getMainPageUniqueProperties(item).forEach((propertyName) => {
      const control = this.getConfigControl(configGroups, propertyName);
      control?.valueChanges.subscribe(() => this._checkChildrenUniqueness());
    });

    return this._fb.group({
      enabled: enabledCtrl,
      localUniqueIdentifier: identCtrl,
      inputReference: this._fb.control<string | null>(item.itemReference ?? null),
    });
  }

  private _isChildSnapshot(snapshot: ObjectSnapshot | undefined): boolean {
    if (!snapshot?.sourceParentId) {
      return false;
    }

    const copiedIds = new Set((this.data.pasteItems ?? []).map((s) => s.sourceObjectId));
    return copiedIds.has(snapshot.sourceParentId);
  }

  private _isChildItem(index: number): boolean {
    return this._isChildSnapshot(this.data.pasteItems?.[index]);
  }

  private _siblingGroupKey(index: number): string {
    const snapshot = this.data.pasteItems?.[index];
    if (!snapshot) {
      return '__root__';
    }

    if (this._isChildSnapshot(snapshot) && snapshot.sourceParentId) {
      return `parent:${snapshot.sourceParentId}`;
    }

    return '__root__';
  }

  private _autofillTopLevelIdentifiers() {
    this.itemsArray.controls.forEach((group) => {
      const ctrl = group.get('localUniqueIdentifier');
      const value = (ctrl?.value ?? '').toString().trim();
      if (!value) {
        return;
      }

      if (this._siblingLabels.includes(value.toLowerCase())) {
        ctrl?.setValue(this._buildUniqueIdentifier(value), { emitEvent: false });
      }
    });

    this._checkTopLevelUniqueness();
  }

  private _buildUniqueIdentifier(base: string): string {
    let candidate = `${base}-copy`;
    let suffix = 2;
    const existingValues = new Set(this._siblingLabels);
    this.itemsArray.controls.forEach((group) => {
      const value = group.get('localUniqueIdentifier')?.value;
      if (typeof value === 'string') {
        existingValues.add(value.trim().toLowerCase());
      }
    });

    while (existingValues.has(candidate.toLowerCase())) {
      candidate = `${base}-copy${suffix}`;
      suffix++;
    }

    return candidate;
  }

  private _loadSiblingUniqueValues(siblings: GetObjectsResponseItemsInner[]) {
    const relevantProperties = Array.from(new Set(
      (this.data.pasteItems ?? []).flatMap((item) => getMainPageUniqueProperties(item)),
    ));

    if (relevantProperties.length === 0 || siblings.length === 0) {
      this._checkTopLevelUniqueness();
      return;
    }

    const siblingRelevantProperties: PostObjectsBatchRequestRequestsInner[] = [];
    siblings.forEach(s => {
      siblingRelevantProperties.push(...this._objectManagerService.buildBatchRequestInner(s.id, relevantProperties))
    });

    const siblingAttributes$ = this._objectManagerService.fetchAttributesBatch(siblingRelevantProperties).pipe(
      map((batchResponse => {
        return batchResponse.responses.filter(response => response.status === 200)
      }),
      ));

    siblingAttributes$.subscribe({
      next: (batchResponse: PostObjectsBatch200ResponseResponsesInner[]) => {
        this._siblingUniqueValues.clear();
        siblings.forEach((s) => {

          relevantProperties.forEach((propertyName) => {
            const siblingUniqueProps = parseBatchAttributeResponse(batchResponse, s.id);
            const value = this._normalizeUniqueValue(siblingUniqueProps[propertyName]);
            if (!value) {
              return;
            }

            const existing = this._siblingUniqueValues.get(propertyName) ?? new Set<string>();
            existing.add(value);
            this._siblingUniqueValues.set(propertyName, existing);
          });
        });

        this._checkTopLevelUniqueness();
        this.pasteForm.markAllAsTouched();
      },
      error: () => {
        this._checkTopLevelUniqueness();
        this.pasteForm.markAllAsTouched();
      },
    });
  }

  private _normalizeUniqueValue(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed.toLowerCase() : null;
    }

    return `${value}`;
  }

  private _checkTopLevelUniqueness() {
    const groupLabelValues = new Map<string, string[]>();
    this.itemsArray.controls.forEach((group, index) => {
      const value = this._normalizeUniqueValue(group.get('localUniqueIdentifier')?.value);
      if (!value) {
        return;
      }
      const key = this._siblingGroupKey(index);
      const existing = groupLabelValues.get(key) ?? [];
      existing.push(value);
      groupLabelValues.set(key, existing);
    });

    this.itemsArray.controls.forEach((group, index) => {
      const ctrl = group.get('localUniqueIdentifier');
      const siblingGroup = this._siblingGroupKey(index);
      const value = this._normalizeUniqueValue(ctrl?.value);
      const duplicateAmongPaste = value && (groupLabelValues.get(siblingGroup) ?? []).filter((candidate) => candidate === value).length > 1;
      const duplicateInParent = value && siblingGroup === '__root__' && this._siblingLabels.includes(value);
      if (ctrl) {
        this._applyError(ctrl, 'notUnique', !!(duplicateAmongPaste || duplicateInParent));
      }

      const snapshot = this.data.pasteItems?.[index];
      const configGroups = this.topLevelConfigPages()[index];
      if (!snapshot || !configGroups) {
        return;
      }

      getMainPageUniqueProperties(snapshot).forEach((propertyName) => {
        const propertyControl = this.getConfigControl(configGroups, propertyName);
        const normalized = this._normalizeUniqueValue(propertyControl?.value);
        const duplicatesAmongPaste = normalized && (this.data.pasteItems ?? []).filter((_, compareIndex) => {
          if (this._siblingGroupKey(compareIndex) !== siblingGroup) {
            return false;
          }
          const compareGroups = this.topLevelConfigPages()[compareIndex];
          const compareControl = compareGroups ? this.getConfigControl(compareGroups, propertyName) : null;
          return this._normalizeUniqueValue(compareControl?.value) === normalized;
        }).length > 1;
        const duplicatesInParent = normalized && siblingGroup === '__root__' && (this._siblingUniqueValues.get(propertyName)?.has(normalized) ?? false);
        const isDuplicate = !!(duplicatesAmongPaste || duplicatesInParent);

        if (propertyName === 'instanceNumber') {
          if (propertyControl) this._applyError(propertyControl, 'notUnique', false);
          this._applyWarning(
            `item-${index}-instanceNumber`,
            isDuplicate ? 'Instance number matches an existing sibling object.' : null,
          );
        } else {
          if (propertyControl) this._applyError(propertyControl, 'notUnique', isDuplicate);
          this._applyWarning(`item-${index}-${propertyName}`, null);
        }
      });
    });
  }

  private _checkChildrenUniqueness() {
    this.itemsArray.controls.forEach((_, itemIndex) => {
      const childArray = this._getChildrenArray(itemIndex);
      const childSnapshots = this.loadedChildren()[itemIndex] ?? [];
      const childPageGroups = this.childConfigPages()[itemIndex] ?? [];
      const enabledIndexes = childArray.controls
        .map((group, index) => ({ group, index }))
        .filter(({ group }) => group.get('enabled')?.value !== false);

      const identifierValues = enabledIndexes.map(({ group }) => this._normalizeUniqueValue(group.get('localUniqueIdentifier')?.value));
      enabledIndexes.forEach(({ group }) => {
        const ctrl = group.get('localUniqueIdentifier');
        const value = this._normalizeUniqueValue(ctrl?.value);
        if (ctrl) {
          this._applyError(ctrl, 'notUnique', !!(value && identifierValues.filter((candidate) => candidate === value).length > 1));
        }
      });

      const relevantProperties = Array.from(new Set(childSnapshots.flatMap((snapshot) => getMainPageUniqueProperties(snapshot))));
      relevantProperties.forEach((propertyName) => {
        const values = enabledIndexes.map(({ index }) => this._normalizeUniqueValue(this.getConfigControl(childPageGroups[index], propertyName)?.value));
        enabledIndexes.forEach(({ index }) => {
          const control = this.getConfigControl(childPageGroups[index], propertyName);
          const value = this._normalizeUniqueValue(control?.value);
          if (control) {
            this._applyError(control, 'notUnique', !!(value && values.filter((candidate) => candidate === value).length > 1));
          }
        });
      });
    });
  }

  private _applyError(ctrl: AbstractControl, key: string, set: boolean) {
    const existing = { ...(ctrl.errors ?? {}) };
    if (set) {
      ctrl.setErrors({ ...existing, [key]: true });
      return;
    }

    delete existing[key];
    ctrl.setErrors(Object.keys(existing).length ? existing : null);
  }

  private _hasBlockingErrors(group: AbstractControl | null | undefined): boolean {
    if (!group || group.disabled) {
      return false;
    }

    if (group instanceof FormArray) {
      return group.controls.some((control) => this._hasBlockingErrors(control));
    }

    if (group instanceof FormGroup) {
      return Object.values(group.controls).some((control) => this._hasBlockingErrors(control));
    }

    return group.invalid;
  }

  private _hasItemWarnings(itemIndex: number): boolean {
    const prefix = `item-${itemIndex}-`;
    return Array.from(this._controlWarnings.keys()).some((key) => key.startsWith(prefix));
  }

  private _resolveSnapshotDepth(
    snapshot: ObjectSnapshot,
    snapshotsById: Map<string, ObjectSnapshot>,
    memo: Map<string, number>,
    visiting: Set<string>,
  ): number {
    if (memo.has(snapshot.sourceObjectId)) {
      return memo.get(snapshot.sourceObjectId)!;
    }

    if (visiting.has(snapshot.sourceObjectId)) {
      return 0;
    }

    visiting.add(snapshot.sourceObjectId);
    const parentId = snapshot.sourceParentId;
    if (!parentId || !snapshotsById.has(parentId)) {
      memo.set(snapshot.sourceObjectId, 0);
      visiting.delete(snapshot.sourceObjectId);
      return 0;
    }

    const parentSnapshot = snapshotsById.get(parentId)!;
    const depth = this._resolveSnapshotDepth(parentSnapshot, snapshotsById, memo, visiting) + 1;
    memo.set(snapshot.sourceObjectId, depth);
    visiting.delete(snapshot.sourceObjectId);
    return depth;
  }

  private _buildSnapshotDisplayMeta(): Map<string, SnapshotDisplayMeta> {
    const snapshots = this.data.pasteItems ?? [];
    const snapshotsById = new Map<string, ObjectSnapshot>(snapshots.map((snapshot) => [snapshot.sourceObjectId, snapshot]));
    const depths = new Map<string, number>();
    const meta = new Map<string, SnapshotDisplayMeta>();

    snapshots.forEach((snapshot) => {
      const depth = this._resolveSnapshotDepth(snapshot, snapshotsById, depths, new Set<string>());
      const iconObj = {
        classification: snapshot.classification,
        objectType: snapshot.objectType,
      } as GetObjectsResponseItemsInner;
      const icon = this._iconService.getIconForClass(iconObj);
      meta.set(snapshot.sourceObjectId, {
        icon,
        iconIsSvg: this._iconService.isSvgIcon(icon),
        depth,
      });
    });

    return meta;
  }

  public getConfigControl(configGroups: ViewConfigGroup[] | undefined, propertyName: string): FormControlWithMetaData | null {
    if (!configGroups) {
      return null;
    }

    for (const { page } of configGroups) {
      const allGroups = [...(page.keyView ? [page.keyView] : []), ...page.views.flatMap(v => v.views)];
      for (const group of allGroups) {
        if (group.properties.includes(propertyName)) {
          return group.group.get(propertyName) as FormControlWithMetaData | null;
        }
      }
    }

    return null;
  }

  public getInlineUniqueControls(configGroups: ViewConfigGroup[] | undefined, snapshot: ObjectSnapshot | undefined): FormControlWithMetaData[] {
    if (!configGroups || !snapshot) {
      return [];
    }

    return getMainPageUniqueProperties(snapshot)
      .map((propertyName) => this.getConfigControl(configGroups, propertyName))
      .filter((control): control is FormControlWithMetaData => !!control && MAIN_PAGE_UNIQUE_PROPERTY_SET.has(control.name as MainPageUniqueProperty));
  }

  public getInlineInputType(control: FormControlWithMetaData): string {
    if (isFloatType(control.type) || control.type === 'ulong' || control.type === 'integer') {
      return 'number';
    }

    return 'text';
  }

  public getControlErrors(control: AbstractControl | null): ValidationErrors | null {
    return control?.errors ?? null;
  }

  public shouldHighlightControl(control: AbstractControl | null | undefined): boolean {
    if (!control || control.disabled) {
      return false;
    }

    return control.invalid;
  }

  public isDialogValid(): boolean {
    if (this.pasteForm.invalid) {
      return false;
    }

    // Validate only controls rendered on the Paste Items tab:
    // - localUniqueIdentifier and child identifiers (via pasteForm)
    // - inline unique controls (instanceNumber/macAddress/trunkNumber)
    const topLevelInlineValid = (this.data.pasteItems ?? []).every((snapshot, index) => {
      const configGroups = this.topLevelConfigPages()[index];
      return this.getInlineUniqueControls(configGroups, snapshot).every((control) => control.disabled || control.valid);
    });

    if (!topLevelInlineValid) {
      return false;
    }

    return this.itemsArray.controls.every((_, itemIndex) => {
      const childArray = this._getChildrenArray(itemIndex);
      const childSnapshots = this.loadedChildren()[itemIndex] ?? [];
      const childPageGroups = this.childConfigPages()[itemIndex] ?? [];

      return childArray.controls.every((childGroup, childIndex) => {
        if (childGroup.get('enabled')?.value === false) {
          return true;
        }

        const childSnapshot = childSnapshots[childIndex];
        const childConfigGroups = childPageGroups[childIndex];
        return this.getInlineUniqueControls(childConfigGroups, childSnapshot).every((control) => control.disabled || control.valid);
      });
    });
  }

  /** Full-dialog submit validity (Paste Items + Configuration controls). */
  public isSubmitValid(): boolean {
    if (this.pasteForm.invalid) {
      return false;
    }

    return [...this.topLevelConfigPages(), ...this.childConfigPages().flat()]
      .filter((configGroup) => configGroup.length > 0)
      .every((configGroups) => this._isConfigGroupsValid(configGroups));
  }

  private _isConfigGroupsValid(configGroups: ViewConfigGroup[]): boolean {
    return configGroups.every(({ page }) => {
      const groups = [...(page.keyView ? [page.keyView] : []), ...page.views.flatMap(v => v.views)];
      return groups.every((group) => {
        if (!group.group.valid) {//? The form validation also consideres the validity of readonly controls. If the formGroup is invalid, we need to chedk to see if the formControl(s) that are causing the invalidity are readonly or not. If they are readonly, we can ignore their invalidity for the purpose of determining the validity of the dialog, since the user cannot change them anyway. If they are not readonly, then the dialog is indeed invalid and we should return false. 
          const controls = Object.values(
            group.group.controls) as FormControlWithMetaData[]
          return controls.every((c) => c.readonly ? true : c.valid);
        }
        return group.group.valid
      });
    });
  }

  private _extractEditableValues(configGroups: ViewConfigGroup[]): Record<string, any> {
    return configGroups.reduce<Record<string, any>>((acc, { page }) => {
      const groups = [...(page.keyView ? [page.keyView] : []), ...page.views.flatMap(v => v.views)];
      groups.forEach((group) => {
        group.properties.forEach((propertyName) => {
          const control = group.group.get(propertyName) as FormControlWithMetaData | null;
          if (!control || control.disabled) {
            return;
          }
          acc[propertyName] = control.value;
        });
      });
      return acc;
    }, {});
  }

  public override doSomethingFn() {
    const pasteItems = this.data.pasteItems ?? [];
    const parentId = this.data.pasteParentId ?? '';

    this.objectOperations.length = 0;
    this.itemsArray.controls.forEach((itemGroup, itemIndex) => {
      const snapshot = pasteItems[itemIndex];
      if (!snapshot) {
        return;
      }

      this.objectOperations.push({
        objectId: snapshot.sourceObjectId,
        name: snapshot.name || snapshot.label,
        reference: snapshot.itemReference,
        status: 'Idle',
      });

      const childSnapshots = this.loadedChildren()[itemIndex] ?? [];
      this._getChildrenArray(itemIndex).controls.forEach((childGroup, childIndex) => {
        if (childGroup.get('enabled')?.value === false || !childSnapshots[childIndex]) {
          return;
        }

        const childSnapshot = childSnapshots[childIndex];
        this.objectOperations.push({
          objectId: `child-${itemIndex}-${childIndex}`,
          name: childSnapshot.name || childSnapshot.label,
          reference: childSnapshot.itemReference,
          status: 'Idle',
        });
      });
    });

    this.recomputeProgress();
    this.disableButtons.set(true);
    this.pasteStarted.set(true);
    this.pasteForm.disable();
    [...this.topLevelConfigPages(), ...this.childConfigPages().flat()].forEach((configGroups) => {
      configGroups.forEach(({ page }) => {
        if (page.keyView) {
          page.keyView.group.disable({ emitEvent: false });
        }
        page.views.forEach((view) => view.views.forEach((group) => group.group.disable({ emitEvent: false })));
      });
    });

    from(this.itemsArray.controls).pipe(
      concatMap((itemGroup, itemIndex) => {
        const snapshot = pasteItems[itemIndex];
        if (!snapshot) {
          return of(null);
        }

        const opIdx = this.objectOperations.findIndex((operation) => operation.objectId === snapshot.sourceObjectId);
        if (opIdx !== -1) {
          this.objectOperations[opIdx].status = 'Processing';
        }

        const topLevelOverrides = this._extractEditableValues(this.topLevelConfigPages()[itemIndex] ?? []);
        const localUniqueIdentifier = itemGroup.get('localUniqueIdentifier')?.value as string;

        return this._objectOpsService.pasteSingleObject(snapshot, parentId, localUniqueIdentifier, topLevelOverrides).pipe(
          tap((newId) => {
            if (opIdx !== -1) {
              this.objectOperations[opIdx].status = newId ? 'Success' : 'Error';
            }
            this.recomputeProgress();
          }),
          switchMap((newId) => {
            const childSnapshots = this.loadedChildren()[itemIndex] ?? [];
            const childPageGroups = this.childConfigPages()[itemIndex] ?? [];
            const enabledChildren = this._getChildrenArray(itemIndex).controls
              .map((group, childIndex) => ({ group, childIndex, snapshot: childSnapshots[childIndex], configGroups: childPageGroups[childIndex] ?? [] }))
              .filter(({ group, snapshot }) => group.get('enabled')?.value !== false && !!snapshot);

            if (!newId || enabledChildren.length === 0) {
              return of(newId);
            }

            return from(enabledChildren).pipe(
              concatMap(({ group, childIndex, snapshot, configGroups }) => {
                const childOpId = `child-${itemIndex}-${childIndex}`;
                const childOpIndex = this.objectOperations.findIndex((operation) => operation.objectId === childOpId);
                if (childOpIndex !== -1) {
                  this.objectOperations[childOpIndex].status = 'Processing';
                }

                const childIdentifier = group.get('localUniqueIdentifier')?.value as string;
                const childOverrides = this._extractEditableValues(configGroups);
                return this._objectOpsService.pasteChildObject(snapshot!, newId, childIdentifier, childOverrides).pipe(
                  tap((childNewId) => {
                    if (childOpIndex !== -1) {
                      this.objectOperations[childOpIndex].status = childNewId ? 'Success' : 'Error';
                    }
                    this.recomputeProgress();
                  }),
                  map(() => null),
                );
              }),
              toArray(),
              map(() => newId),
            );
          }),
        );
      }),
      finalize(() => {
        this.disableButtons.set(false);
        if (this.objectOperations.every((operation) => operation.status === 'Success' || operation.status === 'Error')) {
          this.allProcessed.set(true);
        }
      }),
    ).subscribe();
  }
}
