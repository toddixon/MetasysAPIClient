import { AggregateCommandSet, DataTypeMetaSchema, GetObjectCommands200ResponseItemsInner } from "../api";
import { FormGroupWithMetaData } from "./formGroupWithMetadata.model";
import { MetasysTypes } from "./object-schema.models";

//* <GetObjectCommands200ResponseItemsInner>.commandBodySchema.properties
export interface CommandProperties {
  additionalProperties: boolean,
  annotation?: AnnotationProperty,
  required?: string[],
  parameters?: CommandParameters,
}

export interface AnnotationProperty {
  title: string,
  type: string,
  metasysType: DataTypeMetaSchema,//* "string" */
  minLength: number,
  maxLength: number,
}

export interface CommandParameters {
  items: any[],//* Each item represents a different parameter that is configured for executing the command for the default attribute () 
  maxItems: number,
  minItems: number,
  metasysType: DataTypeMetaSchema,//* "list" */
  type: string,
}


export interface CommandFormControls {
  properties?: FormGroupWithMetaData,
  parameters?: FormGroupWithMetaData,
  commonControls?: FormGroupWithMetaData, 
}

export function isAggregateCommand(command: GetObjectCommands200ResponseItemsInner): command is AggregateCommandSet {
  return command.aggregateCommand? true : false;
}


export interface CommandPriorityEntry {
  priority: string, value: string, memberId: number
};



// item Example:
// {
//   id: "commandParmsEnumSet.valueCmdparm",
//   title: "Value",
//   displayPrecisionSource: "displayPrecision",
//   maxPresValueSource: "maxPresValue",
//   minPresValueSource: "minPresValue",
//   unitsSource: "units",
//   metasysType: "float",
//   type: "number",
//   minimum: -1.69999998e+38,
//   maximum: 1.69999998e+38,
//   displayPrecision: {
//     id: "displayPrecisionEnumSet.displayPrecisionPt1",
//     displayMultipleOf: 0.1,
//   },
//   default: 0,
// }

// Annotation Example:
// {
//   title: "Annotation",
//   type: "string",
//   metasysType: "string",
//   minLength: 1,
//   maxLength: 255,
// }