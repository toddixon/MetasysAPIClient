import { Classification } from "../api";
import { classificationTypes, ObjectTypes } from "./api-object.models";

export const fontIcons = [
  "storage",
  "database",
  "folder",
  "domain",
  "router",
  "warning",
  // "timeline",
  "schedule",
  "calendar_month",
  "data_object",
  "speed",
  "trending_up",
  "device_thermostat",
  "cable",
  "help",
  "account_tree",
  "image_inset",
  "background_dot_large",
  "key",
  "lightbulb_circle",
  "schema",
  "report_off",
  "settings_ethernet",
  "link",
  "schedule",
  "calendar_month",
  "view_compact",

  "nature_people"

];

//* Each entry in this list represents a filename inside the /src/assets/icons/ folder. Each one of these is imported into the mat icon registery inside the icon.service
export const svgIcons = [
  "gamepad_circle_left",
  // "account_circle",
  "input_gauge_0",
  "siren",
  "globe",
  "graph_2",
  "graph_4",
  "database",
  "network_node_0",
  "gauge_0",
  "controller_0",
  "switch_0",
  "device_thermostat_0",
  "info_0",
  "data_exploration",

  "close_0",
  "close_1",
  "circle_circle",
  "exclamation_0",
  "exclamation_1",
  "notifications_0",
  "question_mark_0"

];


export type ObjectTreeIcons = typeof fontIcons[number];

// A mapped type where each classification (from `classificationTypes`) maps to
// one of the allowed `ObjectTreeIcons` literals.
export type ObjectClassToIcon = {
  [K in Classification]: ObjectTreeIcons;
};

// A default mapping from classification -> icon. Adjust the icons as you see fit.
export const objectClassToFontIcon: ObjectClassToIcon = {
  object: 'help',
  device: 'router',
  integration: 'domain',
  controller: 'controller_0',
  point: 'warning',
  site: 'domain',
  navList: 'nature_people',
  extension: 'help',
  folder: 'folder',
  reference: 'help',
  server: 'database',
  archive: 'data_object',
};


export const objectTypeToIcon = {
  "objectTypeEnumSet.siteClass": "domain",
  "objectTypeEnumSet.containerClass": "folder",
  "objectTypeEnumSet.adsClass": "database",
  "objectTypeEnumSet.aaClass": "siren",
  "objectTypeEnumSet.maClass": "siren",
  "objectTypeEnumSet.avClass": "speed",
  "objectTypeEnumSet.avMapperClass": "input_gauge_0",
  "objectTypeEnumSet.trendLogClass": "trending_up",
  "objectTypeEnumSet.bacnetIntegrationClass": "cable",
  "objectTypeEnumSet.graphicClass": "image_inset",
  "objectTypeEnumSet.mvClass": "gamepad_circle_left",
  "objectTypeEnumSet.bacMvClass": "gamepad_circle_left",
  "objectTypeEnumSet.bacProgramClass": "account_tree",
  "objectTypeEnumSet.intlClass": "key",
  "objectTypeEnumSet.bvClass": "lightbulb_circle",
  "objectTypeEnumSet.systemClass": "schema",
  "objectTypeEnumSet.globalDataClass": "globe",
  "objectTypeEnumSet.autoShutdownClass": "report_off",
  "objectTypeEnumSet.fieldBusClass": "network_node_0",

  "objectTypeEnumSet.scNetworkPortClass": "settings_ethernet",
  "objectTypeEnumSet.ethIpClass": "link",
  "objectTypeEnumSet.bacpeClass": "graph_2",
  "objectTypeEnumSet.scheduleClass": "schedule",
  "objectTypeEnumSet.calendarClass": "calendar_month",
  "objectTypeEnumSet.signalSelectClass": "graph_4",
  "objectTypeEnumSet.sdClass": "view_compact",
  "objectTypeEnumSet.navTreeClass": "nature_people",
  // add other objectType keys you expect, e.g.:
  //"objectTypeEnumSet.sensorClass": "siren",
  //"objectTypeEnumSet.controllerClass": "router",
  "objectTypeEnumSet.aoMapperClass": "gauge_0",
  "objectTypeEnumSet.biMapperClass": "circle_circle",
  "objectTypeEnumSet.aiMapperClass": "device_thermostat_0",
  "objectTypeEnumSet.boMapperClass": "switch_0",
  "objectTypeEnumSet.notificationClassMapperClass": "info_0",

  "objectTypeEnumSet.trendStudyClass": "data_exploration",
} as const;
// Convenience function to get the icon for a classification

export const objectStateIconMap: Record<string, string> = {
  'objectStatusEnumSet.osOffline': 'close_1',
  'controllerStatusEnumSet.csCommDisable': 'close_1',
  'controllerStatusEnumSet.csOffline': 'close_1',
  'objectStatusEnumSet.osAlarmUnacknowledged': 'notifications_active',
  'objectStatusEnumSet.osAlarm': 'notifications_0',
  'objectStatusEnumSet.osHighWarning': 'exclamation_0',
  'objectStatusEnumSet.osLowWarning': 'exclamation_0',
  'objectStatusEnumSet.osUnreliable': 'question_mark_0',
  // 'objectStatusEnumSet.osFaultUnacknowledged': 'warning',
  // 'objectStatusEnumSet.osDisabled': 'block',
  // 'objectStatusEnumSet.osAlarm': 'exclamation',

};