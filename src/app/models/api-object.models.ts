import { Observable } from "rxjs";
import { Schema } from "./object-schema.models";




// export interface ObjectTree {
//     self: string;
//     items: Item[];
//     effectivePermissions: EffectivePermissions;
// }

export interface EffectivePermissions {
    canDelete: any[];
    canView: string[];
    canModify: string[];
}


// export interface Item {
//     self: string;
//     parentUrl: null | string;
//     networkDeviceUrl: string;
//     pointsUrl: string;
//     objectsUrl: string;
//     alarmsUrl: string;
//     auditsUrl: string;
//     trendedAttributesUrl: string;
//     itemReference: string;
//     hasChildrenMatchingQuery: boolean;
//     name: string;
//     label: string;
//     id: string;
//     objectType: string;
//     objectTypeVersion: string;
//     classification: classificationTypes;
//     items: Item[];
//     views: ObjectView[];

//     item?: ObjectItem,
//     samplesUrl?: string,


//     //* Additional Properties instantiated by application
//     attribute$?: Observable<any>,
//     samples?: Observable<any>,
//     expanded?: boolean
// }

// export interface ItemAndSchema extends Item {
//     schema: Schema,//* includeSchema = True
// }


export interface ObjectItem {
    id: string;
    name: string;
    description: string;
    bacnetObjectType: string;
    objectCategory: string;//*
    outOfService: boolean;
    reliability: string;
    currentCommandPriority: null;
    alarmState: string;
    overrideExpirationTime: string;
    presentValueWritable: string;
    itemReference: string;
    version: object;
    prioritySupported: boolean;
    minPresValue: number;
    maxPresValue: number;
    units: string;
    displayPrecision: string;
    covIncrement: number;
    connectedToInternalApplication: string;
    presentValue: number;//*
    status: string;
    attrChangeCount: number;
    defaultAttribute: string | null;//*

};


// export function isItem(obj: any, _seen = new WeakSet()): obj is Item {
//     if (obj === null || typeof obj !== 'object') return false;

//     const reqStrProps = [
//         'self',
//         'networkDeviceUrl',
//         'pointsUrl',
//         'objectsUrl',
//         'alarmsUrl',
//         'auditsUrl',
//         'trendedAttributesUrl',
//         'itemReference',
//         'name',
//         'label',
//         'id',
//         'objectType',
//         'objectTypeVersion'
//     ];



//     for (const p of reqStrProps) {
//         if (typeof obj[p] !== 'string') return false;
//     }

//     if (!(typeof obj.parentUrl === 'string' || obj.parentUrl === null)) return false;
//     if (typeof obj.hasChildrenMatchingQuery !== 'boolean') return false;

//     // classification must be one of the known literals
//     if (!classifications.includes(obj.classification)) return false;

//     if (!Array.isArray(obj.items)) return false;

//     // protect against circular refs
//     if (_seen.has(obj)) return true;
//     _seen.add(obj);

//     // recursively validate children
//     for (const child of obj.items) {
//         if (!isItem(child, _seen)) return false;
//     }

//     // optional checks
//     if ('samplesUrl' in obj && typeof obj.samplesUrl !== 'string') return false;
//     if ('samples' in obj && !(obj.samples && typeof obj.samples.subscribe === 'function')) return false;
//     if ('item' in obj && obj.item !== undefined && obj.item !== null && !isItem(obj.item, _seen)) return false;

//     return true;
// }

// export interface ItemLive extends Item {
//     samples: Observable<any>,
//     objTreeRef: Observable<Item>
// }

// export function isItemLive(obj: any): obj is ItemLive {
//     if (isItem(obj)) {
//         if (Object.keys(obj).includes('samples') && Object.keys(obj).includes('objTreeRef')) {
//             return true;
//         }
//         return false;
//     }
//     return false;
// }




// export function assertItemType:  {

// }

const classifications = [
    "object",
    "device",
    "integration",
    "controller",
    "point",
    "site",
    "navList",
    "extension",
    "folder",
    "reference",
    "server",
    "archive",
] as const;



export type ObjectTypes =
    "objectTypeEnumSet.containerClass" |
    "objectTypeEnumSet.avClass" |
    "objectTypeEnumSet.mvClass" |
    "objectTypeEnumSet.bvClass" |
    "objectTypeEnumSet.adsClass" |
    "objectTypeEnumSet.siteClass" |
    "objectTypeEnumSet.aaClass" |
    "objectTypeEnumSet.maClass" |
    "objectTypeEnumSet.trendLogClass" |
    "objectTypeEnumSet.bacnetIntegrationClass" |
    "objectTypeEnumSet.graphicClass" |
    "objectTypeEnumSet.bacMvClass" |
    "objectTypeEnumSet.bacProgramClass" |
    "objectTypeEnumSet.intlClass" |
    "objectTypeEnumSet.systemClass" |
    "objectTypeEnumSet.globalDataClass" |
    "objectTypeEnumSet.autoShutdownClass" |
    "objectTypeEnumSet.scNetworkPortClass" |
    "objectTypeEnumSet.ethIpClass" |
    "objectTypeEnumSet.bacpeClass" |
    "objectTypeEnumSet.scheduleClass" |
    "objectTypeEnumSet.calendarClass" |
    "objectTypeEnumSet.signalSelectClass" |
    "objectTypeEnumSet.sdClass" |
    "objectTypeEnumSet.navTreeClass";

export type classificationTypes = typeof classifications[number];

