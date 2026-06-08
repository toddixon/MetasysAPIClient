import { FormControl, FormGroup, Validators } from "@angular/forms";
import { GenericSchemaProperty } from "./object-schema.models";
import { FieldDataType } from "./object-views.models";
import { formatStructData } from "../helpers/formatStructData";
import { FormControlWithMetaData, ObjectReferenceEditorConfig } from "./formControlWithMetadata.model";
import { FormArrayWithMetaData } from "./formArrayWithMetadata.model";

export class FormGroupWithMetaData extends FormGroup<any> {
  title!: string;
  id!: string;
  contextualEditor?: ObjectReferenceEditorConfig;

  constructor(
    controls: Record<string, FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData>,
    meta: { title: string; id: string },
    validators?: any[],
  ) {
    super(controls);

    this.title = meta.title;
    this.id = meta.id;
  }

  /** Optional typed getter */
  override get(path: string): FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData | null {
    return super.get(path) as FormControlWithMetaData | FormGroupWithMetaData | FormArrayWithMetaData | null;
  }

}
