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

// Static elements of EYC
export interface EYCElement {
    type: EYCElementType;
    isModule?: boolean;
    isClass?: boolean;
    isSpritesheet?: boolean;
    isSpriteblock?: boolean;
    isSprite?: boolean;
    isAnimatedSprite?: boolean;
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

// Things that exist at runtime but are not values
export type EYCElementTypeVirt =
    "module" |
    "spritesheet" |
    "spriteblock" |
    "sprite" |
    "animated-sprite" |
    "soundset" |
    "sound" |
    "garment" |
    "fabric" |
    "class" |
    "method";

// Types of runtime values
export type EYCElementTypeType =
    "object" |
    "array" |
    "tuple" |
    "map" |
    "set" |
    "suggestion" |
    "num" |
    "string" |
    "bool" |
    "void" |
    "null";

export type EYCElementType =
    EYCElementTypeVirt | EYCElementTypeType;

export interface EYC {
    // The main method: run this EYC program
    go: (url: string) => void;

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

    AnimatedSprite: {
        new (
            sheet: Spritesheet, name: string, sprites: Sprite[]
        ): AnimatedSprite
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
    PrimitiveType: {new (of: EYCElementTypeType, defaultVal: string): PrimitiveType};

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
    emptyArray: (prefix: string, valueType: string) => EYCArray;
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
    frame(): void;
    loadSpritesheet(spritesheet: Spritesheet): string;
    addSprite(
        stageId: string, spritesheet: string, sprite: string, x: number,
        y: number, ex: string
    ): string;
    updateSprite(
        stageId: string, id: string, spritesheet: string, sprite: string
    ): void;
    moveSprite(
        stageId: string, sprite: string, x: number, y: number
    ): void;
    mirrorSprite(
        stageId: string, sprite: string, mirror: boolean, vertical: boolean
    ): void;

    // External features which must be provided by a user of EYC
    ext: EYCExt;
}

// External features
export interface EYCExt {
    // Fetch a remote resource, presumably via the web
    fetch: (resource: string) => Promise<string>;

    // Create a new frontend stage
    newStage: (w: number, h: number, ex: unknown) => Promise<string>;

    // Fire and wait for queued frame actions
    frame: () => Promise<void>;

    // Get the state of input devices
    input: () => Promise<string[]>;

    // Load in this spritesheet
    loadSpritesheet: (desc: unknown) => Promise<string>;

    // Add this sprite from a loaded spritesheet onto this stage
    addSprite: (
        stageId: string, spritesheet: string, sprite: string, x: number,
        y: number, ex: any
    ) => Promise<string>;

    // Update this sprite's image
    updateSprite: (
        stageId: string, id: string, spritesheet: string, sprite: string
    ) => Promise<void>;

    // Move this (added) sprite
    moveSprite: (
        stageId: string, sprite: string, x: number, y: number
    ) => Promise<void>;

    // Mirror or unmirror this sprite
    mirrorSprite: (
        stageId: string, sprite: string, mirror: boolean, vertical: boolean
    ) => Promise<void>;
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

export interface AnimatedSprite extends EYCElement {
    isAnimatedSprite: boolean;
    name: string;
    sheet: Spritesheet;
    sprites: Sprite[];
}

// Spritesheets have namespaces called "blocks"
export interface Spriteblock extends Resource {
    isSpriteblock: boolean;
    members: Record<string, Sprite | AnimatedSprite | Spriteblock>;
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
    ownMethodTypes: Record<string, Method>;
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
    type: TreeType;
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

// Top-level tree types
export type TreeTypeTop =
    "CopyrightDecl" |
    "LicenseDecl" |
    "InlineImportDecl" |
    "ImportDecl" |
    "AliasDecl" |
    "AliasStarDecl" |
    "SpritesheetDecl" |
    "SoundSetDecl" |
    "FabricDecl" |
    "PrefixDecl" |
    "ClassDecl";

// Members of classes
export type TreeTypeClassMember =
    "MethodDecl" |
    "FieldDecl";

// Statements
export type TreeTypeStmt =
    "Block" |
    "VarDecl" |
    "IfStatement" |
    "WhileStatement" |
    "ForStatement" |
    "ForInStatement" |
    "ForInMapStatement" |
    "ReturnStatement" |
    "ExtendStatement" |
    "RetractStatement" |
    "ExpStatement";

// Expressions
export type TreeTypeExp =
    "AssignmentExp" |
    "OrExp" |
    "AndExp" |
    "EqExp" |
    "RelExp" |
    "AddExp" |
    "MulExp" |
    "UnExp" |
    "CastExp" |
    "PostIncExp" |
    "PostDecExp" |
    "CallExp" |
    "IndexExp" |
    "SuggestionExtendExp" |
    "DotExp" |
    "SuggestionLiteral" |
    "NewExp" |
    "SuperCall" |
    "This" |
    "Caller" |
    "JavaScriptExpression" |
    "NullLiteral" |
    "HexLiteral" |
    "B64Literal" |
    "DecLiteral" |
    "StringLiteral" |
    "BoolLiteral" |
    "ArrayLiteral" |
    "TupleLiteral" |
    "ID";

// Types
export type TreeTypeType =
    "TypeName" |
    "TypeArray" |
    "TypeTuple" |
    "TypeMap" |
    "TypeSet" |
    "TypeSuggestion" |
    "TypeNum" |
    "TypeString" |
    "TypeBool" |
    "TypeVoid";

// Miscellaneous tree types only used in other tree types
export type TreeTypeMisc =
    "Module" |
    "ExportClause" |
    "Version" |
    "NameList" |
    "MemberDeclList" |
    "ParamList" |
    "Param" |
    "FieldDeclList" |
    "FieldDeclPart" |
    "VarDeclList" |
    "VarDeclPart" |
    "ArgList" |
    "TypeList" |
    "Sprite" |
    "SpriteBlock" |
    "Sound" |
    "SoundSetProperty" |
    "FabricProperty" |
    "Name";

export type TreeType =
    TreeTypeTop |
    TreeTypeClassMember |
    TreeTypeStmt |
    TreeTypeExp |
    TreeTypeType |
    TreeTypeMisc;

// SSA ops
export type SSAOp =
    // "Block" |
    // "VarDecl" |
    // "IfStatement" |
    "if" |
    "else" |
    "fi" |
    "esle" |
    // "WhileStatement" |
    "loop" |
    "break" |
    "pool" |
    // "ForStatement" |
    // "ForInStatement" |
    "for-in-array" |
    "for-in-set" |
    "for-in-string" |
    "ni-rof" |
    "map-keys-array" |
    "set-values-array" |
    "set-tuple-values-array" |
    // "ForInMapStatement" |
    "for-in-array-idx" |
    "for-in-string-idx" |
    // "ReturnStatement" |
    "return" |
    // "ExtendStatement" |
    "extend" |
    "suggestion-extend" |
    // "RetractStatement" |
    "retract" |
    "suggestion-retract" |
    // "ExpStatement";
    // "AssignmentExp" |
    "array-concatenate" |
    "array-append" |
    "set-add" |
    "set-delete" |
    "set-tuple-add" |
    "set-tuple-delete" |
    // "OrExp" |
    // "AndExp" |
    // "EqExp" |
    "eq-object-object" |
    "eq-object-null" |
    "eq-null-object" |
    "eq-array-array" |
    "eq-array-null" |
    "eq-null-array" |
    "eq-tuple-tuple" |
    "eq-map-map" |
    "eq-map-null" |
    "eq-null-map" |
    "eq-set-set" |
    "eq-set-null" |
    "eq-null-set" |
    "eq-suggestion-suggestion" |
    "eq-num-num" |
    "eq-string-string" |
    "eq-bool-bool" |
    "eq-null-null" |
    "ne-object-object" |
    "ne-object-null" |
    "ne-null-object" |
    "ne-array-array" |
    "ne-array-null" |
    "ne-null-array" |
    "ne-tuple-tuple" |
    "ne-map-map" |
    "ne-map-null" |
    "ne-null-map" |
    "ne-set-set" |
    "ne-set-null" |
    "ne-null-set" |
    "ne-suggestion-suggestion" |
    "ne-num-num" |
    "ne-string-string" |
    "ne-bool-bool" |
    "ne-null-null" |
    // "RelExp" |
    "le-object-object" |
    "le-array-array" |
    "le-tuple-tuple" |
    "le-map-map" |
    "le-set-set" |
    "le-num-num" |
    "le-string-string" |
    "le-bool-bool" |
    "lt-object-object" |
    "lt-array-array" |
    "lt-tuple-tuple" |
    "lt-map-map" |
    "lt-set-set" |
    "lt-num-num" |
    "lt-string-string" |
    "lt-bool-bool" |
    "ge-object-object" |
    "ge-array-array" |
    "ge-tuple-tuple" |
    "ge-map-map" |
    "ge-set-set" |
    "ge-num-num" |
    "ge-string-string" |
    "ge-bool-bool" |
    "gt-object-object" |
    "gt-array-array" |
    "gt-tuple-tuple" |
    "gt-map-map" |
    "gt-set-set" |
    "gt-num-num" |
    "gt-string-string" |
    "gt-bool-bool" |
    "in-object-array" |
    "in-array-array" |
    "in-tuple-array" |
    "in-map-array" |
    "in-set-array" |
    "in-suggestion-array" |
    "in-num-array" |
    "in-string-array" |
    "in-bool-array" |
    "in-object-map" |
    "in-array-map" |
    "in-tuple-map" |
    "in-map-map" |
    "in-set-map" |
    "in-suggestion-map" |
    "in-num-map" |
    "in-string-map" |
    "in-bool-map" |
    "in-object-set" |
    "in-array-set" |
    "in-tuple-set" |
    "in-map-set" |
    "in-set-set" |
    "in-suggestion-set" |
    "in-num-set" |
    "in-string-set" |
    "in-bool-set" |
    "is-object-class" |
    // "AddExp" |
    "add-array-array" |
    "add-suggestion-suggestion" |
    "add-num-num" |
    "add-string-string" |
    "sub-num-num" |
    // "MulExp" |
    "mul-num-num" |
    "div-num-num" |
    "mod-num-num" |
    // "UnExp" |
    "neg-num" |
    "not-object" |
    "not-array" |
    "not-tuple" |
    "not-map" |
    "not-set" |
    "not-suggestion" |
    "not-num" |
    "not-string" |
    "not-bool" |
    "not-null" |
    // "CastExp" |
    "string-from-spritesheet" |
    "string-from-object" |
    "string-from-array" |
    "string-from-tuple" |
    "string-from-map" |
    "string-from-set" |
    "string-from-suggestion" |
    "string-from-num" |
    "string-from-string" |
    "string-from-bool" |
    "string-from-null" |
    "bool-from-object" |
    "bool-from-array" |
    "bool-from-tuple" |
    "bool-from-map" |
    "bool-from-set" |
    "bool-from-suggestion" |
    "bool-from-num" |
    "bool-from-string" |
    "bool-from-bool" |
    "bool-from-null" |
    // "PostIncExp" |
    // "PostDecExp" |
    // "CallExp" |
    "call-head" |
    "arg" |
    "call-call-static" |
    "call-call" |
    "suggestion-call-call" |
    // "IndexExp" |
    "array-index" |
    "tuple-index" |
    "map-pair" |
    "map-assign" |
    "map-tuple-assign" |
    "map-get" |
    "map-tuple-get" |
    "set-get" |
    "set-tuple-get" |
    "string-index" |
    // "SuggestionExtendExp" |
    // "DotExp" |
    "field-assign" |
    "field" |
    "array-length" |
    "string-length" |
    // "SuggestionLiteral" |
    "suggestion-head" |
    "suggestion-tail" |
    "suggestion-literal" |
    // "NewExp" |
    "new-object" |
    "new-array" |
    "new-tuple" |
    "new-map" |
    "new-set" |
    "new-suggestion" |
    "new-num" |
    "new-string" |
    "new-bool" |
    "new-null" |
    "with" |
    "htiw" |
    // "SuperCall" |
    "call-call-super" |
    // "This" |
    "this" |
    // "Caller" |
    // "JavaScriptExpression" |
    "javascript-head" |
    "javascript-call" |
    // "NullLiteral" |
    "null" |
    "default" | // any default value
    // "HexLiteral" |
    "hex-literal" |
    // "B64Literal" |
    "b64-literal" |
    // "DecLiteral" |
    "dec-literal" |
    "compile-time-literal" |
    // "StringLiteral" |
    "string-literal" |
    // "BoolLiteral" |
    "bool-literal" |
    // "ArrayLiteral" |
    "array-literal-head" |
    "array-literal-tail" |
    // "TupleLiteral" |
    "tuple-literal-head" |
    "tuple-literal-tail" |
    // "ID";
    "spritesheet" |
    "animated-sprite" |
    "sprite" |
    "class" |
    "var-assign" |
    "var";


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
