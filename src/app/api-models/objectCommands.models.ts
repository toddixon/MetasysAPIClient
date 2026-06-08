import { AggregateCommandSet } from "../api/model/aggregateCommandSet";
import { GetObjectCommands200ResponseItemsInner } from "../api/model/getObjectCommands200ResponseItemsInner";

export function is(value: GetObjectCommands200ResponseItemsInner): value is AggregateCommandSet {
  return value.aggregateCommand || false
}
