import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormsModule, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { DisplayGroup, FieldDataType, FloatType, isFloatType } from '../models/object-views.models';
import { ngxSkeletonThemes } from '../constants/ngxSkeleton.consants';
import { EnumMember, isEnumMemberArr } from '../models/enum-set.models';
import { isObservable } from 'rxjs';
import { environment } from '../../environments/environment.development';
import { FormGroupWithMetaData } from '../models/formGroupWithMetadata.model';
import { FormControlWithMetaData } from '../models/formControlWithMetadata.model';
import { FormArrayWithMetaData } from '../models/formArrayWithMetadata.model';
import { FloatInputSliderControlComponent } from '../float-input-slider-control/float-input-slider-control.component';

const ALWAYS_VISIBLE_ERROR_KEYS = new Set([
  'duplicateAlarmState',
  'normalStateConflict',
  'alarmValuesPresent',
  'commandReferencePresent',
  'alarmValuesValidation',
]);

@Component({
  selector: 'app-control-group',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatTabsModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatDividerModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTimepickerModule,
    MatExpansionModule,
    MatIcon,
    NgxSkeletonLoaderComponent,
    FloatInputSliderControlComponent
  ],
  templateUrl: './control-group.component.html',
  styleUrl: './control-group.component.scss'
})
export class ControlGroupComponent implements OnInit {
  @Input({ required: true }) group!: DisplayGroup;
  @Output() objectReferencePickerRequested = new EventEmitter<FormControlWithMetaData | FormGroupWithMetaData>();
  public isProd: boolean = environment.production;
  public ngxSkeletonThemes = ngxSkeletonThemes;
  public isObservable = isObservable;
  public isFloatType = isFloatType;

  ngOnInit(): void {

  }

  public getControl(form: FormGroupWithMetaData, name: string): FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData {
    return form.get(name) as FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData;
  }

  public isFormGroup(control: FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData): control is FormGroupWithMetaData {
    return control instanceof FormGroupWithMetaData;
  }

  public isFormArray(control: FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData): control is FormArrayWithMetaData {
    return control instanceof FormArrayWithMetaData;
  }

  public getGroupControlEntries(group: FormGroupWithMetaData): Array<{ key: string; value: FormControlWithMetaData }> {
    return Object.entries(group.controls as Record<string, FormControlWithMetaData | FormGroupWithMetaData>)
      .filter(([, ctrl]) => ctrl instanceof FormControlWithMetaData)
      .map(([key, ctrl]) => ({ key, value: ctrl as FormControlWithMetaData }));
  }

  public getControlType(type: FloatType | string): string {
    if (isFloatType(type)) {
      return 'float'
    }
    return type;
  }

  public isEnumSet(obj: FieldDataType) {
    return isEnumMemberArr(obj);
  }

  public getSetMember(memberConst: string, enumSet: EnumMember[]): string {
    let val: string | undefined;
    const member = enumSet.find(m => m.const == memberConst);
    if (member) {
      val = member.title;
    }
    return val ?? 'NOT FOUND'
  }

  public isEnumMember(obj: string | EnumMember[] | EnumMember): obj is EnumMember {
    return !Array.isArray(obj) && typeof obj !== 'string';
  }

  public logTemplateInfo(info: any) {
    // console.log('struct detected!');
  }

  public resetControl(event: PointerEvent, control: FormControlWithMetaData) {
    event.stopImmediatePropagation();
    control.reset();
    control.markAsPristine();
  }

  public getArrayItems(control: FormArrayWithMetaData): FormGroupWithMetaData[] {
    return control.controls as FormGroupWithMetaData[];
  }

  public addArrayItem(event: MouseEvent, control: FormArrayWithMetaData): void {
    event.stopPropagation();
    if (control.readonly || !control.createItemGroup) {
      return;
    }

    control.push(control.createItemGroup());
    control.markAsDirty();
  }

  public removeArrayItem(event: MouseEvent, control: FormArrayWithMetaData, index: number): void {
    event.stopPropagation();
    if (control.readonly) {
      return;
    }

    control.removeAt(index);
    control.markAsDirty();
  }

  public getArrayItemTitle(control: FormArrayWithMetaData, index: number): string {
    return `${control.title} ${index + 1}`;
  }

  public hasArrayItemErrors(itemGroup: FormGroupWithMetaData): boolean {
    return Object.values(itemGroup.controls).some((control) => control.invalid);
  }

  public hasControlErrors(control: AbstractControl | null | undefined): boolean {
    const errors = control?.errors;
    if (!errors || Object.keys(errors).length === 0) {
      return false;
    }

    const hasAlwaysVisibleError = Object.keys(errors).some((errorKey) => ALWAYS_VISIBLE_ERROR_KEYS.has(errorKey));
    if (hasAlwaysVisibleError) {
      return true;
    }

    return !!control?.touched || !!control?.dirty;
  }

  public getFirstControlErrorMessage(control: AbstractControl | null | undefined): string {
    const errors = control?.errors;
    if (!errors) {
      return '';
    }

    const errorKey = Object.keys(errors)[0];
    if (!errorKey) {
      return '';
    }

    return this.getControlErrorMessage(errorKey, errors[errorKey]);
  }

  private getControlErrorMessage(errorKey: string, errorValue: unknown): string {
    switch (errorKey) {
      case 'required':
        return 'This field is required.';
      case 'minlength':
        return `Minimum length is ${(errorValue as { requiredLength?: number })?.requiredLength ?? ''}.`;
      case 'maxlength':
        return `Maximum length is ${(errorValue as { requiredLength?: number })?.requiredLength ?? ''}.`;
      case 'min':
        return `Value must be at least ${(errorValue as { min?: number })?.min ?? ''}.`;
      case 'max':
        return `Value must be at most ${(errorValue as { max?: number })?.max ?? ''}.`;
      case 'duplicateAlarmState':
        return 'Alarm state must be unique.';
      case 'normalStateConflict':
        return 'Alarm value cannot match normal state.';
      case 'alarmValuesPresent':
        return 'Clear alarm values before setting command reference.';
      case 'commandReferencePresent':
        return 'Clear command reference before adding alarm values.';
      case 'alarmValuesValidation':
        return 'Resolve alarm value validation errors.';
      default:
        return 'Invalid value.';
    }
  }

  public canAddArrayItem(control: FormArrayWithMetaData, parentGroup: FormGroupWithMetaData): boolean {
    if (control.readonly || !control.createItemGroup) {
      return false;
    }

    if (control.category === 'attributeCategoryEnumSet.alarmValuesCategory') {
      const commandReference = parentGroup.get('commandReference');
      return this.isEmptyValue(commandReference?.value);
    }

    return true;
  }

  private isEmptyValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0 || value.every((item) => this.isEmptyValue(item));
    }

    if (typeof value === 'object') {
      const objectValues = Object.values(value as Record<string, unknown>);
      return objectValues.length === 0 || objectValues.every((item) => this.isEmptyValue(item));
    }

    return false;
  }

  public hasContextualEditor(control: FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData): boolean {
    return !!(control as any).contextualEditor;
  }

  public getObjectReferenceDisplayValue(control: FormControlWithMetaData | FormGroupWithMetaData): string {
    if (control instanceof FormGroupWithMetaData) {
      const refCtrl = control.get('objectReference') as FormControlWithMetaData | null;
      return refCtrl?.value ?? '';
    }
    const ctrl = control as FormControlWithMetaData;
    if (Array.isArray(ctrl.value)) return ctrl.value.join(', ');
    if (typeof ctrl.value === 'string') return ctrl.value;
    return '';
  }

  public requestObjectReferencePicker(event: MouseEvent, control: FormControlWithMetaData | FormGroupWithMetaData): void {
    event.stopPropagation();
    this.objectReferencePickerRequested.emit(control);
  }


}
