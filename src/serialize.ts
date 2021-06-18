import * as types from "./types";

/* SERIALIZATION */

export function serialize(eyc: types.EYC, val: any) {
    const szd = <any[]> [];

    /* First element of the serialization array is metadata. We'll replace it
     * with its serialized form at the end */
    szd.push({"modules": Object.create(null)});

    // Then the objects
    const mapping = <Record<string, number>> Object.create(null);
    ser(eyc, szd, mapping, val);

    // Serialize the metadata
    const meta = szd[0];
    szd[0] = [
        "M",
        ["modules", Object.keys(meta.modules).sort().map(id => {
            const module = eyc.modules[id];
            return [module.url, module.version];
        })]
    ];

    return "@EYCSer\n" + JSON.stringify(szd);
}

function ser(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: any) {
    let id: string;

    // First get an ID for caching
    switch (typeof val) {
        case "number":
            id = "n$" + val;
            break;

        case "string":
            id = "s$" + val;
            break;

        case "boolean":
            id = "b$" + val;
            break;

        case "object":
            /* Could be null, an object, an array, a tuple, a map, a set, or a
             * suggestion */
            if (val === eyc.nil) {
                return 0;
            } else if (val.suggestion) {
                // Suggestions are not serializable
                return 0;
            } else if (val.id) {
                // It has a unique ID
                id = "o$" + val.id;
            } else if ("length" in val) {
                // Only other array is a tuple
                id = "t$" + eyc.tupleStr(val);
            } else {
                console.error("Unexpected value!");
                return 0;
            }
            break;

        default:
            console.error("Unexpected value!");
            return 0;
    }

    // Check if it already exists
    if (mapping[id])
        return mapping[id];

    // Otherwise, add it
    const ret = mapping[id] = szd.length;

    // And serialize it
    switch (typeof val) {
        case "number":
        case "string":
        case "boolean":
            szd.push(val);
            break;

        case "object":
        {
            const val2: any = val; // TypeScript madness

            /* Could be an object, an array, a tuple, a map, a set, or a
             * suggestion */
            if (val2.types) {
                serializeObject(eyc, szd, mapping, val2);
            } else if ("length" in val2) {
                // An array or tuple
                if (val2.id)
                    serializeArray(eyc, szd, mapping, val2);
                else
                    serializeTuple(eyc, szd, mapping, val2);
            } else if (val2.keyType) {
                serializeMap(eyc, szd, mapping, val2);
            } else if (val2.valueType) {
                serializeSet(eyc, szd, mapping, val2);
            } else {
                // ???
                mapping[id] = 0;
                return 0;
            }
            break;
        }
    }

    return ret;
}

function serializeObject(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: types.EYCObject) {
    const ret: any[] = ["o"];
    szd.push(ret);

    ret.push(ser(eyc, szd, mapping, val.prefix));
    ret.push(val.types.map(x => ser(eyc, szd, mapping, x)));

    // Get all the modules and fields
    let fields: string[] = [];
    for (const klassId in val.type) {
        const klass = eyc.classes[klassId];
        szd[0].modules[klass.module.url] = true;
        fields = fields.concat(Object.keys(klass.fieldInits));
    }
    fields = fields.sort();

    // Serialize them
    for (const field of fields)
        ret.push([ser(eyc, szd, mapping, field), ser(eyc, szd, mapping, val[field])]);
}

function serializeArray(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: types.EYCArray) {
    const ret: any[] = ["a"];
    szd.push(ret);
    ret.push(ser(eyc, szd, mapping, val.prefix));
    ret.push(ser(eyc, szd, mapping, val.valueType));
    for (const v of val)
        ret.push(ser(eyc, szd, mapping, v));
}

function serializeTuple(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: types.Tuple) {
    const ret: any[] = ["t"];
    szd.push(ret);
    for (const v of val)
        ret.push(ser(eyc, szd, mapping, v));
}

function serializeMap(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: types.EYCMap) {
    const ret: any[] = ["m"];
    szd.push(ret);
    ret.push(ser(eyc, szd, mapping, val.prefix));

    if (val.keyType === "-set") {
        // Special case for sets of tuples
        ret[0] = "s";
        ret.push(ser(eyc, szd, mapping, val.valueType));

        let values: any[] = Array.from(val.values()).sort(eyc.cmp.tuple);
        for (const v of values)
            ret.push(ser(eyc, szd, mapping, v));
        return;
    }

    ret.push(ser(eyc, szd, mapping, val.keyType));
    ret.push(ser(eyc, szd, mapping, val.valueType));

    // Add each element
    const keys: any[] = Array.from(val.keys()).sort(eyc.cmp[val.keyType]);
    for (const k of keys) {
        const v = val.get(k);
        ret.push([
            ser(eyc, szd, mapping, k),
            ser(eyc, szd, mapping, v)
        ]);
    }
}

function serializeSet(eyc: types.EYC, szd: any[], mapping: Record<string, number>, val: types.EYCSet) {
    const ret: any[] = ["s"];
    szd.push(ret);
    ret.push(ser(eyc, szd, mapping, val.prefix));
    ret.push(ser(eyc, szd, mapping, val.valueType));
    const values: any[] = Array.from(val.values()).sort(eyc.cmp[val.valueType]);
    for (const v of values)
        ret.push(ser(eyc, szd, mapping, v));
}


/* DESERIALIZATION */

export function deserialize(eyc: types.EYC, szdS: string, loadModules: boolean) {
    // Check magic
    if (szdS.slice(0, 8) !== "@EYCSer\n")
        return eyc.nil;

    try {
        // Check JSON
        const szd: any[] = JSON.parse(szdS.slice(8));
        if (szd.length < 2)
            return eyc.nil;

        // Check metadata
        if (szd[0][0] !== "M")
            return eyc.nil;
        for (const meta of szd[0].slice(1)) {
            switch (meta[0]) {
                case "modules":
                    if (loadModules) {
                        // FIXME
                        return eyc.nil;
                    }
                    break;
            }
        }

        const ret: any[] = new Array(szd.length);
        const types: string[] = new Array(szd.length);

        return manifest(eyc, szd, ret, types, 1);

    } catch (ex) {
        return eyc.nil;

    }
}

// Basic type equivalence
function equiv(a: string, b: string) {
    if (a === b)
        return true;
    if (b === "null")
        return equiv(b, a);
    if (a === "null") {
        // Nullability
        if (b.slice(0, 5) === "tuple" || b === "num" || b === "string" ||
            b === "bool")
            return false;
        return true;
    }
    return false;
}

// Resolve the type of the requested element
function resolveType(eyc: types.EYC, szd: any[], types: string[], idx: number) {
    if (idx === 0)
        return "null";
    if (types[idx])
        return types[idx];

    switch (typeof szd[idx]) {
        case "number":
            return types[idx] = "num";

        case "string":
            return types[idx] = "string";

        case "boolean":
            return types[idx] = "bool";
    }

    const el = szd[idx];

    switch (el[0]) {
        case "o":
            return types[idx] = "object";

        case "a":
            return types[idx] = "array(" + szd[el[2]] + ")";

        case "t":
            return resolveTuple(eyc, szd, types, idx);

        case "m":
            return types[idx] = "map(" + szd[el[2]] + "," + szd[el[3]] + ")";

        case "s":
            return types[idx] = "set(" + szd[el[2]] + ")";

        default:
            throw new Error;
    }
}

function resolveTuple(eyc: types.EYC, szd: any[], types: string[], idx: number) {
    /* To resolve the type of a tuple, we need to get the constituent types of
     * its members */
    // FIXME: What about null in tuples?
    types[idx] = "void";
    const el = szd[idx];
    const elTypes = el.slice(1).map(el => resolveType(eyc, szd, types, el));
    return types[idx] = "tuple(" + elTypes.join(",") + ")";
}

// Manifest the requested element
function manifest(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    if (idx === 0)
        return eyc.nil;
    if (ret[idx])
        return ret[idx];

    const el = szd[idx];

    switch (typeof el) {
        case "number":
        case "string":
        case "boolean":
            return ret[idx] = el;
    }

    switch (szd[idx][0]) {
        case "o":
            return manifestObject(eyc, szd, ret, types, idx);

        case "a":
            return manifestArray(eyc, szd, ret, types, idx);

        case "t":
            return manifestTuple(eyc, szd, ret, types, idx);

        case "m":
            return manifestMap(eyc, szd, ret, types, idx);

        case "s":
            return manifestSet(eyc, szd, ret, types, idx);

        default:
            throw new Error;
    }
}

function manifestObject(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    const el = szd[idx];

    // 1: Create the object base
    const obj = ret[idx] = new eyc.Object(manifest(eyc, szd, ret, types, el[1]) + "");

    // 2: Get as much of its type as we're aware of
    for (const typeIdx of el[2]) {
        const type = szd[typeIdx] + "";
        if (eyc.classes[type])
            obj.types.push(type);
    }

    // 3: Manifest
    obj.manifestType();

    // 4: Gather field types
    const fieldTypes: Record<string, types.Type> = Object.create(null);
    for (const id in obj.type) {
        const klass = eyc.classes[id];
        Object.assign(fieldTypes, eyc.classes[id].ownFieldTypes);
    }

    // 5: Set fields
    for (const pair of el.slice(3)) {
        const fid = szd[pair[0]] + "";
        const vidx = pair[1];

        if (!(fid in fieldTypes)) {
            // Unknown field
            continue;
        }

        // Get the real and expected types
        const realType = resolveType(eyc, szd, types, vidx);
        const expectType = fieldTypes[fid].basicType();
        if (!equiv(realType, expectType))
            continue;

        // Now we know the type is correct, so assign it
        obj[fid] = manifest(eyc, szd, ret, types, vidx);
    }

    return obj;
}

function manifestArray(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    const el = szd[idx];
    const subType = szd[el[2]];
    const arr = ret[idx] = <types.EYCArray> new Array(el.length - 3);
    const prefix = arr.prefix = szd[el[1]] + "";
    arr.id = prefix + "$" + eyc.freshId();
    arr.valueType = subType;

    // Manifest each value in the array
    for (let i = 0; i < arr.length; i++) {
        const vidx = el[i+3];
        if (!equiv(resolveType(eyc, szd, types, vidx), subType))
            throw new Error;
        arr[i] = manifest(eyc, szd, ret, types, vidx);
    }

    return arr;
}

function manifestTuple(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    const el = szd[idx];
    const tup = ret[idx] = new Array(el.length - 1);

    for (let i = 0; i < tup.length; i++)
        tup[i] = manifest(eyc, szd, ret, types, el[i+1]);
    return tup;
}

function manifestMap(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    const el = szd[idx];
    const prefix = manifest(eyc, szd, ret, types, el[1]) + "";
    const keyType = manifest(eyc, szd, ret, types, el[2]) + "";
    const valueType = manifest(eyc, szd, ret, types, el[3]) + "";
    const map = ret[idx] = new eyc.Map(prefix, keyType, valueType);

    for (let i = 4; i < el.length; i++) {
        const kv = el[i];
        const kidx = kv[0];
        const vidx = kv[1];
        if (!equiv(resolveType(eyc, szd, types, kidx), keyType))
            throw new Error;
        if (!equiv(resolveType(eyc, szd, types, vidx), valueType))
            throw new Error;
        map.set(manifest(eyc, szd, ret, types, kidx), manifest(eyc, szd, ret, types, vidx));
    }

    return map;
}

function manifestSet(eyc: types.EYC, szd: any[], ret: any[], types: string[], idx: number) {
    const el = szd[idx];
    const prefix = szd[el[1]] + "";
    const valueType = szd[el[2]] + "";

    // Special case for sets of tuples
    if (valueType.slice(0, 5) === "tuple") {
        const map = ret[idx] = new eyc.Map(prefix, "-set", valueType);
        for (let i = 3; i < el.length; i++) {
            const vidx = el[i];
            if (!equiv(resolveType(eyc, szd, types, vidx), valueType))
                throw new Error;
            const v = manifest(eyc, szd, ret, types, vidx);
            map.set(eyc.tupleStr(v), v);
        }
        return map;
    }

    const set = ret[idx] = new eyc.Set(prefix, valueType);

    for (let i = 3; i < el.length; i++) {
        const vidx = el[i];
        if (!equiv(resolveType(eyc, szd, types, vidx), valueType))
            throw new Error;
        set.add(manifest(eyc, szd, ret, types, vidx));
    }

    return set;
}
