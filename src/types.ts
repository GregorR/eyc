// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2020-2022 Gregor Richards
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */

export interface EYCElement {
    type: string;
    isModule?: boolean;
    isClass?: boolean;
    isSpritesheet?: boolean;
    isSpriteblock?: boolean;
    isType?: boolean;
    isObject?: boolean;
    isArray?: boolean;
    isTuple?: boolean;
    isMap?: boolean;
    isSet?: boolean;
    isPrimitive?: boolean;
    isNum?: boolean;
    isString?: boolean;
    isBool?: boolean;
    isSuggestion?: boolean;
    isVoid?: boolean;
    isNull?: boolean;
    isMethod?: boolean;
}

export interface EYC {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiler: any; // Actually the compiler module

    counter: number[]; // For fresh ID's
    ts: number;
    core: string;

    importModule: (a1: string, a2?: ImportModuleOpts) => Promise<Module>;
    freshId: () => string;
    urlAbsolute: (rel: string, path: string) => string;
    urlEncode: (a1: string) => string;

    modules: Record<string, Module>;
    Module: {
        new (
            url: string, version: string, absoluteUrl: string, ctx: ModuleCtx
        ): Module
    };

    resources: Record<string, Resource>;

    Sprite: {
        new (sheet: Spritesheet, name: string, props: SpriteProperties): Sprite
    };

    Spriteblock: {new (): Spriteblock};
    spritesheets: Record<string, Spritesheet>;
    Spritesheet: {new (module: Module, name: string, url: string): Spritesheet};

    Sound: {
        new (set: Soundset, name: string, start: number, length: number): Sound
    };

    soundsets: Record<string, Soundset>;
    Soundset: {new (module: Module, name: string, url: string): Soundset};

    fabrics: Record<string, Fabric>;
    fabricVals: Record<string, EYCArray>;
    Fabric: {
        new (
            module: Module, isGarment: boolean, name: string, url: string,
            text: string
        ): Fabric
    };

    classes: Record<string, EYCClass>;
    Class: {new (module: Module, name: string): EYCClass};

    // Types
    ObjectType: {new (of: EYCClass): EYCObjectType};
    ArrayType: {new (of: Type): ArrayType};
    TupleType: {new (of: Type[]): TupleType};
    MapType: {new (keyType: Type, valueType: Type): MapType};
    SetType: {new (valueType: Type): SetType};
    NullType: {new (): NullType};
    PrimitiveType: {new (of: string, defaultVal: string): PrimitiveType};

    // Singletons for singleton types
    numType: PrimitiveType;
    stringType: PrimitiveType;
    boolType: PrimitiveType;
    suggestionType: PrimitiveType;
    voidType: PrimitiveType;
    nullType: NullType;

    Method: {
        new (klass: EYCClass, name: string, mutating: boolean,
             mutatingThis: boolean, retType: Type, paramTypes: Type[]): Method
    };

    // The one and true nil
    nil: EYCObject & EYCArray & EYCMap & EYCSet & Suggestion;

    // The actual Object class for this EYC instance, and utility functions
    Object: {new (prefix: string): EYCObject};
    manifestType(
        type: string, intoArr: string[], intoMap: Record<string, boolean>
    ): void;
    methodTables: Record<string, Record<string, CompiledFunction>>;

    // Other heap types
    Map: {
        new (
            prefix: string, keyType: string, valueType: string,
            copy?: Iterable<[unknown, unknown]>
        ): EYCMap
    };
    Set: {
        new (
            prefix: string, valueType: string, copy?: Iterable<unknown>
        ): EYCSet
    };
    Suggestion(
        prefix: string, suggestions: SuggestionStep[], append?: SuggestionStep[]
    ): Suggestion;

    // Enforce suggestions
    enforce(s: Suggestion, targets: EYCObject[]): void;

    // Convert a tuple to a string
    tupleStr(tuple: Tuple): string;

    // Serialization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serialize(val: any): string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deserialize(val: string, loadModules: boolean): any;

    // Comparators
    cmp: {
        object: (l: EYCObject, r: EYCObject) => number;
        array: (l: EYCArray, r: EYCArray) => number;
        tuple: (l: Tuple, r: Tuple) => number;
        map: (l: EYCMap, r: EYCMap) => number;
        set: (l: EYCSet, r: EYCSet) => number;
        num: (l: number, r: number) => number;
        string: (l: string, r: string) => number;
        bool: (l: boolean, r: boolean) => number;
    };

    // Frontend interaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newStage(w: number, h: number, ex: string): string;
    loadSpritesheet(spritesheet: Spritesheet): string;
    addSprite(
        stageId: string, spritesheet: string, sprite: string, x: number,
        y: number, ex: string
    ): string;

    // External features which must be provided by a user of EYC
    ext: EYCExt;
}

// External features
export interface EYCExt {
    // Fetch a remote resource, presumably via the web
    fetch: (resource: string) => Promise<string>;

    // Create a new frontend stage
    newStage: (w: number, h: number, ex: unknown) => Promise<string>;

    // Load in this spritesheet
    loadSpritesheet: (desc: unknown) => Promise<string>;

    // Add this sprite from a loaded spritesheet onto this stage
    addSprite: (
        stageId: string, spritesheet: string, sprite: string, x: number,
        y: number, ex: any
    ) => Promise<string>;
}

// A compiled EYC function
export type CompiledFunction =
    (eyc: EYC, self: EYCObject, caller: EYCObject) => unknown;

export interface ImportModuleOpts {
    text?: string;
    ctx?: ModuleCtx;
}

export interface ModuleCtx {
    privileged: boolean;
}

export interface Module extends TypeLike {
    isModule: boolean;

    // The URL used to identify this module
    url: string;

    // The version loaded
    version: string;

    // The actual full URL fetched
    absoluteUrl: string;

    prefix: string;
    ctx: ModuleCtx;
    parsed: ModuleNode;
    main: ClassNode;
    classes: Record<string, EYCClass>;
    resources: Record<string, Resource>;
    spritesheets: Record<string, Spritesheet>;
    soundsets: Record<string, Soundset>;
    fabrics: Record<string, Fabric>;

    eycElement_?: boolean; // Just to nominalize the type
}

export type Resource = TypeLike;

export interface Sprite extends EYCElement {
    isSprite: boolean;
    name: string;
    sheet: Spritesheet;
    props: SpriteProperties;
    id: string;
}

export interface SpriteProperties {
    x: number;
    y: number;
    w: number;
    h: number;
    scale: number;
    frames: number;
    speed: number;
}

// Spritesheets have namespaces called "blocks"
export interface Spriteblock extends Resource {
    isSpriteblock: boolean;
    members: Record<string, Sprite | Spriteblock>;
}

export interface Spritesheet extends Resource {
    isSpritesheet: boolean;
    name: string;
    url: string;
    prefix: string;
    sprites: Spriteblock;
}

export interface Sound extends EYCElement {
    isSound: boolean;
    name: string;
    set: Soundset;
    start: number;
    length: number;
    id: string;
    prefix: string;
}

export interface Soundset extends Resource {
    isSoundset: boolean;
    name: string;
    url: string;
    prefix: string;
    sounds: Record<string, Sound>;

    add(sound: Sound): void;
}

export interface Fabric extends Resource {
    isFabric: boolean;
    isGarment: boolean;
    name: string;
    url: string;
    text: string;

    compile(): string;
}

export interface TypeEqOpts {
    // Only ask if a cast is allowed
    castable?: boolean;

    // Only ask if this is a subtype
    subtype?: boolean;
}

/* Anything that an expression may refer to, even if it doesn't really have a
 * value at runtime (such as a class or a method) */
export interface TypeLike extends EYCElement {
    isTypeLike: boolean;
    equals(other: TypeLike, opts?: TypeEqOpts): boolean;
}

export interface EYCClass extends TypeLike {
    isClass: boolean;
    module: Module;
    name: string;
    prefix: string;
    parents: EYCClass[];

    // All methods/fields
    methodTypes: Record<string, Method>;
    fieldTypes: Record<string, Type>;

    // Own methods/fields
    methods: Record<string, CompiledFunction>;
    fieldNames: Record<string, string>;
    fieldInits: Record<string, CompiledFunction>;
    ownFieldTypes: Record<string, Type>;

    subtypeOf(other: EYCClass): boolean;
}

export interface Method extends TypeLike {
    isMethod: boolean;
    id: string;
    mutating: boolean;
    mutatingThis: boolean;
    retType: Type;
    paramTypes: Type[];
}

export interface DefaultValueOpts {
    // Create a value instead of using null?
    build?: boolean;
}

export interface Type extends TypeLike {
    isType: boolean;
    isNullable: boolean;
    default(opts?: DefaultValueOpts): string;
    basicType(): string;
}

export interface EYCObjectType extends Type {
    isObject: boolean;
    instanceOf: EYCClass;
}

export interface ArrayType extends Type {
    isArray: boolean;
    valueType: Type;
}

export interface TupleType extends Type {
    isTuple: boolean;
    valueTypes: Type[];
}

export interface MapType extends Type {
    isMap: boolean;
    keyType: Type;
    valueType: Type;
}

export interface SetType extends Type {
    isSet: boolean;
    valueType: Type;
}

export interface NullType extends Type {
    isNull: boolean;
}

export interface PrimitiveType extends Type {
    isPrimitive: boolean;
    defaultVal: string;
}


/* Things that go on the heap (are objects in JS). Note that tuples are also
 * actually objects, but are immutable and don't have ID's, so don't fit into
 * this category */
export interface EYCHeapThing {
    prefix: string;
    id: string;
}

export interface EYCObject extends EYCHeapThing {
    type: Record<string, boolean>;
    types: string[];
    // The "methods" object is manifested by the runtime
    methods: Record<string, CompiledFunction>;

    rand(): number;
    extend(type: string): EYCObject;
    retract(type: string): EYCObject;
    manifestType(): void;

    // Objects also have fields, mangled so they can't possibly interfere
}

export interface EYCArray extends EYCHeapThing, Array<unknown> {
    valueType: string;
}

export interface EYCMap extends EYCHeapThing, Map<unknown, unknown> {
    keyType: string;
    valueType: string;
}

export interface EYCSet extends EYCHeapThing, Set<unknown> {
    valueType: string;
}

export interface Suggestion extends EYCHeapThing, Array<SuggestionStep> {
    suggestion: boolean;
}

export interface SuggestionStep {
    action: string; // e for extend, r for retract, m for method call
    target: EYCObject;
}

export interface SuggestionStepExtendRetract extends SuggestionStep {
    type: string;
}

export interface SuggestionStepMethod extends SuggestionStep {
    source: EYCObject;
    method: string;
    args: unknown[];
}

export type Tuple = unknown[] & {tupleStr?: string};

// Parse tree
export interface Tree {
    type: string;
    location: {
        start: {
            line: number;
            column: number;
        },
        end: {
            line: number;
            column: number;
        }
    };
    parent: Tree;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: any;

    // Defined while compiling
    module?: Module;

    // Type associated with this node
    ctype?: TypeLike;
}

// Children of parse trees defined while compiling
export interface ModuleNode extends Tree {
    // What this module exports
    exports: Record<string, Tree>;

    // Symbols defined by this module
    symbols: Record<string, Tree>;

    // And their types
    symbolTypes: Record<string, TypeLike>;
}

export interface ClassNode extends Tree {
    // The EYC class this defines
    klass: EYCClass;

    // Instance type of this class
    itype: EYCObjectType;
}

export interface MethodNode extends Tree {
    // A method's parent is always a class
    parent: ClassNode;

    // The method signature
    signature: Method;
}

export interface SpritesheetNode extends Tree {
    // The spritesheet this defines
    spritesheet: Spritesheet;
}

export interface SoundsetNode extends Tree {
    // The soundset this defines
    soundset: Soundset;
}

export interface FabricNode extends Tree {
    // The fabric this defines
    fabric: Fabric;
}
