import { inject, Injectable } from '@angular/core';
import { AbstractControl, AsyncValidatorFn, FormArray, FormBuilder, FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { AllOf, DisplayPrecision, FloatSchemaProperty, FloatSourceProperties, GenericSchemaProperty, GetSourceInitValueProperty, isFloatSchemaProperty, isFloatSourceProperty, isSchemaPrecision, isSchemaUnits, Schema, SchemaProperties, SourceInitValueProperties, SourceKeys } from './models/object-schema.models';
import { ObjectItem } from './models/api-object.models';
import { DisplayGroup, DisplayView, FieldDataType, DisplayViewPage, FloatType, isFloatType, DisplaySourceUpdate, ObjectSourcesInitValueRecord, SourcesObject, SourceData, isValidSourceKey, SOURCE_TO_DISPLAY_KEY, ViewConfigGroup } from './models/object-views.models';
import { LoggerService } from './logger.service';
import { ObjectManagerService } from './objectManager.service';
import { BehaviorSubject, catchError, concatMap, delay, EMPTY, filter, from, identity, isObservable, map, mergeMap, Observable, of, retry, scan, shareReplay, Subject, switchMap, tap, throwIfEmpty } from 'rxjs';
import { RequestQueueService } from './requestQueue.service';
import { EnumMember, EnumSet } from './models/enum-set.models';
import { findObjectKey } from './helpers/objectSearch';
import { DataTypeMetaSchema, GetObject200Response, GetObjectTypeSchema200Response, ObjectsStreamValuesNotificationInner, ObjectsStreamValuesUpdateInner, ObjectsStreamValuesUpdateInnerItem, PostObjectsBatch200ResponseResponsesInner, ViewsInner, ViewsInnerViewsInner, ViewsInnerViewsInnerViewsInner } from './api';
import { formatStructData } from './helpers/formatStructData';
import { environment } from '../environments/environment.development';
import { FormControlWithMetaData, ObjectReferenceEditorConfig, ReferencedObject, ValidatorMeta } from './models/formControlWithMetadata.model';
import { FormArrayWithMetaData } from './models/formArrayWithMetadata.model';
import { FormGroupWithMetaData } from './models/formGroupWithMetadata.model';
import { AnnotationProperty, CommandFormControls, CommandProperties } from './models/objectCommand.models';
import { getPrecision, resolveDisplayPrecision, UnsavedChangesObj } from './models/display.models';
import { DisplayComponent } from './display/display.component';
import { ObjectSnapshot } from './models/copied-object.models';

export const propertyCategories = {
  alarmValues: 'attributeCategoryEnumSet.alarmValuesCategory',
  versionStruct: 'attributeCategoryEnumSet.versionStructCategory',

}

@Injectable({
  providedIn: 'root'
})
export class FormService {
  private _fb = inject(FormBuilder);
  private _loggerService = inject(LoggerService);
  private _objectManagerService = inject(ObjectManagerService);
  private KEYGROUP = environment.keyGroup;
  private DEFAULT_PRIORITY = environment.defaultPriorityMember;
  public saveAllSubject$: Subject<void> = new Subject();

  public unsavedChangesUpdateSubject$: Subject<UnsavedChangesObj | string> = new Subject();
  public unsavedChangesUpdate$: Observable<Array<UnsavedChangesObj>>
  public unsavedChangesSubject$ = new BehaviorSubject<Array<UnsavedChangesObj>>([]);

  public propertyMetaDataKeys = ['referencedObject'];

  constructor() {
    this.unsavedChangesUpdate$ = this.unsavedChangesUpdateSubject$.asObservable().pipe(
      scan((unsavedAcc, objUpdate) => {
        if (typeof objUpdate == 'object') {
          const objIdx = unsavedAcc.findIndex(a => a.objectId == objUpdate.objectId);
          if (objIdx == -1) {
            if (objUpdate.changes) {
              unsavedAcc.push(objUpdate);
            }
          } else {
            if (objUpdate.changes) {
              unsavedAcc[objIdx] = objUpdate;
            } else {
              unsavedAcc.splice(objIdx, 1);
            }
          }
        } else {
          //* For when the user bypasses save dialog and switches off of the modified object in the `dynamic-form.component`, remove the unsaved changes from accumulator
          const objIdx = unsavedAcc.findIndex(a => a.objectId == objUpdate);
          if (objIdx != -1) unsavedAcc.splice(objIdx, 1);
        }
        return unsavedAcc;
      }, [] as Array<UnsavedChangesObj>),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.unsavedChangesUpdate$.subscribe(this.unsavedChangesSubject$);
  }



  //* Build the default views for the object (e.g. Focus, Advanced, Configuration) 
  buildFormFromSchema({ schema, views }: GetObjectTypeSchema200Response): DisplayViewPage
  public buildFormFromSchema({ item, schema, views }: GetObject200Response): DisplayViewPage {
    let viewPage: DisplayViewPage;
    const displayViews: Array<DisplayView> = [];
    let keyGroup;
    let displaySourceSubject$: BehaviorSubject<Partial<DisplaySourceUpdate>> | undefined;

    const sourceData: SourceData | undefined = this.findDisplaySources(schema!) ?? undefined;
    if (sourceData) {
      displaySourceSubject$ = new BehaviorSubject(sourceData.allSources);//! Make sure that only the relevant controls are getting this Observable
    }

    if (views?.length > 0) {
      for (const view of views) {
        for (const subView of view.views ?? []) {
          const v = subView as ViewsInnerViewsInner;
          const display = this._buildDisplayView(schema!, v, item, sourceData?.objectSourcesMap, displaySourceSubject$);
          displayViews.push(display);
        }
      }
      let keyView;
      const keyIdx = displayViews.findIndex(v => v.id === this.KEYGROUP);
      if (keyIdx !== -1) {
        keyView = displayViews[keyIdx] as DisplayView;
        displayViews.splice(keyIdx, 1);
        keyGroup = keyView.views[0];
        keyGroup.keyAttribute = item?.['defaultAttribute']?.split('.')[1];
        keyGroup.properties = keyGroup.properties.filter(prop => prop !== keyGroup!.keyAttribute);
        keyGroup.fields.forEach((f) => {
          if (f instanceof FormControlWithMetaData && !f.readonly) {
            f.readonly = true;
          }
        })
        console.log('Key Group:', keyGroup.properties);
      }

    }

    viewPage = {
      objectId: item?.['id'] ?? '',
      name: item?.['name'] ?? '',
      keyView: keyGroup,
      dynamicProperties: this.getDynamicProperties(schema),
      views: displayViews,
      displaySources$: displaySourceSubject$,
    }

    return viewPage;
  }

  //* Build one DisplayViewPage per top-level view (ViewsInner), filtering views/groups with no content.
  //* This prevents duplicate sub-view `id` collisions in template `track` expressions.
  public buildFormConfigGroups(snapshot: ObjectSnapshot): ViewConfigGroup[] {
    // snapshot.schemaResponse.views?.push(this.createKeyView(keyProperties));

    const itemValues = snapshot.batchAttributeResponse.responses.reduce<Record<string, any>>((acc, response) => {
      if (!response?.id || response.status !== 200 || !response.body) {
        return acc;
      }


      const responseItem = (response.body as any)?.item as Record<string, any> | undefined;
      const value = responseItem?.[response.id];

      if (value === undefined) {
        return acc;
      }

      acc[response.id] = value;
      return acc;
    }, {});

    itemValues['id'] = snapshot.sourceObjectId;

    const result: ViewConfigGroup[] = [];
    for (const view of (snapshot.schemaResponse.views ?? [])) {
      const nonEmptySubViews = (view.views ?? []).filter(sv =>
        (sv.views ?? []).some(g => (g.properties ?? []).length > 0)
      );
      if (nonEmptySubViews.length === 0) continue;

      const page = this.buildFormFromSchema({
        item: itemValues,
        schema: snapshot.schemaResponse.schema,
        views: [{ ...view, views: nonEmptySubViews }],
      } as GetObject200Response);
      if (!page.views.some(v => v.views.some(g => g.properties.length > 0))) continue;

      result.push({ id: view.id, title: view.title, page });
    }
    return result;
  }

  private createKeyView(keyProperties: string[]): ViewsInner {
    const keyView = {
      title: "Key",
      views: [
        {
          title: "Key",
          views: [
            {
              title: "None",
              properties: keyProperties,
              id: "viewGroupEnumSet.noGrp",
            },
          ],
          id: "groupTypeEnumSet.keyGrpType",
        }
      ],
      id: "groupTypeEnumSet.keyGrpType",
    }
    // const keyView = {
    //   title: "Key",
    //   views: [
    //     {
    //       title: "None",
    //       properties: keyProperties,
    //       id: "viewGroupEnumSet.noGrp",
    //     },
    //   ],
    //   id: "groupTypeEnumSet.keyGrpType",
    // }

    return keyView as ViewsInner;
  }

  private findDisplaySources(schema: any): SourceData | void {
    const properties = schema.properties
    const floatProperties = Object.fromEntries(Object.entries(properties).filter(([key, v]: [string, any]) => {
      return isFloatSchemaProperty(v);
    })) as Record<string, FloatSchemaProperty>;

    const allObjSources: SourcesObject = {};
    const obj: ObjectSourcesInitValueRecord = {};

    if (Object.entries(floatProperties).length > 0) {

      Object.entries(floatProperties).map(([key, v]) => {
        const objPropertySources: Record<string, string | number> = {};

        Object.entries(v).forEach(([pKey1, pV1]) => {
          if (isFloatSourceProperty(pKey1) && typeof pV1 === 'string') {
            const initValKey = GetSourceInitValueProperty(pKey1);
            if (initValKey) {
              const initValueProperty = v[initValKey];
              let initVal: number | string | undefined;
              if (initValueProperty) {
                if (typeof initValueProperty == 'number') {
                  initVal = initValueProperty;
                } else if (typeof initValueProperty == 'object') {
                  if (isSchemaPrecision(initValueProperty)) {
                    initVal = initValueProperty.displayMultipleOf;
                  } else if (isSchemaUnits(initValueProperty)) {
                    initVal = initValueProperty.title;
                  }//* If more sources for property values are found in the future, add more checks here & update 'object-schema.models.ts' accordingly

                }
                if (initVal) {
                  allObjSources[pV1] = initVal;
                  objPropertySources[pV1] = initVal;
                }
              }
            }

          }
        })

        obj[key] = objPropertySources;
      })
      const sourceData: SourceData = {
        allSources: allObjSources,
        objectSourcesMap: obj,
      }
      return sourceData;

    } else {
      return
    }
  }

  public buildCommandSchemaForm(meta: { title: string, id: string }, commandBodySchema: any): CommandFormControls {
    let propertyControlGroup;
    let commonControlGroup;
    let paramControlGroup: FormGroupWithMetaData | undefined;
    const nonProperties = ['additionalProperties', 'required', 'parameters'];
    const commonCommandProperties = ['annotation', 'priority'];

    const properties: CommandProperties = commandBodySchema?.properties || {};

    if (properties.additionalProperties) {
      console.log('ADDITIONAL PROPERTIES FOUND TRUE:', Object.keys(properties));
    };

    const controls: Record<string, FormControlWithMetaData | FormGroupWithMetaData> = {};
    const commonControls: Record<string, FormControlWithMetaData> = {};


    const filteredProperties = Object.fromEntries(
      Object.entries(properties).filter(([key]) => !nonProperties.includes(key))
    );

    if (filteredProperties) {
      Object.entries(filteredProperties).forEach(([key, value]) => {
        let type: FieldDataType = '';
        if (value.metasysType) {
          type = this.getPropertyType(value);
        } else if (value.oneOf && value.oneOf.find((v: any) => v.$ref)) {
          type = this.getEnumSetObservable(value.oneOf.find((v: any) => v.$ref).$ref);//! `getPropertyType` already calls this function and returns the same type. Do we need this `else if` statement?  //* `this function was called when opening the command dialog for (AV1 - adjust command)
        }

        if (!value.title) {
          value.title = key.charAt(0).toUpperCase() + key.slice(1);
        }
        const control = this.createControl(key, value, value, type);
        if (commonCommandProperties.includes(key)) {
          if (key == 'priority') {
            control.setValue(environment.defaultPriorityMember.const);
          }
          commonControls[key] = control;
        } else {
          controls[key] = control;
        }
      })
    };
    if (Object.keys(controls).length) {
      propertyControlGroup = new FormGroupWithMetaData(controls, meta);
    };
    if (Object.keys(commonControls).length) {
      commonControlGroup = new FormGroupWithMetaData(commonControls, { id: 'common', title: 'Common' });
    };

    const propertyParams = properties.parameters?.items || [];
    if (propertyParams.length > 0) {
      const paramControls: Record<string, FormControlWithMetaData> = {};
      for (const param of propertyParams) {
        const type = this.getPropertyType(param);
        const control = this.createControl(param.title ?? param.id, param, param, type);

        control.addValidators([Validators.required]);
        paramControls[control.title] = control;
      }

      paramControlGroup = new FormGroupWithMetaData(paramControls, meta);
    };


    return { properties: propertyControlGroup ?? undefined, parameters: paramControlGroup, commonControls: commonControlGroup };

  }

  //* Along with properties that have .dynamic==true, there are some other *specialty* properties that we'll want to update
  //* CurrentCommandPriority
  public getDynamicProperties(schema: any): Array<string> {
    const filterList = ['bacnetObjectType', 'defaultAttribute', 'id', 'itemReference', 'version'];

    const dynamicProperties: Array<string> = [];
    const propertyKeys = Object.keys(schema.properties);
    Object.values(schema.properties).forEach((p: any, idx) => {
      if (!filterList.includes(p)) {
        dynamicProperties.push(propertyKeys[idx]);

      }
    });
    return dynamicProperties;
  }

  private _buildDisplayView(schema: object, view: ViewsInnerViewsInner, item?: { [key: string]: any; }, displaySources?: ObjectSourcesInitValueRecord, sourceUpdates$?: BehaviorSubject<Partial<DisplaySourceUpdate>>): DisplayView {
    const displayView: DisplayView = {
      id: view.id,
      title: view.title,
      views: []
    };

    for (const group of view.views) {
      displayView.views.push(this._buildDisplayGroup(schema, group, item, displaySources, sourceUpdates$));
    }

    return displayView;
  }

  public _buildDisplayGroup(schema: object, object: ViewsInnerViewsInnerViewsInner, item?: { [key: string]: any; }, displaySources?: ObjectSourcesInitValueRecord, sourceUpdates$?: BehaviorSubject<Partial<DisplaySourceUpdate>>): DisplayGroup {
    const fields: Array<FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData> = [];
    const controls: Record<string, FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData> = {};
    const schemaAny = schema as any;

    if (object.properties.includes('defaultAttribute') && item) {
      this.checkKeyGroupAttribute(object, item);
    }

    for (const propKey of object.properties as (keyof SchemaProperties)[]) {
      const built = this.buildPropertyControls({
        propKey: propKey as string,
        prop: schemaAny.properties[propKey] as any,
        schema: schemaAny,
        item,
        displaySources,
        sourceUpdates$,
      });

      for (const ctrl of built) {
        const ctrlKey = ctrl instanceof FormGroupWithMetaData
          ? (ctrl as FormGroupWithMetaData).id
          : (ctrl as FormControlWithMetaData | FormArrayWithMetaData).name;
        controls[ctrlKey] = ctrl;
        fields.push(ctrl);
      }
    }

    const group = this.createControlGroup(object, controls);

    return {
      ...object,
      fields: fields,
      group: group
    } as DisplayGroup;
  }

  private checkKeyGroupAttribute(view: ViewsInnerViewsInnerViewsInner, item: { [key: string]: any; }): void {
    const defaultAttr = item['defaultAttribute']?.split('.')[1];
    if (defaultAttr && !view.properties.includes(defaultAttr)) {
      view.properties.push(defaultAttr);
    }
    view.properties = view.properties.filter((p: any) => p !== 'defaultAttribute');
  }

  private getPropertyType(property: any, sources?: SourcesObject): FieldDataType {
    const metasysType = property.metasysType ?? findObjectKey(property, 'metasysType');
    let type$: FieldDataType = metasysType;
    if (sources) {
      type$ = {
        type: 'float',
        units: sources['units'] as string | undefined,
        precision: sources['displayPrecision'] as number | undefined,
      };
    } else {

      if (metasysType == DataTypeMetaSchema.MetasysTypeEnum.Enum) {
        if (property.allOf && Array.isArray(property.allOf)) {
          let arr = property.allOf as Array<AllOf>;
          const allOfObj: AllOf = Object.assign({}, ...arr);
          type$ = this.getEnumSetObservable(allOfObj.$ref!);

          if (allOfObj.enum?.length) {
            type$ = type$.pipe(
              map((enumSet) => enumSet.filter(m => allOfObj.enum?.includes(m.const)))
            );
          }

        } else if (property.oneOf && Array.isArray(property.oneOf)) {
          let arr = property.oneOf as Array<AllOf>;
          const oneOfObj: AllOf = Object.assign({}, ...arr);
          type$ = this.getEnumSetObservable(oneOfObj.$ref!);

          if (oneOfObj.enum?.length) {
            type$ = type$.pipe(
              map((enumSet) => enumSet.filter(m => oneOfObj.enum?.includes(m.const)))
            );
          }
        } else {
          this._loggerService.error("Form Service Error:", `Found metasysType to be ${metasysType}, but couldn't find $ref for attribute: ${property}`);
        }
      } else if (metasysType == DataTypeMetaSchema.MetasysTypeEnum.Struct) {
        type$ = metasysType as string;
      } else if (metasysType == DataTypeMetaSchema.MetasysTypeEnum.Listof) {
        type$ = metasysType as string;
      } else {
        type$ = metasysType as string;
      }

    }

    return type$;
  };

  private isComplexMetasysType(metasysType: string | undefined): boolean {
    if (!metasysType) {
      return false;
    }

    const complexTypes = new Set<string>([
      DataTypeMetaSchema.MetasysTypeEnum.AttributeReference,
      DataTypeMetaSchema.MetasysTypeEnum.ObjectReference,
      DataTypeMetaSchema.MetasysTypeEnum.Listof,
      DataTypeMetaSchema.MetasysTypeEnum.Date,
      DataTypeMetaSchema.MetasysTypeEnum.Time,
      DataTypeMetaSchema.MetasysTypeEnum.Struct,
      DataTypeMetaSchema.MetasysTypeEnum.BacOid,
    ]);

    return complexTypes.has(metasysType);
  }

  private normalizeTextLikeProperty(prop: any, readOnly: boolean): any {
    return {
      ...prop,
      metasysType: DataTypeMetaSchema.MetasysTypeEnum.String,
      type: 'string',
      readOnly: readOnly,
    };
  }

  private getDefaultValue(item: any, key: string, prop: any): any {
    if (item && item[key] !== undefined) {
      return item[key];
    }
    return prop?.default ?? null;
  }

  private getReadonlyFormattedValue(value: any, key: string): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'object') {
      return formatStructData(value, key);
    }

    return String(value);
  }

  private toDatePickerValue(value: any): Date | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const year = Number(value.year);
    const month = Number(value.month);
    const dayOfMonth = Number(value.dayOfMonth);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(dayOfMonth)) {
      return null;
    }

    const date = new Date(year, month - 1, dayOfMonth);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toTimePickerValue(value: any): Date | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const hour = Number(value.hour ?? 0);
    const minute = Number(value.minute ?? 0);
    const second = Number(value.second ?? 0);

    if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
      return null;
    }

    const date = new Date();
    date.setHours(hour, minute, second, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getObjectReferenceEditorConfig(property: any, referencedObject?: ReferencedObject): ObjectReferenceEditorConfig | undefined {
    if (!property || typeof property !== 'object') {
      return undefined;
    }

    const objectTypes = Array.isArray(property.objectTypes) ? property.objectTypes : [];
    const allowClear = Array.isArray(property.oneOf)
      ? property.oneOf.some((variant: any) => variant?.type === 'null')
      : false;

    if (this.isObjectReferenceSchema(property)) {
      return {
        type: 'objectReference',
        selectionMode: 'single',
        objectTypes,
        allowClear,
        referencedObject: referencedObject
      };
    }

    if (property.metasysType === DataTypeMetaSchema.MetasysTypeEnum.Listof || property.metasysType === 'listof') {
      const itemSchema = property.items;
      if (this.isObjectReferenceSchema(itemSchema)) {
        return {
          type: 'objectReference',
          selectionMode: 'multi',
          objectTypes: Array.isArray(itemSchema?.objectTypes) ? itemSchema.objectTypes : objectTypes,
          allowClear,
        };
      }
    }

    return undefined;
  }

  private resolveLocalRef(ref: string, schema: any): any | null {
    if (!ref?.startsWith('#')) return null;
    const defKey = ref.startsWith('#/definitions/')
      ? ref.slice('#/definitions/'.length)
      : ref.slice(1);
    return schema?.definitions?.[defKey] ?? null;
  }

  private extractObjectPropertiesFromDef(
    def: any,
    schema: any,
  ): { properties: Record<string, any>; required: string[] } {
    if (!def) return { properties: {}, required: [] };
    if (def.properties) return { properties: def.properties, required: def.required ?? [] };
    if (Array.isArray(def.oneOf)) {
      const primary =
        def.oneOf.find((o: any) => o.required?.length > 0 && o.properties) ??
        def.oneOf.find((o: any) => o.properties);
      if (primary) return { properties: primary.properties, required: primary.required ?? [] };
    }
    if (Array.isArray(def.allOf)) {
      const merged: Record<string, any> = {};
      const required: string[] = [];
      for (const part of def.allOf) {
        if (part.$ref) {
          const sub = this.resolveLocalRef(part.$ref, schema);
          const subResult = this.extractObjectPropertiesFromDef(sub, schema);
          Object.assign(merged, subResult.properties);
          required.push(...subResult.required);
        } else if (part.properties) {
          Object.assign(merged, part.properties);
          if (part.required) required.push(...part.required);
        }
      }
      return { properties: merged, required };
    }
    return { properties: {}, required: [] };
  }

  private getComplexTypeSchemaProperties(
    metasysType: string,
    prop: any,
    schema: any,
  ): { properties: Record<string, any>; required: string[] } {
    switch (metasysType) {
      case DataTypeMetaSchema.MetasysTypeEnum.Struct:
        return { properties: prop.properties ?? {}, required: prop.required ?? [] };

      case DataTypeMetaSchema.MetasysTypeEnum.Date: {
        const inlineDef = prop.oneOf?.find(
          (o: any) => (o.metasysType === 'date' || o.type === 'object') && o.properties,
        );
        if (inlineDef) return { properties: inlineDef.properties, required: inlineDef.required ?? [] };
        return this.extractObjectPropertiesFromDef(this.resolveLocalRef('#metasys-date', schema), schema);
      }

      case DataTypeMetaSchema.MetasysTypeEnum.Time: {
        const allOfVariant = prop.oneOf?.find((o: any) => Array.isArray(o.allOf));
        if (allOfVariant) {
          const ref = allOfVariant.allOf?.find((a: any) => a.$ref)?.$ref;
          const def = ref
            ? this.resolveLocalRef(ref, schema)
            : this.resolveLocalRef('#metasys-time', schema);
          const constraints = allOfVariant.allOf?.find((a: any) => !a.$ref);
          return {
            properties: def?.properties ?? {},
            required: constraints?.required ?? def?.required ?? [],
          };
        }
        return this.extractObjectPropertiesFromDef(this.resolveLocalRef('#metasys-time', schema), schema);
      }

      case DataTypeMetaSchema.MetasysTypeEnum.ObjectReference: {
        const ref = prop.oneOf?.find((o: any) => o.$ref)?.$ref;
        const def = ref
          ? this.resolveLocalRef(ref, schema)
          : this.resolveLocalRef('#object-reference', schema);
        return this.extractObjectPropertiesFromDef(def, schema);
      }

      case DataTypeMetaSchema.MetasysTypeEnum.AttributeReference: {
        const ref = prop.oneOf?.find((o: any) => o.$ref)?.$ref;
        const def = ref
          ? this.resolveLocalRef(ref, schema)
          : this.resolveLocalRef('#attribute-reference', schema);
        return this.extractObjectPropertiesFromDef(def, schema);
      }

      case DataTypeMetaSchema.MetasysTypeEnum.BacOid: {
        const ref = prop.oneOf?.find((o: any) => o.$ref)?.$ref;
        const def = ref ? this.resolveLocalRef(ref, schema) : null;
        return this.extractObjectPropertiesFromDef(def, schema);
      }

      default:
        return { properties: prop.properties ?? {}, required: prop.required ?? [] };
    }
  }

  private buildNestedFormGroup(
    propKey: string,
    prop: any,
    schema: any,
    item: any,
    nestedProperties: Record<string, any>,
    required: string[],
  ): FormGroupWithMetaData {
    const parentValue = (item?.[propKey] && typeof item[propKey] === 'object') ? item[propKey] : null;
    const isReadOnly = !!prop.readOnly;
    const nestedControls: Record<string, FormControlWithMetaData | FormGroupWithMetaData> = {};
    const nestedSchema = { ...schema, required };
    // const groupValidators = this.getGroupValidators(prop, propKey, schema);

    for (const [subKey, subPropRaw] of Object.entries(nestedProperties)) {
      const subProp: any = subPropRaw;
      if (!subProp || typeof subProp !== 'object') continue;
      // Skip sub-objects with their own nested properties to avoid unbounded nesting depth
      if (subProp.type === 'object' && subProp.properties) continue;

      const effectiveProp: any = isReadOnly ? { ...subProp, readOnly: true } : subProp;
      const subValue = parentValue?.[subKey] ?? null;
      const subMetasysType = (effectiveProp.metasysType ?? findObjectKey(effectiveProp, 'metasysType')) as string | undefined;

      // Direct URL $ref with no metasysType → inline enum reference (e.g. `attribute` in attributeReference)
      let subType: FieldDataType;
      if (typeof effectiveProp.$ref === 'string' && !subMetasysType) {
        subType = this.getEnumSetObservable(effectiveProp.$ref);
      } else {
        subType = this.getPropertyType(effectiveProp) ?? DataTypeMetaSchema.MetasysTypeEnum.String;
      }

      const control = this.createControl(subKey, effectiveProp, nestedSchema, subType, parentValue, undefined, subValue);
      nestedControls[subKey] = control;
    }

    const formGroup = new FormGroupWithMetaData(nestedControls, { title: prop.title ?? propKey, id: propKey });

    return formGroup;
  }

  private setContextualEditorReadonly(control: FormControlWithMetaData | FormGroupWithMetaData): void {
    if (control instanceof FormGroupWithMetaData) {
      Object.values(control.controls).forEach((childControl) => {
        this.setContextualEditorReadonly(childControl as FormControlWithMetaData | FormGroupWithMetaData);
      });
      return;
    }

    control.readonly = true;
  }

  private setControlError(control: AbstractControl | null | undefined, errorKey: string, shouldSet: boolean): void {
    if (!control) {
      return;
    }

    const errors = { ...(control.errors ?? {}) };

    if (shouldSet) {
      errors[errorKey] = true;
      control.setErrors(errors);
      return;
    }

    if (!(errorKey in errors)) {
      return;
    }

    delete errors[errorKey];
    control.setErrors(Object.keys(errors).length > 0 ? errors : null);
  }

  private isEmptyFormValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0 || value.every((item) => this.isEmptyFormValue(item));
    }

    if (typeof value === 'object') {
      const objectValues = Object.values(value as Record<string, unknown>);
      return objectValues.length === 0 || objectValues.every((item) => this.isEmptyFormValue(item));
    }

    return false;
  }

  public attachAlarmValuesValidators(group: FormGroupWithMetaData): void {
    const alarmValueArrays = this.findAlarmValueArrays(group);

    if (!alarmValueArrays.length) {
      return;
    }

    group.addValidators(this.createAlarmValuesValidator(group));

    group.updateValueAndValidity({ emitEvent: false });
  }

  private findAlarmValueArrays(control: AbstractControl): FormArrayWithMetaData[] {
    const arrays: FormArrayWithMetaData[] = [];

    const visit = (candidate: AbstractControl): void => {
      if (candidate instanceof FormArrayWithMetaData && candidate.category === propertyCategories.alarmValues) {
        arrays.push(candidate);
      }

      if (candidate instanceof FormGroup || candidate instanceof FormArray) {
        Object.values(candidate.controls).forEach((child) => visit(child as AbstractControl));
      }
    };

    visit(control);
    return arrays;
  }

  private findControlByName(control: AbstractControl, controlName: string): AbstractControl | null {
    if (control instanceof FormGroup || control instanceof FormArray) {
      const direct = control instanceof FormGroup ? control.controls[controlName] ?? null : null;
      if (direct) {
        return direct;
      }

      for (const child of Object.values(control.controls)) {
        const nested = this.findControlByName(child as AbstractControl, controlName);
        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }

  private createAlarmValuesValidator(rootGroup: FormGroupWithMetaData): ValidatorFn {
    return (): { [key: string]: any } | null => {
      const alarmValueArrays = this.findAlarmValueArrays(rootGroup);
      const normalStateControl = this.findControlByName(rootGroup, 'normalState') as FormControlWithMetaData | null;
      const commandReferenceControl = this.findControlByName(rootGroup, 'commandReference') as FormControlWithMetaData | null;
      const normalStateValue = normalStateControl?.value;
      const normalizedNormalState = this.isEmptyFormValue(normalStateValue) ? '' : String(normalStateValue);

      const stateControls: Array<FormControlWithMetaData | null> = [];
      const normalizedStates: Array<{ control: FormControlWithMetaData | null; valueKey: string; arrayControl: FormArrayWithMetaData }> = [];
      const stateCounts = new Map<string, number>();
      let hasErrors = false;

      this.setControlError(normalStateControl, 'normalStateConflict', false);
      this.setControlError(commandReferenceControl, 'alarmValuesPresent', false);

      for (const arrayControl of alarmValueArrays) {
        this.setControlError(arrayControl, 'commandReferencePresent', false);

        for (const itemGroup of arrayControl.controls as FormGroupWithMetaData[]) {
          const stateControl = itemGroup.get('state') as FormControlWithMetaData | null;
          stateControls.push(stateControl);

          const stateValue = stateControl?.value;
          const normalized = this.isEmptyFormValue(stateValue) ? '' : String(stateValue);
          normalizedStates.push({ control: stateControl, valueKey: normalized, arrayControl });

          if (!normalized) {
            continue;
          }

          stateCounts.set(normalized, (stateCounts.get(normalized) ?? 0) + 1);
        }
      }

      for (const stateControl of stateControls) {
        this.setControlError(stateControl, 'duplicateAlarmState', false);
        this.setControlError(stateControl, 'normalStateConflict', false);
      }

      const duplicateStates = new Set<string>();
      for (const [stateValue, count] of stateCounts.entries()) {
        if (count > 1) {
          duplicateStates.add(stateValue);
          hasErrors = true;
        }
      }

      for (const item of normalizedStates) {
        const isDuplicate = !!item.valueKey && duplicateStates.has(item.valueKey);
        this.setControlError(item.control, 'duplicateAlarmState', isDuplicate);
        if (isDuplicate) {
          hasErrors = true;
        }
      }

      if (normalizedNormalState) {
        const normalStateConflict = normalizedStates.filter(item => item.valueKey === normalizedNormalState);
        if (normalStateConflict.length > 0) {
          this.setControlError(normalStateControl, 'normalStateConflict', true);
          for (const item of normalStateConflict) {
            this.setControlError(item.control, 'normalStateConflict', true);
          }
          hasErrors = true;
        }
      }

      if (commandReferenceControl && !this.isEmptyFormValue(commandReferenceControl.value)) {
        for (const arrayControl of alarmValueArrays) {
          this.setControlError(arrayControl, 'commandReferencePresent', true);
        }
        hasErrors = true;
      }

      if (alarmValueArrays.some(arrayControl => arrayControl.length > 0)) {
        this.setControlError(commandReferenceControl, 'alarmValuesPresent', true);
        hasErrors = true;
      }

      return hasErrors ? { alarmValuesValidation: true } : null;
    };
  }

  private mapJsonTypeToFieldDataType(jsonType: string | undefined): string {
    if (jsonType === 'boolean') {
      return DataTypeMetaSchema.MetasysTypeEnum.Bool;
    }
    if (jsonType === 'number') {
      return DataTypeMetaSchema.MetasysTypeEnum.Float;
    }
    if (jsonType === 'integer') {
      return DataTypeMetaSchema.MetasysTypeEnum.Long;
    }
    return DataTypeMetaSchema.MetasysTypeEnum.String;
  }

  private isScalarListItemSchema(itemSchema: any): boolean {
    if (!itemSchema || typeof itemSchema !== 'object') {
      return false;
    }

    const metasysType = (itemSchema.metasysType ?? findObjectKey(itemSchema, 'metasysType')) as string | undefined;
    if (!metasysType) {
      return ['string', 'number', 'integer', 'boolean'].includes(itemSchema.type);
    }

    return !this.isComplexMetasysType(metasysType);
  }

  private getListItemType(itemSchema: any): FieldDataType {
    const metasysType = (itemSchema?.metasysType ?? findObjectKey(itemSchema, 'metasysType')) as string | undefined;
    if (!metasysType) {
      return this.mapJsonTypeToFieldDataType(itemSchema?.type);
    }
    return this.getPropertyType(itemSchema);
  }

  private inferSchemaPropertyFromValue(value: unknown): any {
    if (typeof value === 'boolean') {
      return { title: 'Value', type: 'boolean', metasysType: DataTypeMetaSchema.MetasysTypeEnum.Bool };
    }
    if (typeof value === 'number') {
      const isInteger = Number.isInteger(value);
      return {
        title: 'Value',
        type: isInteger ? 'integer' : 'number',
        metasysType: isInteger ? DataTypeMetaSchema.MetasysTypeEnum.Long : DataTypeMetaSchema.MetasysTypeEnum.Float,
      };
    }

    return { title: 'Value', type: 'string', metasysType: DataTypeMetaSchema.MetasysTypeEnum.String };
  }

  private createListEntryControl(params: {
    parentProp: any;
    propertyKey: string;
    propertySchema: any;
    entryValue: Record<string, any>;
  }): FormControlWithMetaData {
    const isReadOnly = !!params.parentProp?.readOnly;
    const effectiveProp = isReadOnly
      ? { ...params.propertySchema, readOnly: true }
      : params.propertySchema;

    const itemSchema = { required: [] as string[] };
    return this.createControl(
      params.propertyKey,
      effectiveProp,
      itemSchema,
      this.getListItemType(effectiveProp),
      params.entryValue,
      undefined,
      params.entryValue[params.propertyKey],
    );
  }

  private createListItemGroup(params: {
    parentProp: any;
    itemSchema: any;
    entryValue?: unknown;
    itemIndex?: number;
    parentPropKey: string;
  }): FormGroupWithMetaData {
    const entryObj = (params.entryValue && typeof params.entryValue === 'object' && !Array.isArray(params.entryValue))
      ? params.entryValue as Record<string, any>
      : {};

    const schemaProperties: Record<string, any> = params.itemSchema?.properties ?? {};
    const schemaKeys = Object.keys(schemaProperties);
    const valueKeys = Object.keys(entryObj);
    const keys = Array.from(new Set([...schemaKeys, ...valueKeys]));
    const controls: Record<string, FormControlWithMetaData> = {};

    for (const propertyKey of keys) {
      const propertySchema = schemaProperties[propertyKey] ?? this.inferSchemaPropertyFromValue(entryObj[propertyKey]);
      controls[propertyKey] = this.createListEntryControl({
        parentProp: params.parentProp,
        propertyKey,
        propertySchema,
        entryValue: entryObj,
      });
    }

    if (keys.length === 0 && this.isScalarListItemSchema(params.itemSchema)) {
      controls['value'] = this.createListEntryControl({
        parentProp: params.parentProp,
        propertyKey: 'value',
        propertySchema: params.itemSchema,
        entryValue: { value: params.entryValue ?? params.itemSchema?.default ?? null },
      });
    }

    return new FormGroupWithMetaData(controls, {
      title: `${params.parentProp?.title ?? params.parentPropKey} ${((params.itemIndex ?? 0) + 1)}`,
      id: String(params.itemIndex ?? 0),
    });
  }

  private buildListofFormArray(params: {
    propKey: string;
    prop: any;
    item?: { [key: string]: any };
  }): FormArrayWithMetaData {
    //TODO: If specific to the listof property (e.g. alarmValues) add validators that check across FormGroups within the returned FormArray 
    //TODO: - For the `alarmValues` property specifically:
    // - [ ] User cannot add the alarms **normal state** to the alarm values
    // - [ ] If there is a **command reference**, UI **will not allow the user to add any alarm values**
    const { propKey, prop, item } = params;
    const listValues = this.getDefaultValue(item, propKey, prop);
    const initialValues = Array.isArray(listValues) ? listValues : [];
    const itemSchema = prop?.items;
    const isReadOnly = !!prop?.readOnly;

    const controls = initialValues.map((value, itemIndex) => this.createListItemGroup({
      parentProp: prop,
      itemSchema,
      entryValue: value,
      itemIndex,
      parentPropKey: propKey,
    }));

    const listControl = new FormArrayWithMetaData(controls, {
      title: prop?.title ?? propKey,
      id: propKey,
      name: propKey,
      readonly: isReadOnly,
      metasysType: prop?.metasysType,
      category: prop?.category,
      itemSchema,
      createItemGroup: undefined,
    });

    if (!isReadOnly) {
      listControl.createItemGroup = () => this.createListItemGroup({
        parentProp: prop,
        itemSchema,
        entryValue: undefined,
        itemIndex: listControl.length,
        parentPropKey: propKey,
      });
    }

    return listControl;
  }

  private buildPropertyControls(params: {
    propKey: string;
    prop: any;
    schema: any;
    item?: { [key: string]: any };
    displaySources?: ObjectSourcesInitValueRecord;
    sourceUpdates$?: BehaviorSubject<Partial<DisplaySourceUpdate>>;
  }): Array<FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData> {
    const { propKey, prop, item, displaySources, sourceUpdates$ } = params;
    const metasysType = (prop?.metasysType ?? findObjectKey(prop, 'metasysType')) as string | undefined;

    let sourcesObs$: Observable<Partial<DisplaySourceUpdate>> | undefined;
    if (displaySources && sourceUpdates$ && Object.keys(displaySources).includes(propKey)) {
      sourcesObs$ = this.getSourceUpdateObservable(displaySources[propKey], sourceUpdates$);
    }

    if (metasysType === DataTypeMetaSchema.MetasysTypeEnum.Date) {
      const pickerValue = this.toDatePickerValue(item?.[propKey]) ?? this.toDatePickerValue(prop?.default);
      const control = this.createControl(
        propKey,
        prop,
        params.schema,
        'date',
        undefined,
        sourcesObs$,
        pickerValue,
      );
      return [control];
    }

    if (metasysType === DataTypeMetaSchema.MetasysTypeEnum.Time) {
      const pickerValue = this.toTimePickerValue(item?.[propKey]) ?? this.toTimePickerValue(prop?.default);
      const control = this.createControl(
        propKey,
        prop,
        params.schema,
        'time',
        undefined,
        sourcesObs$,
        pickerValue,
      );
      return [control];
    }

    if (metasysType === DataTypeMetaSchema.MetasysTypeEnum.Listof) {
      return [this.buildListofFormArray({ propKey, prop, item })];
    }

    // All other complex types: generate a nested FormGroup with one FormControl per sub-property
    if (this.isComplexMetasysType(metasysType)) {
      const { properties, required } = this.getComplexTypeSchemaProperties(metasysType!, prop, params.schema);
      if (prop.category && prop.category === propertyCategories.versionStruct) {//* Currently I've only noticed that the version schema property has a unique property (`category`) which is equal to 'attributeCategoryEnumSet.versionStructCategory'. This should be used to determine the structure of the final formcontrol(s)
        const versionObj = this.getDefaultValue(item, propKey, prop);
        const value = versionObj.major + '.' + versionObj.minor;
        return [this.createControl(
          propKey,
          this.normalizeTextLikeProperty(prop, !!prop?.readOnly),
          params.schema,
          DataTypeMetaSchema.MetasysTypeEnum.String,
          undefined,
          undefined,
          this.getReadonlyFormattedValue(value, propKey),
        )];

      }

      const wantedProps = Object.keys(properties).filter(key => !this.propertyMetaDataKeys.includes(key));
      if (wantedProps.length > 0) {
        let controlOrGroup;

        if (wantedProps.length == 1) {//* If there is only 1 wanted property, render as a single control instead of a nested FormGroup for better UX (e.g. `referencedObject.name` in objectReference) */
          const value = this.getDefaultValue(item?.[propKey] || {}, wantedProps[0], prop);
          const controlOrGroup = this.createControl(
            propKey,
            prop,
            params.schema,
            this.getPropertyType(prop, displaySources?.[propKey]),
            item,
            sourcesObs$,
            value,
          );
          let referencedObj;
          if (item) referencedObj = item[propKey]?.referencedObject;
          const editorConfig = this.getObjectReferenceEditorConfig(prop,
            referencedObj);
          if (editorConfig) {
            controlOrGroup.contextualEditor = editorConfig;
            this.setContextualEditorReadonly(controlOrGroup);
          }
          return [controlOrGroup];

        }
        //* Create the nested formGroup if there are more than 1 properties that we will want to make controls of (visible to the user in the template)
        controlOrGroup = this.buildNestedFormGroup(propKey, prop, params.schema, item, properties, required);
        // Attach picker metadata to editable objectReference groups
        if (metasysType === DataTypeMetaSchema.MetasysTypeEnum.ObjectReference || metasysType === DataTypeMetaSchema.MetasysTypeEnum.AttributeReference && !prop.readOnly) {
          let objRef;
          if (item && propKey in item && item[propKey] !== null && item[propKey].referencedObject) {
            objRef = item[propKey].referencedObject;
          }
          controlOrGroup.contextualEditor = {
            type: metasysType === DataTypeMetaSchema.MetasysTypeEnum.AttributeReference ? 'attributeReference' : 'objectReference',
            selectionMode: 'single',
            objectTypes: Array.isArray(prop.objectTypes) ? prop.objectTypes : [],
            allowClear: Array.isArray(prop.oneOf) ? prop.oneOf.some((variant: any) => variant?.type === 'null') : false,
            referencedObject: objRef
          };
          this.setContextualEditorReadonly(controlOrGroup);
        }
        return [controlOrGroup];
      }

      // Fallback: if no sub-properties found, render as formatted string
      const value = this.getDefaultValue(item, propKey, prop);
      return [this.createControl(
        propKey,
        this.normalizeTextLikeProperty(prop, !!prop?.readOnly),
        params.schema,
        DataTypeMetaSchema.MetasysTypeEnum.String,
        undefined,
        undefined,
        this.getReadonlyFormattedValue(value, propKey),
      )];
    }

    // Scalar path (enum, float, bool, string, numeric types)
    const value = this.getDefaultValue(item, propKey, prop);
    const control = this.createControl(
      propKey,
      prop,
      params.schema,
      this.getPropertyType(prop, displaySources?.[propKey]),
      item,
      sourcesObs$,
      value,
    );
    const editorConfig = this.getObjectReferenceEditorConfig(prop);
    if (editorConfig) {
      control.contextualEditor = editorConfig;
      this.setContextualEditorReadonly(control);
    }
    return [control];
  }

  private isObjectReferenceSchema(property: any): boolean {
    if (!property || typeof property !== 'object') {
      return false;
    }

    if (property.metasysType === DataTypeMetaSchema.MetasysTypeEnum.ObjectReference || property.metasysType === 'objectReference') {
      return true;
    }

    const candidateRefs: string[] = [
      ...(Array.isArray(property.oneOf) ? property.oneOf.map((v: any) => v?.$ref).filter(Boolean) : []),
      ...(Array.isArray(property.allOf) ? property.allOf.map((v: any) => v?.$ref).filter(Boolean) : []),
    ];

    return candidateRefs.some((ref) => typeof ref === 'string' && ref.endsWith('#object-reference'));
  }

  public getEnumSetObservable(ref: string): Observable<EnumMember[]> {
    return this._objectManagerService.getEnumSet(ref!).pipe(
      map((set) => {
        let r = ref ?? '';
        if (set.$id.endsWith('writePriorityEnumSet') || set.$id.endsWith('displayPrecisionEnumSet')) {
          return set.oneOf
        } else {
          return set.oneOf.sort((a, b) => a.title.localeCompare(b.title));
        }
      }),
    );
  }

  private getSourceUpdateObservable(sources: SourcesObject, sourceUpdates$: BehaviorSubject<Partial<DisplaySourceUpdate>>): Observable<Partial<DisplaySourceUpdate>> {
    const sourceKeys = Object.keys(sources);
    return sourceUpdates$.asObservable().pipe(
      map((updates: Partial<DisplaySourceUpdate>) => {
        let filteredKeys = Object.keys(updates)
          .filter(key => sourceKeys.includes(key)); // or validProps.includes(key) for array
        let reduced = filteredKeys.reduce((filtered: Partial<DisplaySourceUpdate>, key: string) => {
          if (isValidSourceKey(key)) {
            const value = updates[key as keyof DisplaySourceUpdate];
            if (value !== undefined) {
              (filtered as any)[key] = value;
            }
          }
          return filtered;
        }, {} as Partial<DisplaySourceUpdate>);
        return reduced;
      }),

    )
  }

  private createControl(
    key: string,
    prop: GenericSchemaProperty,
    schema: object,
    type: FieldDataType,
    item?: any,
    sourceUpdates$?: Observable<Partial<DisplaySourceUpdate>>,
    initialValue?: any,
  ): FormControlWithMetaData {
    const p = prop as any;
    let value = initialValue !== undefined ? initialValue : (item && item[key] !== undefined ? item[key] : p.default ?? null);
    if (p.metasysType == DataTypeMetaSchema.MetasysTypeEnum.Struct) {
      value = formatStructData(value, key);
    }

    const validators: ValidatorMeta = this.getControlValidators(p, key, schema);

    const control = new FormControlWithMetaData({ value, disabled: p.readOnly ?? false }, validators, key, prop, type, sourceUpdates$);

    if (isObservable(control.type)) {
      //* After retreiving the corresponding enum set for a field/control...
      control.type = control.type.pipe(
        tap((enumMembers) => {

          if (value) {
            //* Depending on whether the control is readonly or not, the control value will be patched with a different value (true == member.title, false == member.const) 
            const member = enumMembers.find(e => e.const == value)!;
            if (member) {
              let patchValue = member.const;
              if (control.readonly == true) {
                patchValue = member.title;
              }
              control.defaultValue = patchValue;
              control.patchValue(patchValue);
            }
          }
        }),
      );
    }

    return control;
  }

  public getControlValidators(property: any, key: string, schema: any): ValidatorMeta {
    const validators: ValidatorMeta = {};
    if (schema.required?.includes(key)) validators.required = true//schema.required;

    if (property.maxLength !== undefined) validators.maxLength = property.maxLength;
    if (property.minLength !== undefined) validators.minLength = property.minLength;
    if (property.minimum !== undefined) validators.minValue = property.minimum;
    if (property.maximum !== undefined) validators.maxValue = property.maximum;

    return validators;
  }

  // public getGroupValidators(property: any, key: string, schema: any): ValidatorMeta {
  //   const validators: ValidatorMeta = {};
  //   if (schema.required?.includes(key)) validators.required = true//schema.required;

  //   return validators;

  // }

  private createControlGroup(view: ViewsInnerViewsInnerViewsInner, controls: Record<string, FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData>): FormGroupWithMetaData {
    return new FormGroupWithMetaData(controls, { title: view.title, id: view.id });
  }


  public updateDisplayPageControls({ viewPage, updates }: { viewPage: DisplayViewPage; updates: Array<ObjectsStreamValuesUpdateInner> }): Observable<any> {
    const updateProperties = this.getUpdates(updates);
    const controlUpdates: Array<{ control: FormControlWithMetaData; value: any }> = [];

    updateProperties.forEach((p) => {
      const keyControl = viewPage.keyView!.group.get(p.key) as FormControlWithMetaData;
      if (keyControl && keyControl.value !== p.value) {
        controlUpdates.push({ control: keyControl, value: p.value });
      } else {
        viewPage.views.forEach((v) => {
          v.views.forEach((g) => {
            const control = g.group.get(p.key) as FormControlWithMetaData;
            if (control && control.value !== p.value) {
              controlUpdates.push({ control, value: p.value });
            }
          });
        });
      }
    });

    if (viewPage.displaySources$) {
      // let sourceNames = Object.keys(viewPage.displaySources$.value);
      // if (sourceNames.includes(update.control.name)) {
      // }



      // updates = updates.filter(u => {
      //   let key = Object.keys(u.item)[0];
      //   return !Object.keys(viewPage.displaySources$.value).includes(key);
      // });

      const names: string[] = Array.from(Object.values(SOURCE_TO_DISPLAY_KEY));
      const updatedPropertyNames: string[] = updates.map(u => Object.keys(u.item)[0]);

      if (updatedPropertyNames.some(name => names.includes(name))) {
        {
          let units, displayPrecision, minPresentValue, maxPresentValue;

          updates.forEach(u => {

            if (names.includes(Object.keys(u.item)[0])) {
              if (u.item['units']) {
                const unitStr = u.item['units'] as string;
                const unitUpdateObs: Observable<DisplaySourceUpdate> = this._objectManagerService.getEnumSet(unitStr.split('.')[0]).pipe(
                  map((enumSet: EnumSet) => {
                    const enumMember = enumSet.oneOf.find(m => m.const === unitStr);
                    if (enumMember) {
                      return { units: enumMember.title } as DisplaySourceUpdate;
                    } return { units: unitStr } as DisplaySourceUpdate;
                  }),
                  tap((unitUpdate) => {
                    viewPage.displaySources$?.next(unitUpdate);
                  })
                );
                unitUpdateObs.subscribe();
              } else if (u.item['displayPrecision']) {
                displayPrecision = resolveDisplayPrecision(u.item['displayPrecision'] as string) as number | undefined;
              } else if (u.item['minPresValue']) {
                minPresentValue = u.item['minPresValue'] as string | undefined;
              } else if (u.item['maxPresValue']) {
                maxPresentValue = u.item['maxPresValue'] as string | undefined;
              }

            }
          })
          const displayUpdate = {
            displayPrecision: displayPrecision,
            minPresentValue: minPresentValue,
            maxPresentValue: maxPresentValue
          }
          viewPage.displaySources$.next(displayUpdate);

        }

      }
    }


    return from(controlUpdates).pipe(
      mergeMap((update) => {
        if (isObservable(update.control.type ?? undefined)) {

          return this._objectManagerService.getEnumSet(update.value.split('.')[0]).pipe(
            tap((enumSet: EnumSet) => {
              const enumMember = enumSet.oneOf.find(m => m.const === update.value);
              if (enumMember) {
                let patchValue = enumMember.const;
                if (update.control.readonly == true) {
                  patchValue = enumMember.title;
                }
                update.control.defaultValue = patchValue
                update.control.patchValue(patchValue, { emitEvent: false });
              }
            }),
            map((enumSet) => {
              return update
            })
          );
        }
        update.control.defaultValue = update.value;
        update.control.patchValue(update.value, { emitEvent: false })
        return of(update);
      }),

    );

  }

  private getUpdates(updates: Array<ObjectsStreamValuesUpdateInner>): Array<{ key: string, value: any }> {
    const updateFields: Array<{ key: string, value: any }> = [];
    updates.forEach((item) => {
      const key = Object.keys(item.item).find(k => k !== "id" && k !== "itemReference");
      const value = key ? item.item[key] : undefined;
      if (key) {
        updateFields.push({ key, value });
      }
    });
    return updateFields;
  }

}
