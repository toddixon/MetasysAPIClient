import { FormControl, Validators } from "@angular/forms";
import { FloatSchemaProperty, GenericSchemaProperty } from "./object-schema.models";
import { DisplaySourceUpdate, FieldDataType, FloatType, isFloatType } from "./object-views.models";
import { formatStructData } from "../helpers/formatStructData";
import { BehaviorSubject, combineLatest, distinctUntilChanged, filter, from, map, Observable, of, pairwise, sample, skip, startWith, Subject, tap } from "rxjs";
import { DisplayPrecisionEnumSet, getPrecision, isDisplayPrecisionEnumValue, resolveDisplayPrecision } from "./display.models";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { DataTypeMetaSchema } from "../api";

export interface ValidatorMeta {
  required?: boolean,
  maxValue?: number,
  minValue?: number,
  maxLength?: number,
  minLength?: number,
  //* Determined by object's .metasysType property
  //* float: minValue, maxValue
  //* string: minLength, maxLength
}

export type ObjectReferenceSelectionMode = 'single' | 'multi';

export interface ReferencedObject {
  objectUrl: string
  attributeUrl?: string
  objectName: string
}

export interface ObjectReferenceEditorConfig {
  type: 'objectReference' | 'attributeReference';
  selectionMode: ObjectReferenceSelectionMode;
  objectTypes: string[];
  allowClear?: boolean;
  referencedObject?: ReferencedObject;
}


export class FormControlWithMetaData<T = any> extends FormControl<any> {
  readonly type$?: BehaviorSubject<FloatType>;

  public title!: string;
  public name!: string;
  public type!: FieldDataType;
  public readonly?: boolean;
  public dynamic?: boolean;
  public metasysType?: string;
  public validatorMeta?: ValidatorMeta;
  public contextualEditor?: ObjectReferenceEditorConfig;

  public focusChangedSubject$?: Subject<boolean>;

  constructor(
    formState: T,
    validators: ValidatorMeta,
    name: string,
    prop: GenericSchemaProperty,
    type: FieldDataType,
    displaySources$?: Observable<Partial<DisplaySourceUpdate>>
  ) {
    let controlValidators: any[] = []
    if (Object.keys(validators).length > 0) {
      if (validators.required) controlValidators.push(Validators.required);
      if (validators.maxLength !== undefined) controlValidators.push(Validators.maxLength(validators.maxLength));
      if (validators.minLength !== undefined) controlValidators.push(Validators.minLength(validators.minLength));
      if (validators.minValue !== undefined) controlValidators.push(Validators.min(validators.minValue));
      if (validators.maxValue !== undefined) controlValidators.push(Validators.max(validators.maxValue));
    }


    super(formState, controlValidators);

    if (isFloatType(type)) {
      this.type$ = new BehaviorSubject(type);
      this.setupFloatPrecisionHandling(this.type$);

    }

    const p = prop as any;

    this.name = name;
    this.type = type;
    this.title = p.title;
    this.readonly = p.readOnly;
    this.dynamic = p.dynamic;
    this.metasysType = p.metasysType;
    this.validatorMeta = validators;

    if (displaySources$) {

      this.focusChangedSubject$ = new Subject<boolean>();
      const focusChanged$ = this.focusChangedSubject$!.asObservable().pipe(
        filter(focused => focused === false),
        startWith(false),
      );

      displaySources$.pipe(

        tap((updates) => {
          if (updates.minPresValue || updates.maxPresValue) {
            this.updateMinMaxValues(
              updates.minPresValue ? Number(updates.minPresValue) : undefined,
              updates.maxPresValue ? Number(updates.maxPresValue) : undefined
            );
          }
          if (updates.displayPrecision) {
            this.setPrecision(updates.displayPrecision)
            // let controlValue = getPrecision(value as number, updates.displayPrecision);
            // if (controlValue !== value.toString()) {
            // super.setValue(controlValue as T, {
            // emitEvent: false,
            // });
            // }
          }
          if (updates.units) {
            this.setUnits(updates.units);//* Shouldn't matter when we set units
          }
        }),
      ).subscribe();

      const valuechanges$ = this.valueChanges.pipe(
        startWith(this.value),
        tap((data) => {
          console.log(data);
        }),
      )

    }


  }


  public setUnits(units: string) {
    if (isFloatType(this.type)) {
      this.type.units = units;
    }
  }

  public setPrecision(precision: number) {
    if (isFloatType(this.type)) {
      this.type.precision = precision;
      // this.type$!.next(this.type);
    }
  }

  public updateMinMaxValues(minValue?: number, maxValue?: number) {
    if (minValue) {
      this.setValidators([Validators.min(minValue)]);
    }
    if (maxValue) {
      this.setValidators([Validators.max(maxValue)]);
    }

  }

  /** Centralized float handling */
  private setupFloatPrecisionHandling(type$: BehaviorSubject<FloatType>): void {
    // combineLatest([
    //   this.valueChanges.pipe(distinctUntilChanged(), startWith(this.value)),
    //   type$
    // ]).subscribe(([value, type]) => {
    //   let controlValue = value;
    //   if (type.precision) {
    //     controlValue = getPrecision(value as number, type.precision);
    //   }

    //   if (controlValue !== value.toString()) {
    //     super.setValue(controlValue as T, {
    //       emitEvent: false,
    //     });
    //   }
    // });
  }
}

export type NumberValidators = Required<Pick<ValidatorMeta, 'minValue' | 'maxValue'>>;
export type StringNumberValidators = {
  minValue: string,
  maxValue: string,
};


export function isNumberValidator(obj: ValidatorMeta | undefined): obj is NumberValidators {
  if (obj) {
    return obj.minValue !== undefined && obj.maxValue !== undefined;
  } return false;
}