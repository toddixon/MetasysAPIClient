import { ObjectAttributeIDs } from "./object-attribute.models"
import { ObjectsStreamValuesUpdateInner } from "../api"

const object_values_heartbeat = { type: "object.values.heartbeat", data: "2025-10-30T23:04:51.1508962Z" }

export type streamTypes = "hello"
  | "message"
  | "object.values.heartbeat"
  | "object.values.heartbeatImproved"
  | "object.values.update"
  | "object.values.error"

export interface ObjectUpdateEvent extends MessageEvent {
  type: 'object.values.update',
  data: string//Array<ObjectValueUpdate>
}

export interface ObjectValueUpdate {
  item: {
    presentValue: number,
    id: string
    itemReference: string
  },
  condition: {
    condition: {
      presentValue: {
        reliability: 'reliabilityEnumSet.reliable' | 'reliabilityEnumSet.unreliable'
      },
    },
    priority: 'writePriorityEnumSet.priorityOperatorOverride' | any
  }
  subscriptionId: string
}

export interface ObjectSubscription {
  subscriptionId: string,
  attribute?: ObjectAttributeIDs
}

export interface StoredStreamEvent {
  timestamp: Date;
  type: string;
  rawData: string | null;
  parsed?: ObjectsStreamValuesUpdateInner[];
}


//! Examples of the different stream types 
const heartbeat_improved = {
  type: "object.values.heartbeatImproved",
  data: {
    "activeSubscriptions":
      ["db40018a-5170-45d3-bb50-5d4ca6e11d8e",
        "fe0ce72b-fe90-49b4-8510-081b7d7818f0",
        "05ec3768-2a51-4cc7-8587-5a080a4a30b3",
        "ce57d710-3adf-4ada-978f-dcb90761e66b",
        "2d75010c-0b40-4f63-8f93-8c584838e567",
        "263887af-b1e1-4f5a-b169-62068f6950ff",
        "02987160-440f-4526-9b61-cddd357444cf",
        "2ca1883c-29b5-45a3-b0eb-b236a841eebf",
        "43acbc33-3506-43b2-926a-be860b565d8e",
        "e97323fe-1ca3-4f1b-86aa-e9f96b543e07",
        "ef9b9176-6fee-4e75-8979-631ba55e351b",
        "de69098b-3e0c-450f-9301-78e5f1f00e67",
        "d362f411-0138-40d8-a144-c6e74517b38b",
        "ea01b265-0abb-489c-8e47-d74c0751d077",
        "6dbffc3c-cfcc-4115-9fd2-e422610844fd",
        "2ba2edac-9934-417d-9d77-0b70ed8861b4",
        "a0d4d8de-c228-4587-b82d-96f76885d029"],
    "dateTime": "2025-10-30T23:01:51.0744756Z"
  }
}

const object_values_update = {
  type: 'object.values.update',
  data: [
    { "item": { presentValue: 200, id: "e7735c88-18ed-5c3b-b3f7-843f2937d91e", itemReference: "DESKTOP-VM:DESKTOP-VM/Programming.AV1" }, condition: { presentValue: { reliability: "reliabilityEnumSet.reliable", priority: "writePriorityEnumSet.priorityOperatorOverride" } }, subscriptionId: "2d75010c-0b40-4f63-8f93-8c584838e567" },
    { "item": { presentValue: 200, id: "e7735c88-18ed-5c3b-b3f7-843f2937d91e", itemReference: "DESKTOP-VM:DESKTOP-VM/Programming.AV1" }, condition: { presentValue: { reliability: "reliabilityEnumSet.reliable", priority: "writePriorityEnumSet.priorityOperatorOverride" } }, subscriptionId: "6dbffc3c- cfcc - 4115 - 9fd2- e422610844fd" },
    { "item": { presentValue: 200, id: "e7735c88-18ed-5c3b-b3f7-843f2937d91e", itemReference: "DESKTOP-VM:DESKTOP-VM/Programming.AV1" }, condition: { presentValue: { reliability: "reliabilityEnumSet.reliable", priority: "writePriorityEnumSet.priorityOperatorOverride" } }, subscriptionId: "ef9b9176-6fee-4e75-8979-631ba55e351b" }
  ]
}
