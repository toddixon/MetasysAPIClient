import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal, WritableSignal, effect } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDividerModule } from '@angular/material/divider';
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogRef, MatDialogTitle } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { NavigationTreeService } from '../../navigation-tree.service';
import { ObjectsNavigationTreeComponent } from '../../network-objects/objects-navigation-tree.component';
import { GetObjectAttributes200Response, GetObjectAttributes200ResponseSchema, GetObjectAttributes200ResponseSchemaPropertiesValue } from '../../api';
import { isItemSelectedData, ItemSelectedData } from '../../models/event.models';
import { ObjectManagerService } from '../../objectManager.service';
import { filter, Observable, EMPTY, switchMap, map, tap, distinctUntilChanged } from 'rxjs';
import { AbstractControl, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { attributeEnumSet } from '../../models/object-attribute.models';
import { ItemData } from '../../models/display.models';
import { ReferencedObject } from '../../models/formControlWithMetadata.model';
import { lastSegment } from '../../constants/api.constants';



export interface ObjectReferencePickerDialogData {
  title: string;
  type: 'objectReference' | 'attributeReference';
  objectTypes: string[];
  selectionMode: 'single' | 'multi';
  allowClear?: boolean;
  initialSelection?: string[];
  itemData: ItemData;
  referencedObject?: ReferencedObject;
}

export interface AttributeOptions {
  key: string,
  title: string,
}
export interface ObjectReferencePickerDialogResult {
  selectedObjects: ItemSelectedData[];
  attribute?: string;
}

@Component({
  selector: 'app-object-reference-picker-dialog',
  imports: [
    CommonModule,
    MatFormFieldModule,
    MatButtonModule,
    MatSelectModule,
    MatDialogActions,
    MatDividerModule,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatProgressBarModule,
    ReactiveFormsModule,
    ObjectsNavigationTreeComponent,
  ],
  templateUrl: './object-reference-picker-dialog.component.html',
  styleUrl: './object-reference-picker-dialog.component.scss',
})
export class ObjectReferencePickerDialogComponent implements OnInit, OnDestroy {
  public readonly dialogRef = inject(MatDialogRef<ObjectReferencePickerDialogComponent>);
  public readonly data: ObjectReferencePickerDialogData = inject(MAT_DIALOG_DATA);
  private readonly _navigationTreeService = inject(NavigationTreeService);
  private readonly _objectManagerService = inject(ObjectManagerService)

  private readonly _selectedNodesSignal = toSignal(
    this._navigationTreeService.pickerSelectedNodes$,
    { initialValue: [] as ItemSelectedData[] },
  );

  private selectedNodes$: Observable<ItemSelectedData[]> = toObservable(this._selectedNodesSignal);

  public objectAttributes$: Observable<AttributeOptions[]> | undefined;
  public attributeFormControl: FormControl<string> | undefined;
  public fetchingAttributes: WritableSignal<boolean> = signal(false);

  public readonly selectedNodes = computed<ItemSelectedData[]>(() => {
    const selected = this._selectedNodesSignal();

    if (!this.data.objectTypes.length) {
      return selected;
    }

    return selected.filter((node) => { return this.data.initialSelection?.includes(node.itemReference) || this.isAllowedObjectType(node.objectType) });
  });

  public readonly selectionCount = computed<number>(() => this.selectedNodes().length);

  constructor() {
    effect(() => {
      const loading = this.fetchingAttributes();
      const selectedNodes = this.selectedNodes();
      if (loading || selectedNodes.length == 0) {
        this.attributeFormControl?.disable({ emitEvent: false });
      } else {
        this.attributeFormControl?.enable({ emitEvent: false });
      }
    })
  }


  ngOnInit(): void {
    const initialSelection = this.data.initialSelection ?? [];
    if (initialSelection.length > 0) {
      let selectedId; let selectedName;
      if (this.data.referencedObject) {
        let matchId = this.data.referencedObject.objectUrl.match(lastSegment)
        selectedId = matchId![0];
        selectedName = this.data.referencedObject.objectName;
        const selectedObjData = { id: selectedId, name: selectedName, itemReference: initialSelection[0] };
        this._navigationTreeService.setPickerSelectedNodes([selectedObjData as ItemSelectedData]);
      }


    } else {
      this._navigationTreeService.setPickerSelectedNodes([]);
    }

    if (this.data.type === 'attributeReference') {
      this.attributeFormControl = new FormControl();

      this.objectAttributes$ = this.selectedNodes$.pipe(
        distinctUntilChanged((prev, curr) => {
          if (prev.length) {
            return prev[0].id === curr[0]?.id;
          } return false;
        }),
        filter(nodes => nodes.length === 1),
        map(node => node[0]),
        switchMap(node =>
          this._objectManagerService.listObjectAttributes(node.id).pipe(
            tap({
              subscribe: () => this.fetchingAttributes.set(true),
              finalize: () => this.fetchingAttributes.set(false)
            }),

            map((res) => {
              const properties = res.schema.properties;
              if (!properties) {
                return [];
              }
              let defaultAtt: string | undefined = undefined;
              if (res.item && 'defaultAttribute' in res.item && typeof res.item.defaultAttribute === 'string') {
                defaultAtt = res.item.defaultAttribute.split('.')[1] || res.item.defaultAttribute;
              }
              if (defaultAtt && properties[defaultAtt]) {
                this.attributeFormControl!.setValue(defaultAtt);//* already in the form of attributeEnumSet.attributeId
              } else {
                this.attributeFormControl!.setValue(Object.keys(properties)[0]);
              }
              let attributeOptions: AttributeOptions[] = Object.keys(properties).map(key => ({
                key,
                title: properties[key].title || key
              }));
              return attributeOptions;
            })
          )
        ),
      )
    }
  }

  ngOnDestroy(): void {
    this._navigationTreeService.setPickerSelectedNodes([]);
  }

  public clearSelection(): void {
    this.dialogRef.close({ selectedObjects: [] } as ObjectReferencePickerDialogResult);
  }

  public isAllowedObjectType(objectType: string): boolean {
    if (!this.data.objectTypes.length) {
      return true;
    }

    return this.data.objectTypes.some((allowedType) => objectType === allowedType || objectType.endsWith(`.${allowedType}`));
  }

  public canConfirmSelection(): boolean {
    const count = this.selectionCount();
    if (this.data.selectionMode === 'single') {
      return count === 1;
    }
    return count > 0;
  }

  public confirmSelection(): void {
    this.dialogRef.close({ selectedObjects: this.selectedNodes(), attribute: this.attributeFormControl?.value } as ObjectReferencePickerDialogResult);
  }
}
