export interface NetworkDevice {
    total:                number;
    next:                 null;
    previous:             null;
    items:                Item[];
    effectivePermissions: EffectivePermissions;
    self:                 string;
}

export interface EffectivePermissions {
    canDelete: string[];
    canView:   string[];
    canModify: string[];
}

export interface Item {
    id:                        string;
    itemReference:             string;
    name:                      string;
    objectType:                string;
    description:               string;
    firmwareVersion:           string;
    objectCategory:            string;
    timeZone:                  null | string;
    objectTypeVersion:         string;
    productVersion:            string;
    self:                      string;
    parentUrl:                 null | string;
    networkDevicesUrl:         string;
    equipmentUrl:              string;
    spacesUrl:                 string;
    objectsUrl:                string;
    trendedAttributesUrl:      string;
    alarmsUrl:                 string;
    ipAddress:                 string;
    certificateExpirationDate: Date | null;
    pairing:                   Pairing;
}

export interface Pairing {
    supported: boolean;
    paired:    boolean;
}

// Converts JSON strings to/from your types
// and asserts the results of JSON.parse at runtime
export class Convert {
    public static toNetworkDevice(json: string): NetworkDevice {
        return cast(JSON.parse(json), r("NetworkDevice"));
    }

    public static networkDeviceToJson(value: NetworkDevice): string {
        return JSON.stringify(uncast(value, r("NetworkDevice")), null, 2);
    }
}

function invalidValue(typ: any, val: any, key: any, parent: any = ''): never {
    const prettyTyp = prettyTypeName(typ);
    const parentText = parent ? ` on ${parent}` : '';
    const keyText = key ? ` for key "${key}"` : '';
    throw Error(`Invalid value${keyText}${parentText}. Expected ${prettyTyp} but got ${JSON.stringify(val)}`);
}

function prettyTypeName(typ: any): string {
    if (Array.isArray(typ)) {
        if (typ.length === 2 && typ[0] === undefined) {
            return `an optional ${prettyTypeName(typ[1])}`;
        } else {
            return `one of [${typ.map(a => { return prettyTypeName(a); }).join(", ")}]`;
        }
    } else if (typeof typ === "object" && typ.literal !== undefined) {
        return typ.literal;
    } else {
        return typeof typ;
    }
}

function jsonToJSProps(typ: any): any {
    if (typ.jsonToJS === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.json] = { key: p.js, typ: p.typ });
        typ.jsonToJS = map;
    }
    return typ.jsonToJS;
}

function jsToJSONProps(typ: any): any {
    if (typ.jsToJSON === undefined) {
        const map: any = {};
        typ.props.forEach((p: any) => map[p.js] = { key: p.json, typ: p.typ });
        typ.jsToJSON = map;
    }
    return typ.jsToJSON;
}

function transform(val: any, typ: any, getProps: any, key: any = '', parent: any = ''): any {
    function transformPrimitive(typ: string, val: any): any {
        if (typeof typ === typeof val) return val;
        return invalidValue(typ, val, key, parent);
    }

    function transformUnion(typs: any[], val: any): any {
        // val must validate against one typ in typs
        const l = typs.length;
        for (let i = 0; i < l; i++) {
            const typ = typs[i];
            try {
                return transform(val, typ, getProps);
            } catch (_) {}
        }
        return invalidValue(typs, val, key, parent);
    }

    function transformEnum(cases: string[], val: any): any {
        if (cases.indexOf(val) !== -1) return val;
        return invalidValue(cases.map(a => { return l(a); }), val, key, parent);
    }

    function transformArray(typ: any, val: any): any {
        // val must be an array with no invalid elements
        if (!Array.isArray(val)) return invalidValue(l("array"), val, key, parent);
        return val.map(el => transform(el, typ, getProps));
    }

    function transformDate(val: any): any {
        if (val === null) {
            return null;
        }
        const d = new Date(val);
        if (isNaN(d.valueOf())) {
            return invalidValue(l("Date"), val, key, parent);
        }
        return d;
    }

    function transformObject(props: { [k: string]: any }, additional: any, val: any): any {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return invalidValue(l(ref || "object"), val, key, parent);
        }
        const result: any = {};
        Object.getOwnPropertyNames(props).forEach(key => {
            const prop = props[key];
            const v = Object.prototype.hasOwnProperty.call(val, key) ? val[key] : undefined;
            result[prop.key] = transform(v, prop.typ, getProps, key, ref);
        });
        Object.getOwnPropertyNames(val).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(props, key)) {
                result[key] = transform(val[key], additional, getProps, key, ref);
            }
        });
        return result;
    }

    if (typ === "any") return val;
    if (typ === null) {
        if (val === null) return val;
        return invalidValue(typ, val, key, parent);
    }
    if (typ === false) return invalidValue(typ, val, key, parent);
    let ref: any = undefined;
    while (typeof typ === "object" && typ.ref !== undefined) {
        ref = typ.ref;
        typ = typeMap[typ.ref];
    }
    if (Array.isArray(typ)) return transformEnum(typ, val);
    if (typeof typ === "object") {
        return typ.hasOwnProperty("unionMembers") ? transformUnion(typ.unionMembers, val)
            : typ.hasOwnProperty("arrayItems")    ? transformArray(typ.arrayItems, val)
            : typ.hasOwnProperty("props")         ? transformObject(getProps(typ), typ.additional, val)
            : invalidValue(typ, val, key, parent);
    }
    // Numbers can be parsed by Date but shouldn't be.
    if (typ === Date && typeof val !== "number") return transformDate(val);
    return transformPrimitive(typ, val);
}

function cast<T>(val: any, typ: any): T {
    return transform(val, typ, jsonToJSProps);
}

function uncast<T>(val: T, typ: any): any {
    return transform(val, typ, jsToJSONProps);
}

function l(typ: any) {
    return { literal: typ };
}

function a(typ: any) {
    return { arrayItems: typ };
}

function u(...typs: any[]) {
    return { unionMembers: typs };
}

function o(props: any[], additional: any) {
    return { props, additional };
}

function m(additional: any) {
    return { props: [], additional };
}

function r(name: string) {
    return { ref: name };
}

const typeMap: any = {
    "NetworkDevice": o([
        { json: "total", js: "total", typ: 0 },
        { json: "next", js: "next", typ: null },
        { json: "previous", js: "previous", typ: null },
        { json: "items", js: "items", typ: a(r("Item")) },
        { json: "effectivePermissions", js: "effectivePermissions", typ: r("EffectivePermissions") },
        { json: "self", js: "self", typ: "" },
    ], false),
    "EffectivePermissions": o([
        { json: "canDelete", js: "canDelete", typ: a("") },
        { json: "canView", js: "canView", typ: a("") },
        { json: "canModify", js: "canModify", typ: a("") },
    ], false),
    "Item": o([
        { json: "id", js: "id", typ: "" },
        { json: "itemReference", js: "itemReference", typ: "" },
        { json: "name", js: "name", typ: "" },
        { json: "objectType", js: "objectType", typ: "" },
        { json: "description", js: "description", typ: "" },
        { json: "firmwareVersion", js: "firmwareVersion", typ: "" },
        { json: "objectCategory", js: "objectCategory", typ: "" },
        { json: "timeZone", js: "timeZone", typ: u(null, "") },
        { json: "objectTypeVersion", js: "objectTypeVersion", typ: "" },
        { json: "productVersion", js: "productVersion", typ: "" },
        { json: "self", js: "self", typ: "" },
        { json: "parentUrl", js: "parentUrl", typ: u(null, "") },
        { json: "networkDevicesUrl", js: "networkDevicesUrl", typ: "" },
        { json: "equipmentUrl", js: "equipmentUrl", typ: "" },
        { json: "spacesUrl", js: "spacesUrl", typ: "" },
        { json: "objectsUrl", js: "objectsUrl", typ: "" },
        { json: "trendedAttributesUrl", js: "trendedAttributesUrl", typ: "" },
        { json: "alarmsUrl", js: "alarmsUrl", typ: "" },
        { json: "ipAddress", js: "ipAddress", typ: "" },
        { json: "certificateExpirationDate", js: "certificateExpirationDate", typ: u(Date, null) },
        { json: "pairing", js: "pairing", typ: r("Pairing") },
    ], false),
    "Pairing": o([
        { json: "supported", js: "supported", typ: true },
        { json: "paired", js: "paired", typ: true },
    ], false),
};
