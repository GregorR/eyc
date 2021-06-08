import "url-polyfill";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const charenc = require("charenc");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypt = require("crypt");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sha1 = require("sha1");

import * as compiler from "./compiler";
import * as coreJSON from "./core.json";
import * as lexNum from "./lexnum";
import * as types from "./types";

function idCmp(left: types.EYCHeapThing, right: types.EYCHeapThing) {
    if (left.id < right.id)
        return -1;
    else if (left.id > right.id)
        return 1;
    else
        return 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function valCmp(left: any, right: any) {
    if (left < right)
        return -1;
    else if (left > right)
        return 1;
    else
        return 0;
}

// Comparison for numbers that handles the special cases of NaN and -0
function numCmp(left: number, right: number): number {
    if (left < right)
        return -1;
    else if (left > right)
        return 1;
    else if (left !== left) {
        if (right !== right)
            return 0;
        else
            return 1;
    } else if (right !== right)
        return -1;
    else if (left === 0 && right === 0)
        return numCmp(1/left, 1/right);
    else
        return 0;
}

// Convert a tuple to a string
function tupleStr(tuple: types.Tuple): string {
    if (tuple.tupleStr)
        return tuple.tupleStr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tuple.tupleStr = tuple.map((el: any) => {
        switch (typeof el) {
            case "number":
                return lexNum.numToLexString(el)

            case "string":
                return crypt.bytesToHex(charenc.utf8.stringToBytes(el));

            case "boolean":
                return ""+el;

            default:
                if (el.id)
                    return el.id;
                else if (el.length)
                    return tupleStr(el);
                else
                    return "?";
        }
    }).join("$");
}

// Comparing two tuples is just value-comparing their strings
function tupleCmp(left: types.Tuple, right: types.Tuple) {
    return valCmp(tupleStr(left), tupleStr(right));
}

export async function eyc(
        opts: {noImportCore?: boolean} = {}): Promise<types.EYC> {
    const eyc: types.EYC = {
    compiler: compiler,
    counter: [0],
    ts: 0,
    core: coreJSON,

    // Compiler wrapper
    importModule: function(url, opts: types.ImportModuleOpts = {}) {
        return this.compiler.importModule(this, url, opts);
    },

    // Get a fresh ID
    freshId: function() {
        // Increment the counter
        const counter = this.counter;
        counter[0] = ~~(counter[0]+1);
        if (counter[0] < 0) {
            counter[0] = 0;
            let i;
            for (i = 1; i < counter.length; i++) {
                const v = ~~(counter[i]+1);
                if (v > 0) {
                    counter[i] = v;
                    break;
                } else {
                    counter[i] = 0;
                }
            }
            if (i === counter.length)
                counter.push(1);
        }

        // Then make the ID
        let id = "$" + ("".padStart(counter.length-1, "z")) + "0";
        for (let i = counter.length - 1; i >= 0; i--)
            id += counter[i].toString(36).padStart(6, "0");
        return id;
    },

    // Encode a URL into a prefix for a JS variable name
    urlEncode: function(x) {
        return crypt.bytesToBase64(charenc.utf8.stringToBytes(x)).replace(/\+/g, "\u00b5").replace(/\//g, "\u00df").replace(/=/g, "_");
    },

    // Modules in the runtime
    modules: Object.create(null),
    Module: class implements types.Module {
        type: string;
        isTypeLike: boolean;
        isModule: boolean;
        url: string;
        prefix: string;
        ctx: types.ModuleCtx;
        parsed: types.ModuleNode;
        main: types.EYCElement;
        classes: Record<string, types.EYCClass>;
        resources: Record<string, types.Resource>;
        spritesheets: Record<string, types.Spritesheet>;
        soundsets: Record<string, types.Soundset>;
        fabrics: Record<string, types.Fabric>;

        constructor(url: string, ctx: types.ModuleCtx) {
            this.type = "module";
            this.isTypeLike = true;
            this.isModule = true;
            this.url = url;
            this.prefix = "$" + eyc.urlEncode(url);
            this.ctx = ctx;
            this.parsed = null;
            this.main = null;
            this.classes = Object.create(null);
            this.resources = Object.create(null);
            this.spritesheets = Object.create(null);
            this.soundsets = Object.create(null);
            this.fabrics = Object.create(null);
            eyc.modules[url] = this;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }
    },

    // General "resources" in the runtime, which may be spritesheets or sounds
    resources: Object.create(null),

    // Sprites in the runtime (only part of Spritesheets)
    Sprite: class implements types.Sprite {
        type: string;
        isSprite: boolean;
        name: string;
        sheet: types.Spritesheet;
        x: number;
        y: number;
        w: number;
        h: number;
        scale: number;
        id: string;
        prefix: string;

        constructor(sheet: types.Spritesheet, name: string, x: number, y: number, w: number, h: number, scale: number) {
            this.type = "sprite";
            this.isSprite = true;
            this.name = name;
            this.sheet = sheet;
            sheet.add(this);
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.scale = scale;
            this.id = sheet.prefix + "$" + name;
            this.prefix = sheet.prefix;
        }
    },

    // Spritesheets in the runtime
    spritesheets: Object.create(null),
    Spritesheet: class implements types.Spritesheet {
        type: string;
        isTypeLike: boolean;
        isSpritesheet: boolean;
        name: string;
        url: string;
        prefix: string;
        sprites: Record<string, types.Sprite>;

        constructor(module: types.Module, name: string, url: string) {
            this.type = "sprites";
            this.isTypeLike = true;
            this.isSpritesheet = true;
            this.name = name;
            this.url = url;
            const prefix = this.prefix = module.prefix + "$" + name;
            this.sprites = Object.create(null);
            eyc.spritesheets[prefix] = this;
            eyc.resources[prefix] = this;
            module.spritesheets[name] = this;
            module.resources[name] = this;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }

        // Add the given sprite
        add(sprite: types.Sprite) {
            this.sprites[sprite.name] = sprite;
        }

        // Get the sprite with the given name
        get(nm: string) {
            if (nm in this.sprites)
                return this.sprites[nm];
            return null;
        }
    },

    // Sounds in the runtime
    Sound: class implements types.Sound {
        type: string;
        isSound: boolean;
        name: string;
        set: types.Soundset;
        start: number;
        length: number;
        id: string;
        prefix: string;

        constructor(set: types.Soundset, name: string, start: number, length: number) {
            this.type = "sound";
            this.isSound = true;
            this.name = name;
            this.set = set;
            set.add(this);
            this.start = start;
            this.length = length;
            this.id = set.prefix = "$" + name;
            this.prefix = set.prefix;
        }
    },

    // Sound sets in the runtime
    soundsets: Object.create(null),
    Soundset: class implements types.Soundset {
        type: string;
        isTypeLike: boolean;
        isSoundset: boolean;
        name: string;
        url: string;
        prefix: string;
        sounds: Record<string, types.Sound>;

        constructor(module: types.Module, name: string, url: string) {
            this.type = "soundset";
            this.isTypeLike = true;
            this.isSoundset = true;
            this.name = name;
            this.url = url;
            const prefix = this.prefix = module.prefix + "$" + name;
            this.sounds = Object.create(null);
            eyc.soundsets[prefix] = this;
            eyc.resources[prefix] = this;
            module.soundsets[name] = this;
            module.resources[name] = this;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }

        // Add the given sound
        add(sound: types.Sound) {
            this.sounds[sound.name] = sound;
        }

        // Get the sound with the given name
        get(nm: string) {
            if (nm in this.sounds)
                return this.sounds[nm];
            return null;
        }
    },

    // Fabrics
    fabricVals: Object.create(null),
    fabrics: Object.create(null),
    Fabric: class implements types.Fabric {
        type: string;
        isTypeLike: boolean;
        isFabric: boolean;
        name: string;
        url: string;
        text: string;
        code: string;
        id: string;

        constructor(module: types.Module, name: string, url: string, text: string) {
            this.name = name;
            this.url = url;
            this.text = text;
            this.code = null;
            const id = this.id = module.prefix + "$" + name;
            eyc.fabrics[id] = this;
            eyc.resources[id] = this;
            module.fabrics[name] = this;
            module.resources[name] = this;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }

        compile() {
            if (this.code) return this.code;

            let text = this.text;

            // Remove any terminal newline
            const last = text.length - 1;
            if (text[last] === "\n")
                text = text.slice(0, last);

            // Remove any \r's entirely
            text = text.replace(/\r/g, "");

            // Split it by lines
            const lines = <types.EYCArray & string[]> text.split("\n");
            lines.id = this.id;

            // Make sure they're all the same length
            let max = 0;
            for (const line of lines) {
                if (line.length > max)
                    max = line.length;
            }
            for (let li = 0; li < lines.length; li++)
                lines[li] = lines[li].padEnd(max, " ");

            // Put it in the fabrics map
            eyc.fabricVals[this.id] = lines;

            // And create the code
            return this.code = "(eyc.fabricVals[" + JSON.stringify(this.id) + "])";
        }
    },

    // Classes in the runtime
    classes: Object.create(null),
    Class: class implements types.EYCClass {
        type: string;
        isTypeLike: boolean;
        isClass: boolean;
        name: string;
        prefix: string;
        parents: types.EYCClass[];
        methodTypes: Record<string, types.Method>;
        fieldTypes: Record<string, types.Type>;
        methods: Record<string, types.CompiledFunction>;
        fieldNames: Record<string, string>;
        fieldInits: Record<string, types.CompiledFunction>;

        constructor(module: types.Module, name: string) {
            this.type = "class";
            this.isTypeLike = true;
            this.isClass = true;
            this.name = name;
            this.prefix = module.prefix + "$" + name;
            this.parents = [];

            // Types of all methods and fields
            this.methodTypes = Object.create(null);
            this.fieldTypes = Object.create(null);

            // Own methods and fields
            this.methods = Object.create(null);
            this.fieldNames = Object.create(null);
            this.fieldInits = Object.create(null);

            eyc.classes[this.prefix] = this;
            module.classes[name] = this;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }

        subtypeOf(other: types.EYCClass) {
            if (this === other)
                return true;
            for (const p of this.parents) {
                if (p.subtypeOf(other))
                    return true;
            }
            return false;
        }
    },

    // Types in the runtime
    ObjectType: class implements types.EYCObjectType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isObject: boolean;
        isNullable: boolean;
        instanceOf: types.EYCClass;

        constructor(of: types.EYCClass) {
            this.type = "object";
            this.isTypeLike = true;
            this.isType = true;
            this.isObject = true;
            this.isNullable = true;
            this.instanceOf = of;
        }

        equals(other: types.TypeLike, opts: types.TypeEqOpts = {}) {
            if (!other.isObject)
                return false;
            if (opts.castable)
                return true;
            const otherObj = <types.EYCObjectType> other;
            if (opts.subtype)
                return this.instanceOf.subtypeOf(otherObj.instanceOf);
            return this.instanceOf === otherObj.instanceOf;
        }

        default() {
            return "eyc.nil";
        }
    },
    ArrayType: class implements types.ArrayType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isArray: boolean;
        isNullable: boolean;
        valueType: types.Type;

        constructor(of: types.Type) {
            this.type = "array";
            this.isTypeLike = true;
            this.isType = true;
            this.isArray = true;
            this.isNullable = true;
            this.valueType = of;
        }

        equals(other: types.TypeLike, opts: types.TypeEqOpts = {}) {
            return other.isArray &&
                   this.valueType.equals((<types.ArrayType> other).valueType, opts);
        }

        default(opts?: types.DefaultValueOpts) {
            if (opts && opts.build)
                return "eyc.newArray(self.prefix)";
            else
                return "eyc.nil";
        }
    },
    TupleType: class implements types.TupleType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isTuple: boolean;
        isNullable: boolean;
        valueTypes: types.Type[];

        constructor(of: types.Type[]) {
            this.type = "tuple";
            this.isTypeLike = true;
            this.isType = true;
            this.isTuple = true;
            this.isNullable = false;
            this.valueTypes = of;
        }

        equals(other: types.TypeLike, opts: types.TypeEqOpts = {}) {
            if (!other.isTuple) return false;
            const otherTuple = <types.TupleType> other;
            if (this.valueTypes.length !== otherTuple.valueTypes.length)
                return false;
            for (let i = 0; i < this.valueTypes.length; i++) {
                if (!this.valueTypes[i].equals(otherTuple.valueTypes[i], opts))
                    return false;
            }
            return true;
        }

        default(opts?: types.DefaultValueOpts) {
            return "[" + this.valueTypes.map(x => x.default(opts)).join(",") + "]";
        }
    },
    MapType: class implements types.MapType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isMap: boolean;
        isNullable: boolean;
        keyType: types.Type;
        valueType: types.Type;

        constructor(keyType: types.Type, valueType: types.Type) {
            this.type = "map";
            this.isTypeLike = true;
            this.isType = true;
            this.isMap = true;
            this.isNullable = true;
            this.keyType = keyType;
            this.valueType = valueType;
        }

        equals(other: types.TypeLike, opts: types.TypeEqOpts = {}) {
            if (!other.isMap) return false;
            const otherMap = <types.MapType> other;
            return this.keyType.equals(otherMap.keyType, opts) &&
                   this.valueType.equals(otherMap.valueType, opts);
        }

        default(opts?: types.DefaultValueOpts) {
            if (opts && opts.build)
                return "new eyc.Map(self.prefix)";
            else
                return "eyc.nil";
        }
    },
    SetType: class implements types.SetType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isSet: boolean;
        isNullable: boolean;
        valueType: types.Type;

        constructor(of: types.Type) {
            this.type = "set";
            this.isTypeLike = true;
            this.isType = true;
            this.isSet = true;
            this.isNullable = true;
            this.valueType = of;
        }

        equals(other: types.TypeLike, opts: types.TypeEqOpts = {}) {
            return other.isSet &&
                   this.valueType.equals((<types.SetType> other).valueType, opts);
        }

        default(opts?: types.DefaultValueOpts) {
            if (opts && opts.build) {
                if (this.valueType.isTuple)
                    return "new eyc.Map(self.prefix)";
                else
                    return "new eyc.Set(self.prefix)";
            } else {
                return "eyc.nil";
            }
        }
    },
    PrimitiveType: class implements types.PrimitiveType {
        type: string;
        isTypeLike: boolean;
        isType: boolean;
        isPrimitive: boolean;
        isNullable: boolean;
        defaultVal: string;

        constructor(of: string, defaultVal: string) {
            this.type = of;
            this.isTypeLike = true;
            this.isType = true;
            this.isPrimitive = true;
            this.isNullable = false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (<any> this)["is" + of[0].toUpperCase() + of.slice(1)] = true;
            this.defaultVal = defaultVal;
        }

        equals(other: types.TypeLike): boolean {
            return (this === other);
        }

        default() {
            return this.defaultVal;
        }
    },

    // Singletons, filled in later
    numType: null,
    stringType: null,
    boolType: null,
    suggestionType: null,
    voidType: null,
    nullType: null,

    // Methods aren't really types in and of themselves, but are type-adjacent
    Method: class implements types.Method {
        type: string;
        isTypeLike: boolean;
        isMethod: boolean;
        id: string;
        mutating: boolean;
        mutatingThis: boolean;
        retType: types.Type;
        paramTypes: types.Type[];

        constructor(klass: types.EYCClass, name: string, mutating: boolean,
                mutatingThis: boolean, retType: types.Type,
                paramTypes: types.Type[]) {
            this.type = "method";
            this.isTypeLike = true;
            this.isMethod = true;
            this.id = klass.prefix + "$" + name;
            this.mutating = mutating;
            this.mutatingThis = mutatingThis;
            this.retType = retType;
            this.paramTypes = paramTypes;
        }

        equals(other: types.TypeLike) {
            if (!other.isMethod) return false;
            const otherMethod = <types.Method> other;
            if (this.mutating !== otherMethod.mutating || this.mutatingThis !== otherMethod.mutatingThis)
                return false;
            if (!this.retType.equals(otherMethod.retType))
                return false;
            if (this.paramTypes.length !== otherMethod.paramTypes.length)
                return false;
            for (let i = 0; i < this.paramTypes.length; i++) {
                if (!this.paramTypes[i].equals(otherMethod.paramTypes[i]))
                    return false;
            }
            return true;
        }
    },

    // The all-purpose null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nil: <any> {
        id: "null",

        // Object
        prefix: "null",
        type: {},
        types: [],
        methods: {},
        rand: function() { return 0; },
        extend: function() { return this; },
        retract: function() { return this; },

        // Array/suggestion
        length: 0,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        push: function() {},

        // Map/Set
        size: 0,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        delete: function() {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        get: function() {},
        has: function() { return false; },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        set: function() {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        add: function() {},
        keys: function() { return <string[]> []; },
        values: function() { return <unknown[]> []; },

        // Suggestion
        suggestions: Object.create(null)
    },

    // Objects in the actual runtime
    Object: class implements types.EYCObject {
        id: string;
        prefix: string;
        type: Record<string, boolean>;
        types: string[];
        methods: Record<string, types.CompiledFunction>;
        randts: number;
        randseed: string;

        constructor(prefix: string) {
            prefix = prefix || "";
            this.id = prefix + "$" + eyc.freshId();
            this.prefix = prefix;
            this.type = Object.create(null);
            this.types = [];
            this.methods = {};
            this.randts = -1;
            this.randseed = "";
        }

        rand() {
            if (this.randts !== eyc.ts) {
                this.randts = eyc.ts;
                this.randseed = this.id;
            }
            const next = sha1(this.randseed, {asBytes: true});
            const nv = (
                next[0] * 0x10000000000 +
                next[1] * 0x100000000 +
                next[2] * 0x1000000 +
                (next[3] << 16) +
                (next[4] << 8) +
                next[5]) /
                0x1000000000000;
            this.randseed = crypt.bytesToHex(next);
            return nv;
        }

        extend(type: string) {
            if (this.types.indexOf(type) >= 0) return this;
            this.types.push(type);
            if (this.type[type]) return this;
            this.manifestType();
            return this;
        }

        retract(type: string) {
            const idx = this.types.indexOf(type);
            if (idx < 0) return this;
            this.types.splice(idx, 1);
            this.manifestType();
            return this;
        }

        manifestType() {
            // Build a type hierarchy
            const manifest = <string[]> [];
            const oldType = this.type;
            this.type = Object.create(null);
            for (const t of this.types)
                eyc.manifestType(t, manifest, this.type);

            // Then make the methods
            const ms = manifest.join(",");
            if (ms in eyc.methodTables) {
                this.methods = eyc.methodTables[ms];

            } else {
                let mo = null;
                for (const t of manifest) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const step = <any> Object.create(mo);
                    step.proto = mo;
                    mo = step;
                    Object.assign(mo, eyc.classes[t].methods);
                }
                this.methods = eyc.methodTables[ms] = mo || Object.create(null);

            }

            // Remove any unjustified fields
            for (const t in oldType) {
                if (!this.type[t]) {
                    const fields = eyc.classes[t].fieldInits;
                    for (const f in fields) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        delete (<any> this)[f];
                    }
                }
            }

            // And add new fields
            for (const t of manifest) {
                const fields = eyc.classes[t].fieldInits;
                for (const f in fields) {
                    if (!(f in this)) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (<any> this)[f] = fields[f](eyc, this, this);
                    }
                }
            }
        }
    },

    // Helper function to manifest a type tree
    manifestType: function(type, intoArr, intoMap) {
        if (intoMap[type]) return;
        const typeO = this.classes[type];
        for (const ptype of typeO.parents)
            this.manifestType(ptype.prefix, intoArr, intoMap);
        intoArr.push(type);
        intoMap[type] = true;
    },

    // Cache for manifested method tables
    methodTables: Object.create(null),

    // Maps with an ID
    Map: class extends Map implements types.EYCMap {
        id: string;

        constructor(prefix: string) {
            super();
            this.id = (prefix||"map") + "$" + eyc.freshId();
        }
    },

    // Sets with an ID
    Set: class extends Set implements types.EYCSet {
        id: string;

        constructor(prefix: string) {
            super();
            this.id = (prefix||"set") + "$" + eyc.freshId();
        }
    },

    // Suggestions
    Suggestion: function(prefix: string, suggestions: types.SuggestionStep[], append?: types.SuggestionStep[]) {
        let ret: types.Suggestion;
        if (append)
            ret = <types.Suggestion> suggestions.concat(append);
        else
            ret = <types.Suggestion> suggestions.slice(0);
        ret.id = (prefix||"suggestion") + "$" + eyc.freshId();
        return ret;
    },

    /* Enforce a suggestion, possibly limiting it to only change certain
     * objects */
    enforce: function(ss, targets) {
        if (ss.length === 0) return;

        // 1: Expansions
        for (const s of ss) {
            if (s.action === "e") {
                const se = <types.SuggestionStepExtendRetract> s;
                // FIXME: Check targets
                se.target.extend(se.type);
            }
        }

        // 2: Methods
        for (const s of ss) {
            if (s.action === "m") {
                throw new Error;
            }
        }

        // 3: Retractions
        for (const s of ss) {
            if (s.action === "r") {
                const sr = <types.SuggestionStepExtendRetract> s;
                // FIXME: Check targets
                sr.target.retract(sr.type);
            }
        }
    },

    // Convert a tuple to a string
    tupleStr,

    // Comparitors for sorting
    cmp: {
        object: idCmp,
        array: idCmp,
        tuple: tupleCmp,
        map: idCmp,
        set: idCmp,
        num: numCmp,
        string: valCmp,
        bool: valCmp
    },

    // User provided
    ext: {
        fetch: null
    }

    };

    eyc.numType = new eyc.PrimitiveType("num", "0");
    eyc.stringType = new eyc.PrimitiveType("string", '""');
    eyc.boolType = new eyc.PrimitiveType("bool", "false");
    eyc.suggestionType = new eyc.PrimitiveType("suggestion", "eyc.nil");
    eyc.suggestionType.isNullable = true;
    eyc.voidType = new eyc.PrimitiveType("void", "void 0");
    eyc.nullType = new eyc.PrimitiveType("null", "eyc.nil");

    if (!opts.noImportCore)
        await eyc.importModule("core", {text: eyc.core, ctx: {privileged: true}});

    return eyc;
}