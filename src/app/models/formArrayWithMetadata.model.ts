import { FormArray } from '@angular/forms';
import { FormGroupWithMetaData } from './formGroupWithMetadata.model';

export class FormArrayWithMetaData extends FormArray<any> {
  title!: string;
  id!: string;
  name!: string;
  readonly?: boolean;
  metasysType?: string;
  category?: string;
  itemSchema?: any;
  createItemGroup?: () => FormGroupWithMetaData;

  constructor(
    controls: FormGroupWithMetaData[],
    meta: {
      title: string;
      id: string;
      name: string;
      readonly?: boolean;
      metasysType?: string;
      category?: string;
      itemSchema?: any;
      createItemGroup?: () => FormGroupWithMetaData;
    },
  ) {
    super(controls);

    this.title = meta.title;
    this.id = meta.id;
    this.name = meta.name;
    this.readonly = meta.readonly;
    this.metasysType = meta.metasysType;
    this.category = meta.category;
    this.itemSchema = meta.itemSchema;
    this.createItemGroup = meta.createItemGroup;
  }
}
