import * as lexNum from "./lexnum";
import * as parser from "./parser";
import * as types from "./types";

/* This doesn't do anything, it's just to make sure that the polyfill is loaded
 * if needed, since it's used it compiled code */
Array.from("hello");

class EYCTypeError extends Error {
    isEYCTypeError: boolean;
    ctx: types.Tree;
    msg: string;

    constructor(ctx: types.Tree, msg: string) {
        super();
        this.isEYCTypeError = true;
        this.ctx = ctx;
        this.msg = msg;
    }

    get message() {
        return this.ctx.module.absoluteUrl + ":" +
               this.ctx.location.start.line + ":" +
               this.ctx.location.start.column + ": " +
               this.msg;
    }
}

// Import this module, with everything that implies
export async function importModule(eyc: types.EYC, url: string,
        opts: types.ImportModuleOpts = {}): Promise<types.Module> {
    let text: string;

    if (!opts.text) {
        // Get the actual content (FIXME: versioning somewhere)
        text = await eyc.ext.fetch(url + ".eyc");
    } else {
        text = opts.text;
    }

    // Make the output module for it
    const module = new eyc.Module(url, "1.0", url + ".eyc", opts.ctx || {privileged: false});

    // Parse it
    let parsed;
    try {
        parsed = module.parsed = <types.ModuleNode> parser.parse(text);
    } catch (ex) {
        if (ex.location)
            console.log(url + ":" + ex.location.start.line + ":" + ex.location.start.column + ": " + ex);
        throw ex;
    }

    // Link the entire parse tree up to the module
    linkParseTree(parsed, module);

    // Get its exports
    parsed.exports = resolveExports(eyc, module);

    // Resolve all global names
    await resolveSymbols(eyc, module);

    // Resolve all global types
    await resolveDeclTypes(eyc, module);

    // Type check
    typeCheckModule(eyc, module);

    // And compile
    compileModule(eyc, module);

    return module;
}

// Link all the nodes in this parse tree to the module
function linkParseTree(tree: types.Tree, module: types.Module) {
    tree.module = module;
    for (let c in tree.children) {
        c = tree.children[c];
        if (typeof c === "object" && c !== null) {
            if ((<Object> c) instanceof Array) {
                for (let i of (<types.Tree[]> c)) {
                    if (typeof i === "object" && i !== null)
                        linkParseTree(i, module);
                }
            } else {
                linkParseTree(c, module);
            }
        }
    }
}

// Resolve the exports of this module
function resolveExports(eyc: types.EYC, module: types.Module) {
    const exports = Object.create(null);

    for (const c of module.parsed.children) {
        switch (c.type) {
            case "ImportDecl":
                if (!c.children.exportClause)
                    break; // Not exported
                throw new EYCTypeError(c, "Cannot resolve exports of ImportDecl");

            case "AliasDecl":
            {
                if (!c.children.exportClause)
                    break; // Not exported
                // We can't yet know *what* this is, until we resolve types
                let nm: string;
                if (c.children.asClause) {
                    nm = c.children.asClause.children.text;
                } else {
                    const parts = c.children.name.children;
                    nm = parts[parts.length - 1];
                }
                exports[nm] = c;
                break;
            }

            case "SpriteSheetDecl":
                if (!c.children.exportClause)
                    break; // Not exported
                exports[c.children.id.children.text] = c;
                break;

            case "SoundSetDecl":
                if (!c.children.exportClause)
                    break; // Not exported
                exports[c.children.id.children.text] = c;
                break;

            case "FabricDecl":
                if (!c.children.exportClause)
                    break; // Not exported
                exports[c.children.id.children.text] = c;
                break;

            case "PrefixDecl":
                // Not actually an export, but now is the right time to get this
                if (!module.ctx.privileged)
                    throw new EYCTypeError(c, "Prefix declaration in unprivileged module");
                module.prefix = "$$" + c.children.text;
                break;

            case "ClassDecl":
                if (!c.children.exportClause)
                    break; // Not exported
                exports[c.children.id.children.text] = c;
                if (c.children.exportClause.children.main)
                    module.main = c;
                break;

            case "CopyrightDecl":
            case "LicenseDecl":
            case "AliasStarDecl":
                // No exports
                break;

            default:
                throw new EYCTypeError(c, "Cannot resolve exports of " + c.type);
        }
    }

    return exports;
}

// Resolve global names
async function resolveSymbols(eyc: types.EYC, module: types.Module) {
    const symbols = module.parsed.symbols = <Record<string, types.Tree>> Object.create(null);
    const isLocal = <Record<string, boolean>> Object.create(null);

    // Start with core
    if (module.prefix !== "$$core" &&
        !("core" in symbols) &&
        "/core" in eyc.modules) {
        symbols.core = eyc.modules["/core"].parsed;
        isLocal.core = false;
    }

    function defineSymbol(ctx: types.Tree, nm: string, val: types.Tree, local: boolean) {
        if (nm in symbols) {
            if (isLocal[nm]) {
                // Existing definition is local
                if (local)
                    throw new EYCTypeError(ctx, "Multiply defined symbol " + nm);
                // Otherwise, we prefer the local definition
                return;
            } else {
                // Existing definition is nonlocal
                if (!local) {
                    // Ambiguous, so prefer *neither*
                    symbols[nm] = null;
                    return;
                }
                // Otherwise, we prefer the local definition
            }
        }
        symbols[nm] = val;
        isLocal[nm] = local;
    }

    // We also check for proper licensing here
    let copyrights = 0;
    let licenses = 0;

    for (const c of module.parsed.children) {
        switch (c.type) {
            case "CopyrightDecl":
                copyrights++;
                // Allow multiple copyright lines
                break;

            case "LicenseDecl":
                if (++licenses > 1)
                    throw new EYCTypeError(c, "Multiple license declarations");
                break;

            case "ImportDecl":
            {
                const url = eyc.urlAbsolute(module.url, c.children.package);
                let nm = url.replace(/\/$/, "").replace(/^.*\//, "");
                // FIXME: Check that the name is actually valid
                if (c.children.asClause)
                    nm = c.children.asClause.children.text;

                // Load the module
                if (!(url in eyc.modules)) {
                    // Need to import it first
                    await importModule(eyc, url);
                }

                defineSymbol(c, nm, eyc.modules[url].parsed, true);
                break;
            }

            case "AliasDecl":
            {
                const target = <types.ModuleNode> resolveName(eyc, module.parsed, c.children.name);
                let nm: string;
                if (c.children.asClause) {
                    nm = c.children.asClause.children.text;
                } else {
                    const parts = c.children.name.children;
                    nm = parts[parts.length - 1];
                }
                defineSymbol(c, nm, target, true);

                // Also fix up the export at this point
                if (c.children.exportClause) {
                    module.parsed.exports[nm] = target;

                    if (c.children.exportClause.children.main)
                        module.main = target;
                }
                break;
            }

            case "AliasStarDecl":
            {
                const aliasModule = <types.ModuleNode> resolveName(eyc, module.parsed, c.children.name);
                if (aliasModule.type !== "Module")
                    throw new EYCTypeError(c, "Can only alias elements of a module");
                for (const s in aliasModule.exports)
                    defineSymbol(c, s, aliasModule.exports[s], false);
                break;
            }

            case "SpriteSheetDecl":
                defineSymbol(c, c.children.id.children.text, c, true);
                break;

            case "SoundSetDecl":
                defineSymbol(c, c.children.id.children.text, c, true);
                break;

            case "FabricDecl":
                defineSymbol(c, c.children.id.children.text, c, true);
                break;

            case "PrefixDecl":
                // No symbols
                break;

            case "ClassDecl":
                // Classes declare their own name
                defineSymbol(c, c.children.id.children.text, c, true);
                break;

            default:
                throw new EYCTypeError(c, "Cannot resolve symbols of " + c.type);
        }
    }

    if (!copyrights)
        throw new EYCTypeError(module.parsed, "No copyright declaration");
    if (!licenses)
        throw new EYCTypeError(module.parsed, "No license declaration");

    return symbols;
}

// Type check global declarations
async function resolveDeclTypes(eyc: types.EYC, module: types.Module) {
    const symbolTypes = module.parsed.symbolTypes = <Record<string, types.TypeLike>> Object.create(null);

    for (const id of Object.keys(module.parsed.symbols).sort()) {
        const c = module.parsed.symbols[id];
        c.parent = module.parsed;
        switch (c.type) {
            case "SpriteSheetDecl":
                symbolTypes[id] = resolveSpriteSheetDeclTypes(eyc, <types.SpritesheetNode> c);
                break;

            case "SoundSetDecl":
                symbolTypes[id] = resolveSoundSetDeclTypes(eyc, <types.SoundsetNode> c);
                break;

            case "ClassDecl":
                symbolTypes[id] = resolveClassDeclTypes(eyc, <types.ClassNode> c);
                break;

            case "FabricDecl":
                symbolTypes[id] = await resolveFabricDeclTypes(eyc, <types.FabricNode> c);
                break;

            case "Module":
                // Should've already been resolved
                symbolTypes[id] = (<types.ClassNode> c).module;
                break;

            default:
                throw new EYCTypeError(c, "Cannot resolve types of " + c.type);
        }
    }
}

// Resolve the "types" of a sprite declaration
function resolveSpriteSheetDeclTypes(eyc: types.EYC, spritesDecl: types.SpritesheetNode) {
    if (spritesDecl.spritesheet)
        return spritesDecl.spritesheet;

    const sheet = spritesDecl.spritesheet = spritesDecl.ctype =
        new eyc.Spritesheet(spritesDecl.module,
            spritesDecl.children.id.children.text, spritesDecl.children.url);

    // Our default settings
    let defaults = {
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        scale: 1,
        factor: 1,
        frames: 1,
        speed: 1
    };

    // Loop over the sprites...
    for (const sprite of (spritesDecl.children.sprites || [])) {
        switch (sprite.type) {
            case "Sprite":
            {
                // The natural content, a sprite
                const nm = sprite.children.id.children.text;
                const args = sprite.children.args ? sprite.children.args.children : [];

                // Get the values associated with the sprite
                const vals = Object.assign({}, defaults);

                for (let i = 0; i < args.length; i++) {
                    const a = args[i];
                    let an, av;

                    switch (a.type) {
                        case "AssignmentExp":
                        {
                            const l = a.children.target;
                            const r = a.children.value;

                            // Must be in the form {x,y,w,h,scale,factor} = {num}
                            if (l.type !== "ID" || (
                                r.type !== "HexLiteral" && r.type !== "B64Literal" && r.type !== "DecLiteral")) {
                                throw new EYCTypeError(a, "Expected {x,y,w,h,scale,factor} = {number}");
                            }
                            an = l.children.text;
                            av = r;
                            if (!(an in defaults))
                                throw new EYCTypeError(a, "Unrecognized sprite property " + an);
                            break;
                        }

                        case "HexLiteral":
                        case "B64Literal":
                        case "DecLiteral":
                        {
                            // Name is implicit by position
                            switch (i) {
                                case 0:
                                    an = "x";
                                    break;

                                case 1:
                                    an = "y";
                                    break;

                                case 2:
                                    an = "w";
                                    break;

                                case 3:
                                    an = "h";
                                    break;

                                case 4:
                                    an = "scale";
                                    break;

                                default:
                                    throw new EYCTypeError(a, "No default property for index " + i);
                            }

                            // Value is given
                            av = a;
                            break;
                        }

                        default:
                            throw new EYCTypeError(a, "Invalid sprite sheet literal");
                    }

                    // Now get the actual value out of the value
                    //av = Function("return " + compileExpression(eyc, null, {}, av))();
                    throw new Error;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (<any> vals)[an] = av;
                }

                if (nm === "default") {
                    // These are the new defaults
                    defaults = vals;

                } else {
                    // Bump the default x
                    defaults.x = vals.x + vals.w * vals.frames;

                    // Scale
                    vals.x *= vals.factor;
                    vals.y *= vals.factor;
                    vals.w *= vals.factor;
                    vals.h *= vals.factor;
                    delete vals.factor;

                    // This is a new sprite
                    sheet.add(new eyc.Sprite(sheet, nm, vals));

                }

                break;
            }

            default:
                throw new EYCTypeError(sprite, "Unrecognized spritesheet element " + sprite.type);
        }
    }

    return sheet;
}

// Resolve the "types" of a sound set declaration
function resolveSoundSetDeclTypes(eyc: types.EYC, soundsDecl: types.SoundsetNode) {
    if (soundsDecl.soundset)
        return soundsDecl.soundset;

    const set = soundsDecl.soundset = soundsDecl.ctype =
        new eyc.Soundset(soundsDecl.module,
            soundsDecl.children.id.children.text, soundsDecl.children.url);

    // Our default settings
    let defaults = {
        start: 0,
        length: 0,
        end: <number> null
    };

    // Loop over the sounds...
    for (const sound of (soundsDecl.children.sounds || [])) {
        switch (sound.type) {
            case "Sound":
            {
                // The natural content, a sound
                const nm = sound.children.id.children.text;
                const args = sound.children.args.children;

                // Get the values associated with the sound
                const vals = {
                    start: defaults.start,
                    length: defaults.length,
                    end: defaults.end
                };

                for (let i = 0; i < args.length; i++) {
                    const a = args[i];
                    let an, av;

                    switch (a.type) {
                        case "AssignmentExp":
                        {
                            const l = a.children.target;
                            const r = a.children.value;

                            // Must be in the form {x,y,w,h} = {num}
                            if (l.type !== "ID" || (
                                r.type !== "HexLiteral" && r.type !== "B64Literal" && r.type !== "DecLiteral")) {
                                throw new EYCTypeError(a, "Expected {start,length,end} = {number}");
                            }
                            an = l.children.text;
                            av = r;
                            break;
                        }

                        case "HexLiteral":
                        case "B64Literal":
                        case "DecLiteral":
                        {
                            // Name is implicit by position
                            switch (i) {
                                case 0:
                                    an = "start";
                                    break;

                                case 1:
                                    an = "length";
                                    break;

                                default:
                                    throw new EYCTypeError(a, "No default property for index " + i);
                            }

                            // Value is given
                            av = a;
                            break;
                        }

                        default:
                            throw new EYCTypeError(a, "Invalid sound set literal");
                    }

                    // Now get the actual value out of the value
                    //av = Function("return " + compileExpression(eyc, null, {}, av))();
                    throw new Error;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (<any> vals)[an] = av;

                    // Only one of length/end is allowed
                    if (an === "length")
                        vals.end = null;
                    else if (an === "end")
                        vals.length = null;
                }

                if (nm === "default") {
                    // These are the new defaults
                    defaults = vals;

                } else {
                    // This is a new sound
                    set.add(new eyc.Sound(set, nm, vals.start, (vals.length === null) ? (vals.end - vals.start) : vals.length));

                }

                break;
            }

            default:
                throw new EYCTypeError(sound, "Unrecognized soundset element " + sound.type);
        }
    }

    return set;
}

/* Resolve a fabric declaration. Involves fetching the actual file defined by
 * the fabric. */
async function resolveFabricDeclTypes(eyc: types.EYC, fabricDecl: types.FabricNode) {
    if (fabricDecl.fabric)
        return fabricDecl.fabric;

    const url = eyc.urlAbsolute(fabricDecl.module.url, fabricDecl.children.url);
    const fabric = fabricDecl.fabric = fabricDecl.ctype =
        new eyc.Fabric(fabricDecl.module,
            fabricDecl.children.kind === "garment",
            fabricDecl.children.id.children.text, fabricDecl.children.url,
            await eyc.ext.fetch(url));

    // FIXME: Properties
    if (fabricDecl.children.props.length)
        throw new EYCTypeError(fabricDecl, "Fabric properties are not yet supported");

    /* The actual type is an array(string) (fabric) or array(array(string))
     * (garment) */
    if (fabricDecl.children.kind === "garment")
        return new eyc.ArrayType(new eyc.ArrayType(eyc.stringType));
    else
        return new eyc.ArrayType(eyc.stringType);
}

// Resolve the types of a class declaration (at a high level)
function resolveClassDeclTypes(eyc: types.EYC, classDecl: types.ClassNode) {
    if (classDecl.klass)
        return classDecl.klass;

    const klass = classDecl.klass = classDecl.ctype =
        new eyc.Class(classDecl.module, classDecl.children.id.children.text);

    classDecl.itype = new eyc.ObjectType(klass);
    //classDecl.symbols = Object.create(null);

    // First resolve the parents
    const extsC: types.Tree = classDecl.children.extendsClause;
    let exts: types.EYCClass[];
    if (extsC === null) {
        // No extends clause, implicitly extend Root (or nothing if this is root)
        if (classDecl.module.prefix !== "$$core")
            exts = [eyc.classes["$$core$Root"]];
        else
            exts = [];

    } else {
        // Get all the classes it extends
        exts = extsC.children.map((ext: types.Tree) => {
            const decl = <types.ClassNode> resolveName(eyc, classDecl.module.parsed, ext);
            if (decl.type !== "ClassDecl")
                throw new EYCTypeError(ext, "Invalid extension");
            if (!decl.klass)
                resolveClassDeclTypes(eyc, decl);
            return decl.klass;
        });

    }

    // Inherit parent methods and fields
    klass.parents = exts;
    for (const ext of exts) {
        for (const name in ext.methodTypes) {
            const method = ext.methodTypes[name];
            if ((name in klass.methodTypes &&
                 method !== klass.methodTypes[name]) ||
                 name in klass.fieldTypes) {
                // Incompatible inheritance!
                klass.methodTypes[name] = klass.fieldTypes[name] = null;
            } else {
                klass.methodTypes[name] = method;
            }
        }

        for (const name in ext.fieldTypes) {
            const field = ext.fieldTypes[name];
            if ( name in klass.methodTypes ||
                (name in klass.fieldTypes &&
                 field !== klass.fieldTypes[name])) {
                // Incompatible inheritance!
                klass.methodTypes[name] = klass.fieldTypes[name] = null;
            } else {
                klass.fieldTypes[name] = field;
                klass.fieldNames[name] = ext.fieldNames[name];
            }
        }
    }

    // Now go over our own methods and fields
    for (const c of classDecl.children.members.children) {
        c.parent = classDecl;
        if (c.type === "MethodDecl")
            resolveMethodDeclType(eyc, klass, c);
        else if (c.type === "FieldDecl")
            resolveFieldDeclTypes(eyc, klass, c);
    }

    return klass;
}

// Resolve the type of a method declaration (does NOT type check the body)
function resolveMethodDeclType(eyc: types.EYC, klass: types.EYCClass, methodDecl: types.MethodNode) {
    // First get the mutation clauses
    let mutating = false, mutatingThis = false;
    if (methodDecl.children.mutating) {
        mutatingThis = true;
        if (!methodDecl.children.thisClause)
            mutating = true;
    } else if (methodDecl.children.thisClause) {
        throw new EYCTypeError(methodDecl, "Cannot have 'this' without 'mutating'");
    }

    // The return type
    const retType = typeNameToType(eyc, methodDecl.module.parsed, methodDecl.children.type);

    // And the parameter types
    let paramTypes;
    if (methodDecl.children.params) {
        paramTypes = methodDecl.children.params.children.map((param: types.Tree) => {
            return typeNameToType(eyc, methodDecl.module.parsed, param.children.type);
        });
    } else {
        paramTypes = [];
    }

    const signature = methodDecl.signature = new eyc.Method(klass, methodDecl.children.id.children.text, mutating, mutatingThis, retType, paramTypes);

    // Now put it in the class
    const name = methodDecl.children.id.children.text;
    if (name in klass.methodTypes) {
        // This has to be an override
        if (!methodDecl.children.override)
            throw new EYCTypeError(methodDecl, "Must explicitly specify override for override methods (" + name + ")");
        if (!klass.methodTypes[name].equals(methodDecl.signature))
            throw new EYCTypeError(methodDecl, "Override method type must be identical to base method type");

        // The ID is the parent ID
        signature.id = klass.methodTypes[name].id;

    } else {
        // This must NOT be an override
        if (methodDecl.children.override)
            throw new EYCTypeError(methodDecl, "Override method overrides nothing");
        klass.methodTypes[name] = methodDecl.signature;

    }
}

// Resolve the types of a field declaration
function resolveFieldDeclTypes(eyc: types.EYC, classType: types.EYCClass, fieldDecl: types.Tree) {
    // Get its type
    const fieldType = fieldDecl.ctype = typeNameToType(eyc, fieldDecl.module.parsed, fieldDecl.children.type);

    // Then assign that type to each declaration
    for (const decl of fieldDecl.children.decls.children) {
        const name = decl.children.id.children.text;
        const iname = classType.prefix + "$" + name;
        if (name in classType.methodTypes || name in classType.fieldTypes) {
            // Invalid declaration!
            throw new EYCTypeError(fieldDecl, "Declaration of name that already exists in this type");
        }
        classType.fieldTypes[name] = classType.ownFieldTypes[iname] = decl.ctype = fieldType;
        classType.fieldNames[name] = classType.prefix + "$" + name;
    }
}

// Type check a module
function typeCheckModule(eyc: types.EYC, module: types.Module) {
    for (const c of module.parsed.children) {
        switch (c.type) {
            case "ClassDecl":
                typeCheckClass(eyc, c);
                break;

            case "CopyrightDecl":
            case "LicenseDecl":
            case "PrefixDecl":
            case "ImportDecl":
            case "AliasDecl":
            case "AliasStarDecl":
            case "SpriteSheetDecl":
            case "SoundSetDecl":
            case "FabricDecl":
                // No types or no possibility of type error
                break;

            default:
                throw new EYCTypeError(c, "Cannot type check " + c.type);
        }
    }
}

// Type check a class
function typeCheckClass(eyc: types.EYC, classDecl: types.Tree) {
    for (const c of classDecl.children.members.children) {
        switch (c.type) {
            case "MethodDecl":
                typeCheckMethodDecl(eyc, c);
                break;

            case "FieldDecl":
                typeCheckFieldDecl(eyc, c);
                break;

            default:
                throw new EYCTypeError(c, "Cannot type check " + c.type);
        }
    }
}

// Context for type checking: May we mutate (this)?
interface CheckCtx {
    mutating: boolean;
    mutatingThis: boolean;
}

// Type check a method
function typeCheckMethodDecl(eyc: types.EYC, methodDecl: types.MethodNode) {
    // Get the argument symbols
    const symbols = Object.create(methodDecl.module.parsed.symbolTypes);
    const ctx = {
        mutating: methodDecl.signature.mutating,
        mutatingThis: methodDecl.signature.mutatingThis
    };
    symbols["this"] = methodDecl.parent.itype;

    if (methodDecl.children.params) {
        const params = methodDecl.children.params.children;
        for (let ai = 0; ai < params.length; ai++) {
            const a = params[ai];
            symbols[a.children.id.children.text] = methodDecl.signature.paramTypes[ai];
        }
    }

    // Type check every statement
    typeCheckStatement(eyc, methodDecl, ctx, symbols, methodDecl.children.body);
}

// Type check a field declaration
function typeCheckFieldDecl(eyc: types.EYC, fieldDecl: types.Tree) {
    const type = fieldDecl.ctype;

    for (const decl of fieldDecl.children.decls.children) {
        if (decl.children.initializer) {
            if (type.isObject || type.isSuggestion) {
                // No initializer allowed!
                throw new EYCTypeError(decl, "Forbidden initializer");
            }

            // FIXME: null method decl could throw
            const initType = typeCheckExpression(eyc, null, {mutating: false, mutatingThis: false}, Object.create(null), decl.children.initializer);
            if (!initType.equals(type, {subtype: true}))
                throw new EYCTypeError(decl, "Incorrect initializer type");
        }
    }
}

// Type check a statement
function typeCheckStatement(eyc: types.EYC, methodDecl: types.MethodNode,
        ctx: CheckCtx, symbols: Record<string, types.TypeLike>, stmt: types.Tree) {
    switch (stmt.type) {
        case "Block":
            symbols = Object.create(symbols);
            for (const s of stmt.children)
                typeCheckStatement(eyc, methodDecl, ctx, symbols, s);
            break;

        case "VarDecl":
        {
            const type = typeNameToType(eyc, methodDecl.module.parsed, stmt.children.type);
            for (const d of stmt.children.decls.children) {
                symbols[d.children.id.children.text] = type;
                if (d.children.initializer) {
                    const iType = typeCheckExpression(eyc, methodDecl, ctx, symbols, d.children.initializer, {autoType: type});
                    if (!iType.equals(type, {subtype: true}))
                        throw new EYCTypeError(d, "Initializer of wrong type");
                }
                d.ctype = type;
            }
            break;
        }

        case "IfStatement":
        {
            typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.condition);

            const ifSymbols = Object.create(symbols);
            typeCheckStatement(eyc, methodDecl, ctx, ifSymbols, stmt.children.ifStatement);

            if (stmt.children.elseStatement) {
                const elseSymbols = Object.create(symbols);
                typeCheckStatement(eyc, methodDecl, ctx, elseSymbols, stmt.children.elseStatement);
            }

            break;
        }

        case "ForStatement":
        {
            symbols = Object.create(symbols);
            if (stmt.children.initializer) {
                if (stmt.children.initializer.type === "VarDecl")
                    typeCheckStatement(eyc, methodDecl, ctx, symbols, stmt.children.initializer);
                else
                    typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.initializer);
            }

            if (stmt.children.condition)
                typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.condition);
            if (stmt.children.increment)
                typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.increment);

            typeCheckStatement(eyc, methodDecl, ctx, symbols, stmt.children.body);
            break;
        }

        case "ForInStatement":
        {
            const expType = typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.collection);
            let elType;
            if (expType.isArray || expType.isSet)
                elType = (<types.ArrayType & types.SetType> expType).valueType;
            else if (expType.isString)
                elType = eyc.stringType;
            else if (expType.isMap)
                elType = (<types.MapType> expType).keyType;
            else
                throw new EYCTypeError(stmt, "Invalid for-in loop collection type");

            let itType;
            if (stmt.children.type) {
                itType = typeNameToType(eyc, methodDecl.module.parsed, stmt.children.type);
                stmt.children.id.ctype = itType;
            } else {
                itType = typeCheckLValue(eyc, methodDecl, ctx, symbols, stmt.children.id);
            }

            if (!elType.equals(itType, {subtype: true}))
                throw new EYCTypeError(stmt, "Incorrect iterator type");

            symbols = Object.create(symbols);
            symbols[stmt.children.id.children.text] = itType;
            typeCheckStatement(eyc, methodDecl, ctx, symbols, stmt.children.body);
            break;
        }

        case "ForInMapStatement":
        {
            const expType = <types.MapType> typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.collection);

            let keyType;
            if (stmt.children.keyType) {
                keyType = typeNameToType(eyc, methodDecl.module.parsed, stmt.children.keyType);
                stmt.children.key.ctype = keyType;
            } else {
                keyType = typeCheckLValue(eyc, methodDecl, ctx, symbols, stmt.children.key);
            }

            let valType;
            if (stmt.children.valueType) {
                valType = typeNameToType(eyc, methodDecl.module.parsed, stmt.children.valueType);
                stmt.children.value.ctype = valType;
            } else {
                valType = typeCheckLValue(eyc, methodDecl, ctx, symbols, stmt.children.value);
            }

            if (expType.isString) {
                // index-string loop
                if (!keyType.isNum || !valType.isString)
                    throw new EYCTypeError(stmt, "Incorrect types for for-in loop over string");

            } else if (expType.isArray) {
                // index-element loop
                if (!keyType.isNum)
                    throw new EYCTypeError(stmt, "Incorrect key iterator type");
                if (!expType.valueType.equals(valType, {subtype: true}))
                    throw new EYCTypeError(stmt, "Incorrect value iterator type");

            } else if (expType.isMap) {
                if (!expType.keyType.equals(keyType, {subtype: true}))
                    throw new EYCTypeError(stmt, "Incorrect key iterator type");
                if (!expType.valueType.equals(valType, {subtype: true}))
                    throw new EYCTypeError(stmt, "Incorrect value iterator type");

            } else {
                throw new EYCTypeError(stmt, "Two-variable for-in loop on invalid type");
            }

            symbols = Object.create(symbols);
            symbols[stmt.children.key.children.text] = keyType;
            symbols[stmt.children.value.children.text] = valType;
            typeCheckStatement(eyc, methodDecl, ctx, symbols, stmt.children.body);
            break;
        }

        case "ReturnStatement":
            if (stmt.children.value) {
                const retType = typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.value);
                if (!retType.equals(methodDecl.signature.retType, {subtype: true}))
                    throw new EYCTypeError(stmt, "Incorrect return type");

            } else {
                if (!methodDecl.signature.retType.isVoid)
                    throw new EYCTypeError(stmt, "void return in function expecting return value");

            }
            break;

        case "ExtendStatement":
        case "RetractStatement":
        {
            const exp = stmt.children.expression;
            if (exp.type !== "CastExp")
                throw new EYCTypeError(exp, "Invalid extension/retraction statement");

            // The target has to be an object type
            const targetType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);
            if (!targetType.isObject)
                throw new EYCTypeError(exp, "Only objects can be extended/retracted");

            // The type has to be a class
            const type = typeNameToType(eyc, methodDecl.module.parsed, exp.children.type);
            if (!type.isObject)
                throw new EYCTypeError(exp, "Objects may only have classes added or removed");
            exp.children.type.ctype = type;

            // And the mutation has to be allowed
            if (!ctx.mutatingThis)
                throw new EYCTypeError(stmt, "Illegal mutation");
            if (!ctx.mutating) {
                // Can only mutate "this"
                if (exp.children.expression.type !== "This")
                    throw new EYCTypeError(exp, "Illegal mutation");
            }

            break;
        }

        case "ExpStatement":
            typeCheckExpression(eyc, methodDecl, ctx, symbols, stmt.children.expression);
            break;

        default:
            throw new EYCTypeError(stmt, "Cannot type check " + stmt.type);
    }
}

// Type check an expression
function typeCheckExpression(eyc: types.EYC, methodDecl: types.MethodNode,
        ctx: CheckCtx, symbols: Record<string, types.TypeLike>, exp: types.Tree,
        opts: {autoType?: types.Type} = {}): types.TypeLike {
    // Basic likely checks
    let leftType, rightType, subExpType, resType: types.TypeLike;
    if (exp.children.left)
        leftType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.left);
    if (exp.children.right)
        rightType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.right);
    if (exp.children.expression)
        subExpType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);

    switch (exp.type) {
        case "AssignmentExp":
            leftType = typeCheckLValue(eyc, methodDecl, ctx, symbols, exp.children.target, {mutating: exp.children.op !== "="});
            rightType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.value, {autoType: leftType});
            resType = leftType;

            if (exp.children.op === "=") {
                resType = rightType;
                if (!rightType.equals(leftType, {subtype: true}))
                    throw new EYCTypeError(exp, "Invalid assignment");

            } else if (exp.children.op === "+=") {
                switch (leftType.type) {
                    case "array":
                        if (!rightType.equals((<types.ArrayType> leftType).valueType, {subtype: true}))
                            throw new EYCTypeError(exp, "Invalid array expansion");
                        break;

                    case "set":
                        if (!rightType.equals((<types.SetType> leftType).valueType, {subtype: true}))
                            throw new EYCTypeError(exp, "Invalid set addition");
                        break;

                    case "num":
                    case "string":
                        if (!leftType.equals(rightType))
                            throw new EYCTypeError(exp, "Invalid +=");
                        break;

                    default:
                        throw new EYCTypeError(exp, "Cannot use += on " + leftType.type);
                }

            } else if (exp.children.op === "-=") {
                switch (leftType.type) {
                    case "map":
                        if (!rightType.equals((<types.MapType> leftType).keyType, {subtype: true}))
                            throw new EYCTypeError(exp, "Invalid map removal");
                        break;

                    case "set":
                        if (!rightType.equals((<types.SetType> leftType).valueType, {subtype: true}))
                            throw new EYCTypeError(exp, "Invalid set removal");
                        break;

                    case "num":
                        if (!leftType.equals(rightType))
                            throw new EYCTypeError(exp, "Invalid -=");
                        break;

                    default:
                        throw new EYCTypeError(exp, "Cannot use -= on " + leftType.type);
                }

            } else {
                if (!leftType.isNum || !rightType.isNum)
                    throw new EYCTypeError(exp, "Only numbers are valid for " + exp.children.op);

            }
            break;

        case "OrExp":
        case "AndExp":
            resType = eyc.boolType;
            break;

        case "EqExp":
            if (!leftType.equals(rightType, {castable: true}))
                throw new EYCTypeError(exp, "Incomparable types");
            resType = eyc.boolType;
            break;

        case "RelExp":
            if (exp.children.op === "in") {
                let elType;
                if (rightType.isSet || rightType.isArray)
                    elType = (<types.SetType & types.ArrayType> rightType).valueType;
                else if (rightType.isMap)
                    elType = (<types.MapType> rightType).keyType;
                else
                    throw new EYCTypeError(exp, "\"in\" is only valid on collections");
                if (!leftType.equals(elType, {subtype: true}))
                    throw new EYCTypeError(exp, "Left type is not element type of collection");

            } else if (exp.children.op === "is") {
                if (!leftType.isObject)
                    throw new EYCTypeError(exp, "Only objects may be instances");
                if (!rightType.isClass)
                    throw new EYCTypeError(exp, "Invalid instance-of check");

            } else {
                if (!leftType.equals(rightType, {castable: true}))
                    throw new EYCTypeError(exp, "Attempt to compare unequal types");
                if (leftType.isSuggestion)
                    throw new EYCTypeError(exp, "Suggestions are not comparable");

            }
            resType = eyc.boolType;
            break;

        case "AddExp":
            if (leftType.isNum && rightType.isNum) {
                resType = leftType;
            } else if (exp.children.op === "+") {
                if ((leftType.isArray && leftType.equals(rightType)) ||
                    (leftType.isString && rightType.isString) ||
                    (leftType.isSuggestion && rightType.isSuggestion))
                    resType = leftType;
            }

            if (!resType)
                throw new EYCTypeError(exp, "Cannot add these types");
            break;

        case "MulExp":
            if (!leftType.isNum || !rightType.isNum)
                throw new EYCTypeError(exp, exp.children.op + " is only valid on numbers");
            resType = leftType;
            break;

        case "UnExp":
            switch (exp.children.op) {
                case "-":
                    if (!subExpType.isNum)
                        throw new EYCTypeError(exp, "Only numbers may be negated");
                    resType = eyc.numType;
                    break;

                case "!":
                    // All child types are valid
                    resType = eyc.boolType;
                    break;

                default:
                    throw new EYCTypeError(exp, "No UnExp type checker for " + exp.children.op);
            }
            break;

        case "PostIncExp":
        case "PostDecExp":
            typeCheckLValue(eyc, methodDecl, ctx, symbols, exp.children.expression);
            if (!subExpType.isNum)
                throw new EYCTypeError(exp, "Increment/decrement is only valid on numbers");
            resType = subExpType;
            break;

        case "CastExp":
        {
            const targetType = typeNameToType(eyc, methodDecl.module.parsed, exp.children.type);

            // Anything can be coerced to a string
            if (!targetType.isString) {
                if (!subExpType.equals(targetType, {castable: true}))
                    throw new EYCTypeError(exp, "Incompatible types");
            }

            resType = targetType;
            break;
        }

        case "SuperCall":
            // The method is ourself
            // FIXME: Check whether the super actually exists
            subExpType = methodDecl.signature;

            // Intentional fallthrough

        case "CallExp":
        {
            const signature = <types.Method> subExpType;
            if (!signature.isMethod)
                throw new EYCTypeError(exp, "Attempt to call a non-method as a method");
            if (exp.type === "CallExp" && exp.children.expression.type !== "DotExp")
                throw new EYCTypeError(exp, "Methods are only accessible through .x syntax");

            if (!ctx.mutating) {
                if (!ctx.mutatingThis) {
                    // No mutation allowed
                    if (signature.mutatingThis)
                        throw new EYCTypeError(exp, "Attempt to call mutating method from non-mutating context");

                } else {
                    // Only mutating this with the same this is allowed
                    if (signature.mutating)
                        throw new EYCTypeError(exp, "Attempt to call mutating method from mutating this context");

                    if (signature.mutatingThis) {
                        // This is only allowed if it's super or this.something
                        if (exp.type !== "SuperCall" &&
                            (exp.children.expression.type !== "DotExp" ||
                             exp.children.expression.children.expression.type !== "This")) {
                            throw new EYCTypeError(exp, "A mutating this method may only call another mutating this method with the same this");
                        }

                    }

                }

            }

            const args = exp.children.args ? exp.children.args.children : [];
            if (signature.paramTypes.length !== args.length)
                throw new EYCTypeError(exp, "Incorrect number of arguments");

            // Check all the argument types
            for (let ai = 0; ai < args.length; ai++) {
                const argType = typeCheckExpression(eyc, methodDecl, ctx, symbols, args[ai], {autoType: signature.paramTypes[ai]});
                if (!argType.equals(signature.paramTypes[ai], {subtype: true}))
                    throw new EYCTypeError(exp.children.args.children[ai], "Argument " + (ai+1) + " of incorrect type");
            }

            // The call was correct
            resType = signature.retType;
            break;
        }

        case "IndexExp":
        {
            const idxType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.index);

            if (subExpType.isArray) {
                if (!idxType.isNum)
                    throw new EYCTypeError(exp, "Array index must be a number");

                resType = (<types.ArrayType> subExpType).valueType;

            } else if (subExpType.isTuple) {
                const tupleType = <types.TupleType> subExpType;

                // Index must be a *literal*
                let idx = exp.children.index;
                if (idx.type === "DecLiteral")
                    idx = +idx.children.text;
                else if (idx.type === "HexLiteral")
                    idx = parseInt(idx.children.text, 16);
                else
                    throw new EYCTypeError(exp, "Index of tuple must be a literal");

                if (~~idx !== idx || idx < 0 || idx >= tupleType.valueTypes.length)
                    throw new EYCTypeError(exp, "Index out of bounds");
                exp.children.idx = idx;

                resType = tupleType.valueTypes[idx];

            } else if (subExpType.isMap) {
                const mapType = <types.MapType> subExpType;
                if (!idxType.equals(mapType.keyType, {subtype: true}))
                    throw new EYCTypeError(exp, "Invalid map index type");
                resType = mapType.valueType;

            } else if (subExpType.isSet) {
                if (!idxType.equals((<types.SetType> subExpType).valueType, {subtype: true}))
                    throw new EYCTypeError(exp, "Invalid set index type");
                resType = eyc.boolType;

            } else if (subExpType.isString) {
                if (!idxType.isNum)
                    throw new EYCTypeError(exp, "String index must be a number");

                resType = eyc.stringType;

            } else if (subExpType.isSpritesheet) {
                if (!idxType.isString)
                    throw new EYCTypeError(exp, "Spritesheet index must be a string");
                resType = eyc.stringType;

            } else {
                throw new EYCTypeError(exp, "Cannot type check index of " + subExpType.type);

            }
            break;
        }

        case "SuggestionExtendExp":
            if (!subExpType.isSuggestion)
                throw new EYCTypeError(exp, "Can only add suggestions to suggestions");
            typeCheckSuggestions(eyc, methodDecl, ctx, symbols, exp.children.suggestions);
            resType = eyc.suggestionType;
            break;

        case "DotExp":
        {
            const name = exp.children.id.children.text;

            if (subExpType.isArray || subExpType.isSet || subExpType.isMap || subExpType.isString) {
                // Collection types only accept "length"
                if (exp.children.id.children.text !== "length")
                    throw new EYCTypeError(exp, "Collections do not have fields");
                resType = eyc.numType;
                break;

            } else if (subExpType.isModule) {
                const sModule = <types.Module> subExpType;

                // Look for an export
                if (!(name in sModule.parsed.exports))
                    throw new EYCTypeError(exp, "No such export");
                resType = sModule.parsed.exports[name].ctype; // FIXME: Always set?
                break;

            } else if (subExpType.isClass) {
                const klass = <types.EYCClass> subExpType;

                // Allowed to use any method as a static method
                if (!(name in klass.methodTypes))
                    throw new EYCTypeError(exp, "No such method");
                resType = klass.methodTypes[name];
                break;

            }

            if (!subExpType.isObject)
                throw new EYCTypeError(exp, "Cannot get a member of a non-object type");

            // Try to find the member
            const klass = (<types.EYCObjectType> subExpType).instanceOf;
            if (name in klass.methodTypes)
                resType = klass.methodTypes[name];
            else if (name in klass.fieldTypes)
                resType = klass.fieldTypes[name];
            else
                throw new EYCTypeError(exp, "Cannot find field " + name);
            break;
        }

        case "SuggestionLiteral":
        {
            // The suggestion literal itself is always a suggestion
            resType = eyc.suggestionType;

            // But, the suggestion elements have to type check
            typeCheckSuggestions(eyc, methodDecl, ctx, symbols, exp.children.suggestions);
            break;
        }

        case "NewExp":
        {
            if (exp.children.type)
                resType = typeNameToType(eyc, methodDecl.module.parsed, exp.children.type);
            else if (opts.autoType)
                resType = opts.autoType;
            else
                throw new EYCTypeError(exp, "Cannot infer type for new in this context");

            if (exp.children.prefix) {
                const prefixType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.prefix);
                if (!prefixType.isString)
                    throw new EYCTypeError(exp, "Non-string prefix");
            }

            if (exp.children.withBlock) {
                const withSymbols = Object.create(symbols);
                const withCtx = {
                    mutating: ctx.mutating,
                    mutatingThis: true
                };
                withSymbols["this"] = resType;
                typeCheckStatement(eyc, methodDecl, withCtx, withSymbols, exp.children.withBlock);
            }

            break;
        }

        case "This":
            resType = <types.Type> symbols["this"]; // this is always the instance type of the class
            break;

        case "JavaScriptExpression":
            if (!methodDecl.module.ctx.privileged)
                throw new EYCTypeError(exp, "JavaScript expression in unprivileged context");
            if (exp.children.pass) {
                for (const c of exp.children.pass.children)
                    typeCheckExpression(eyc, methodDecl, ctx, symbols, c.children.initializer || c.children.id);
            }
            resType = typeNameToType(eyc, exp.module.parsed, exp.children.type);
            break;

        case "Suggestion":
        {
            console.log(exp);
            throw new Error;
            /*
            const ltype = typeCheckExpression(eyc, methodDecl, symbols, exp.children.target);
            const op = exp.children.op;
            const isMember = (exp.children.target.type === "DotExp" ||
                            exp.children.target.type === "IndexExp");
            let ttype;
            resType = subExpType;

            switch (op) {
                case "+":
                    switch (ltype.type) {
                        case "num":
                            if (!isMember)
                                throw new EYCTypeError(exp, "Numeric addition is only valid for field suggestions");
                            ttype = "field";
                            if (!subExpType.isNum)
                                throw new EYCTypeError(exp, "Invalid addition");
                            break;

                        default:
                            throw new EYCTypeError(exp, "No type checker for suggestion +" + ltype.type);
                    }
                    break;

                default:
                    throw new EYCTypeError(exp, "No type checker for suggestion op " + op);
            }

            exp.ttype = ttype;
            */
            break;
        }

        case "NullLiteral":
            if (opts.autoType && opts.autoType.isNullable)
                resType = opts.autoType;
            else
                resType = eyc.nullType;
            break;

        case "HexLiteral":
        case "B64Literal":
        case "DecLiteral":
            resType = eyc.numType;
            break;

        case "StringLiteral":
            try {
                JSON.parse(exp.children.text);
            } catch (ex) {
                throw new EYCTypeError(exp, "Invalid string literal");
            }
            resType = eyc.stringType;
            break;

        case "BoolLiteral":
            resType = eyc.boolType;
            break;

        case "ArrayLiteral":
        {
            const elTypes = exp.children.elements.children.map((c: types.Tree) => typeCheckExpression(eyc, methodDecl, ctx, symbols, c));
            if (elTypes.length === 0)
                throw new EYCTypeError(exp, "Empty array literals do not have a type. Use 'new'.");
            const elType = elTypes[0];
            for (let ei = 1; ei < elTypes.length; ei++) {
                // FIXME: mutual supertype
                if (!elType.equals(elTypes[ei]))
                    throw new EYCTypeError(exp, "Inconsistent element types");
            }
            resType = new eyc.ArrayType(elType);
            break;
        }

        case "TupleLiteral":
        {
            const elTypes = exp.children.elements.children.map((c: types.Tree) => typeCheckExpression(eyc, methodDecl, ctx, symbols, c));
            resType = new eyc.TupleType(elTypes);
            break;
        }

        case "ID":
        {
            const name = exp.children.text;
            if (!(name in symbols))
                throw new EYCTypeError(exp, "Undefined variable " + name);
            resType = symbols[name];
            break;
        }

        default:
            throw new EYCTypeError(exp, "Cannot type check " + exp.type);
    }

    exp.ctype = resType;
    return resType;
}

/* Type check an L-value expression. Mostly concerned with mutation, as
 * typeCheckExpression gets the actual type. */
function typeCheckLValue(eyc: types.EYC, methodDecl: types.MethodNode,
        ctx: CheckCtx, symbols: Record<string, types.TypeLike>, exp: types.Tree,
        opts: {mutating?: boolean} = {}): types.Type {
    switch (exp.type) {
        case "IndexExp":
        {
            if (!ctx.mutatingThis)
                throw new EYCTypeError(exp, "Illegal mutation");

            if (!ctx.mutating) {
                // Only this[...] = ... is allowed
                if (opts.mutating || exp.children.expression.type !== "This")
                    throw new EYCTypeError(exp, "Illegal mutation");
            }

            // Set elements aren't really things, so they're not mutable
            const subExpType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);
            if (subExpType.isSet)
                throw new EYCTypeError(exp, "Sets cannot be modified with assignment");

            break;
        }

        case "DotExp":
        {
            if (!ctx.mutatingThis)
                throw new EYCTypeError(exp, "Illegal mutation");

            // Non-objects expose some "fields" such as length, but they're not mutable
            const subExpType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);
            if (!subExpType.isObject)
                throw new EYCTypeError(exp, "Only objects have mutable fields");

            /* Mutation *of* the value is only allowed if we're a mutating
             * function, or it's a primitive member of this */
            if (opts.mutating && !ctx.mutating) {
                const retType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp);
                if (exp.children.expression.type !== "This" || !retType.isPrimitive)
                    throw new EYCTypeError(exp, "Illegal mutation");
            }

            break;
        }

        case "This":
        {
            if (!opts.mutating)
                throw new EYCTypeError(exp, "Illegal mutation");

            const thisType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp);
            if (thisType.isPrimitive)
                throw new EYCTypeError(exp, "Illegal mutating");

            /* This is the only circumstance under which modifying 'this' is
             * valid: this is a set, and this += or this -= */
            if (!ctx.mutatingThis)
                throw new EYCTypeError(exp, "Illegal mutation");
            break;
        }

        case "ID":
        {
            if (opts.mutating) {
                const retType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp);
                if (!retType.isPrimitive) {
                    // We're mutating the object in this L-Value, rather than changing the variable itself
                    if (!ctx.mutating)
                        throw new EYCTypeError(exp, "Illegal mutation");
                }
            }

            const name = exp.children.text;
            if (!(name in symbols))
                throw new EYCTypeError(exp, "Undefined variable " + name);
            const type = symbols[name];
            if (type.type === "ClassDecl")
                throw new EYCTypeError(exp, "Not an assignable variable");
            break;
        }

        default:
            throw new EYCTypeError(exp, "Not a valid L-value: " + exp.type);
    }

    const ret = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp);
    if (!ret.isType) {
        // Can't assign to a class or method
        throw new EYCTypeError(exp, "Not a valid L-value: " + ret.type);
    }
    return <types.Type> ret;
}

// Type check a list of suggestions
function typeCheckSuggestions(eyc: types.EYC, methodDecl: types.MethodNode,
        ctx: CheckCtx, symbols: Record<string, types.TypeLike>,
        suggestions: types.Tree[]) {
    for (const suggestion of suggestions) {
        typeCheckSuggestion(eyc, methodDecl, ctx, symbols, suggestion);
    }
}

// Type check a single suggestion
function typeCheckSuggestion(eyc: types.EYC, methodDecl: types.MethodNode,
        ctx: CheckCtx, symbols: Record<string, types.TypeLike>,
        suggestion: types.Tree) {
    switch (suggestion.type) {
        case "ExtendStatement":
        case "RetractStatement":
        {
            // It has to be a cast expression
            const exp = suggestion.children.expression;
            if (exp.type !== "CastExp")
                throw new EYCTypeError(suggestion, "Invalid extension/retraction statement");

            // The cast's subexpression has the same mutation restrictions as we do
            typeCheckExpression(eyc, methodDecl, ctx, symbols, exp);

            // But the whole statement can mutate
            typeCheckStatement(eyc, methodDecl, {mutating: true, mutatingThis: true}, symbols, suggestion);
            break;
        }

        case "ExpStatement":
        {
            // It has to be a method call
            const exp = suggestion.children.expression;
            if (exp.type !== "CallExp")
                throw new EYCTypeError(suggestion, "Only method calls and extensions/retractions may be suggestions");

            // We have to type-check each of the children with normal mutation rules
            typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);
            for (const arg of (exp.children.args ? exp.children.args.children : []))
                typeCheckExpression(eyc, methodDecl, ctx, symbols, arg);

            // But the whole expression is allowed to mutate
            typeCheckStatement(eyc, methodDecl, {mutating: true, mutatingThis: true}, symbols, suggestion);
            break;
        }

        default:
            throw new EYCTypeError(suggestion, "Cannot type check suggestion " + suggestion.type);
    }
}

// Given a type declaration, convert it into an EYC type, possibly doing typechecking to achieve this
function typeNameToType(eyc: types.EYC, ctx: types.ModuleNode, decl: types.Tree): types.Type {
    switch (decl.type) {
        case "TypeSet":
            return new eyc.SetType(typeNameToType(eyc, ctx, decl.children.type));

        case "TypeArray":
            return new eyc.ArrayType(typeNameToType(eyc, ctx, decl.children.type));

        case "TypeTuple":
        {
            const elTypes = decl.children.types.children.map((type: types.Tree) => {
                return typeNameToType(eyc, ctx, type);
            });
            return new eyc.TupleType(elTypes);
        }

        case "TypeMap":
        {
            const keyType = typeNameToType(eyc, ctx, decl.children.keyType);
            const valueType = typeNameToType(eyc, ctx, decl.children.valueType);
            return new eyc.MapType(keyType, valueType);
        }

        case "TypeNum":
            return eyc.numType;

        case "TypeString":
            return eyc.stringType;

        case "TypeBool":
            return eyc.boolType;

        case "TypeSuggestion":
            return eyc.suggestionType;

        case "TypeVoid":
            return eyc.voidType;

        case "TypeName":
        {
            const resolved = <types.ClassNode> resolveName(eyc, ctx, decl.children.name);
            if (resolved.type !== "ClassDecl")
                throw new EYCTypeError(decl, "Type name does not name a type");
            if (!resolved.itype)
                resolveClassDeclTypes(eyc, resolved);
            return resolved.itype;
        }

        default:
            throw new EYCTypeError(decl, "Cannot get type for " + decl.type);
    }
}

// Resolve a name to its defining declaration
function resolveName(eyc: types.EYC, module: types.ModuleNode, name: types.Tree) {
    let cur = null;

    // Step one: Start from the base name
    {
        const start = name.children[0].children.text;
        if (start in module.symbols)
            cur = module.symbols[start];
        else
            throw new EYCTypeError(name, "Symbol " + start + " not found");
    }

    // Step two: Take steps
    for (let ni = 1; ni < name.children.length; ni++) {
        const step = name.children[ni].children.text;
        switch (cur.type) {
            case "Module":
            {
                // Check its exports
                const curM = <types.ModuleNode> cur;
                if (!(step in curM.exports))
                    throw new EYCTypeError(name.children[ni], "Name " + step + " not found in module");
                cur = curM.exports[step];
                break;
            }

            default:
                throw new EYCTypeError(name.children[ni], "Cannot look up names in a " + cur.type);
        }
    }

    return cur;
}

// Compile this module
function compileModule(eyc: types.EYC, module: types.Module) {
    // There is only one kind of global variable that actually has a value: Fabrics
    const symbols: Record<string, string> = Object.create(null);
    for (const s in module.parsed.symbols) {
        const v = module.parsed.symbols[s];
        if (v.type === "FabricDecl")
            symbols[s] = (<types.FabricNode> v).fabric.compile();
    }

    for (const c of module.parsed.children) {
        switch (c.type) {
            case "ClassDecl":
                new ClassCompilationState(eyc, symbols, c).go();
                break;

            case "CopyrightDecl":
            case "LicenseDecl":
            case "PrefixDecl":
            case "ImportDecl":
            case "AliasDecl":
            case "AliasStarDecl":
            case "SpriteSheetDecl":
            case "SoundSetDecl":
            case "FabricDecl":
                // No code
                break;

            default:
                throw new EYCTypeError(c, "No compiler for " + c.type);
        }
    }
}

// State while compiling a class
class ClassCompilationState {
    klass: types.EYCClass;

    constructor(public eyc: types.EYC, public symbols: Record<string, string>,
                public decl: types.ClassNode) {
        this.klass = decl.klass;
    }

    go() {
        for (const c of this.decl.children.members.children) {
            switch (c.type) {
                case "MethodDecl":
                    new MethodCompilationState(this, c).go();
                    break;

                case "FieldDecl":
                    compileFieldDecl(this, c);
                    break;

                default:
                    throw new EYCTypeError(c, "No compiler for " + c.type);
            }
        }
    }
}

// An SSA node
class SSA {
    target: string;
    skip: boolean;
    uses: number;
    lastUse: number;
    ex: any;
    stmts: string[];
    expr: string;

    constructor(public ctx: types.Tree, public type: string,
                public idx: number, public a1: number = -1,
                public a2: number = -1) {
        this.target = "$" + this.idx;
        this.skip = false;
        this.uses = 0;
        this.lastUse = idx;
        this.ex = null;
        this.stmts = [];
        this.expr = "";
    }

    // Mark this as used by another SSA node
    use(idx: number) {
        if (idx > this.lastUse)
            this.lastUse = idx;
    }

    /* Get an expression for an *argument* of this SSA node. Will pluck the
     * expression into the current node if nothing else between them is
     * outlined */
    arg(ir: SSA[], num: number = 1, tryInline: boolean = true) {
        const a = (num === 2) ? this.a2 : this.a1;
        const ssa = ir[a];
        if (!tryInline || ssa.uses > 1)
            return ssa.target;

        // Try to inline it
        let inline = true;
        for (let i = a + 1; i < this.idx; i++) {
            if (!ir[i].skip) {
                inline = false;
                break;
            }
        }
        if (inline) {
            const ssa = ir[a];
            ssa.skip = true;
            return ssa.expr;
        }
        return ssa.target;
    }
}

// A (partially) compiled L-expression
interface LExp {
    assg: SSA;
    val: SSA;
    patch: (number)=>void;
}

// State while compiling a method
class MethodCompilationState {
    vars: string[];
    varCtr: number;

    constructor(public ccs: ClassCompilationState,
                public decl: types.MethodNode) {
        this.vars = [];
        this.varCtr = 0;
    }

    go() {
        const ir: SSA[] = [];
        const symbols: Record<string, string> = Object.create(null);

        // Figure out the parameters
        const params: string[] = ["eyc", "self", "caller"];
        if (this.decl.children.params) {
            for (const param of this.decl.children.params.children) {
                const nm = param.children.id.children.text;
                const jsnm = "arg$$" + nm;
                params.push(jsnm);
                symbols[nm] = jsnm;
            }
        }

        // Compile to SSA
        this.compileSSA(ir, symbols, this.decl.children.body);

        // Compile to fragments
        this.compileFrag(ir);

        // And compile to JS
        //console.error(this.compileJS(ir, this.decl.signature.retType));
        this.ccs.klass.methods[this.decl.signature.id] = <types.CompiledFunction>
            Function(params.join(","),
                this.compileJS(ir, this.decl.signature.retType));
    }

    compileSSA(ir: SSA[], symbols: Record<string, string>, node: types.Tree): number {
        switch (node.type) {
            case "Block":
            {
                const s2 = Object.create(symbols);
                let last = ir.length;
                for (const c of node.children)
                    last = this.compileSSA(ir, s2, c);
                return last;
            }

            case "VarDecl":
            {
                // Go over each decl
                for (const d of node.children.decls.children) {
                    // Make a variable for it
                    const id = d.children.id.children.text;
                    const jsnm = id + "$" + (this.varCtr++);
                    this.vars.push(jsnm);

                    // And initialize it
                    let init: number;
                    if (d.children.initializer) {
                        // Explicit initializer
                        init = this.compileSSA(ir, symbols, d.children.initializer);
                    } else {
                        // Implicit initializer
                        init = ir.length;
                        ir.push(new SSA(d, "default", ir.length));
                    }
                    const ssa = new SSA(d, "var-assign", ir.length, init);
                    ssa.ex = jsnm;
                    ir.push(ssa);

                    symbols[id] = jsnm;
                }
                break;
            }

            case "IfStatement":
            {
                // Condition
                const cond = this.compileSSA(ir, symbols, node.children.condition);
                const bool = new SSA(node,
                    "bool-from-" + node.children.condition.ctype.type,
                    ir.length, cond);
                ir.push(bool);
                const iff = new SSA(node, "if", ir.length, bool.idx);
                ir.push(iff);

                // Then branch
                this.compileSSA(ir, Object.create(symbols), node.children.ifStatement);
                ir.push(new SSA(node, "fi", ir.length, iff.idx));

                // Else branch if applicable
                if (node.children.elseStatement) {
                    ir.push(new SSA(node, "else", ir.length, iff.idx));
                    this.compileSSA(ir, Object.create(symbols), node.children.elseStatement);
                    ir.push(new SSA(node, "esle", ir.length, iff.idx));
                }
                break;
            }

            case "ForStatement":
            {
                const s2 = Object.create(symbols);

                // Initialize
                if (node.children.initializer)
                    this.compileSSA(ir, s2, node.children.initializer);

                // Begin the loop
                const loop = new SSA(node, "loop", ir.length);
                ir.push(loop);

                // Condition
                if (node.children.condition) {
                    const c = this.compileSSA(ir, s2, node.children.condition);
                    const cf = new SSA(node, "not-" + node.children.condition.ctype.type, ir.length, c);
                    ir.push(cf);
                    ir.push(new SSA(node, "break", ir.length, cf.idx));
                }

                // Body
                this.compileSSA(ir, s2, node.children.body);

                // Increment
                if (node.children.increment)
                    this.compileSSA(ir, s2, node.children.increment);

                // And loop
                ir.push(new SSA(node, "pool", ir.length, loop.idx));
                break;
            }

            case "ForInStatement":
            {
                // FIXME: reverse
                // First, get what we're looping over
                const coll = this.compileSSA(ir, symbols, node.children.collection);

                // Possibly declare the variable
                const s2 = Object.create(symbols);
                if (node.children.type) {
                    const nm = node.children.id.children.text;
                    const jsnm = nm + "$" + (this.varCtr++);
                    this.vars.push(jsnm);
                    s2[nm] = jsnm;
                }

                // How to loop over it depends on the type
                let loopHead: SSA;
                switch (node.children.collection.ctype.type) {
                    case "array":
                        loopHead = new SSA(node, "for-in-array", ir.length, coll);
                        ir.push(loopHead);
                        break;

                    case "set":
                    {
                        let op: string;

                        // Special case for sets of tuples
                        if ((<types.SetType> node.children.collection.ctype).valueType.isTuple) {
                            op = "set-tuple-values-array";
                        } else {
                            op = "set-values-array";
                        }

                        const loopArr = new SSA(node, op, ir.length, coll);
                        ir.push(loopArr);
                        loopHead = new SSA(node, "for-in-array", ir.length, loopArr.idx);
                        ir.push(loopHead);
                        break;
                    }

                    case "string":
                        loopHead = new SSA(node, "for-in-string", ir.length, coll);
                        ir.push(loopHead);
                        break;

                    default:
                        throw new EYCTypeError(node, "No compiler for for-in " + node.children.collection.ctype.type);
                }
                loopHead.ex = s2[node.children.id.children.text];

                // Then the body
                this.compileSSA(ir, s2, node.children.body);

                // Then end it
                ir.push(new SSA(node, "ni-rof", ir.length, loopHead.idx));
                break;
            }

            case "ForInMapStatement":
            {
                // FIXME: reverse
                // First, get what we're looping over
                const coll = this.compileSSA(ir, symbols, node.children.collection);

                // Possibly declare the variable
                const s2 = Object.create(symbols);
                if (node.children.keyType) {
                    const nm = node.children.key.children.text;
                    const jsnm = nm + "$" + (this.varCtr++);
                    this.vars.push(jsnm);
                    s2[nm] = jsnm;
                }
                if (node.children.valueType) {
                    const nm = node.children.value.children.text;
                    const jsnm = nm + "$" + (this.varCtr++);
                    this.vars.push(jsnm);
                    s2[nm] = jsnm;
                }
                const keyNm = s2[node.children.key.children.text];
                const valNm = s2[node.children.value.children.text];

                // How to loop over it depends on the type
                let loopHead: SSA;
                const ctype = node.children.collection.ctype.type;
                switch (ctype) {
                    case "array":
                    case "string":
                    {
                        // Loop over the indices
                        loopHead = new SSA(node, "for-in-" + ctype + "-idx", ir.length, coll);
                        loopHead.ex = keyNm;
                        ir.push(loopHead);

                        // Then extract the values
                        const varr = new SSA(node, "var", ir.length);
                        varr.ex = keyNm;
                        ir.push(varr);
                        const getter = new SSA(node.children.value, ctype + "-index",
                            ir.length, coll, varr.idx);
                        ir.push(getter);
                        const setter = new SSA(node, "var-assign", ir.length, getter.idx);
                        setter.ex = valNm;
                        ir.push(setter);

                        break;
                    }

                    case "map":
                    {
                        // Special case for maps of tuples
                        if ((<types.MapType> node.children.collection.ctype).keyType.isTuple) {
                            throw new EYCTypeError(node, "No compiler for two-variable for-in map of tuple");
                        }

                        const loopArr = new SSA(node.children.collection,
                            "map-keys-array", ir.length, coll);
                        ir.push(loopArr);

                        // Loop over the keys
                        loopHead = new SSA(node, "for-in-array", ir.length, loopArr.idx);
                        loopHead.ex = keyNm;
                        ir.push(loopHead);

                        // Then extract the values
                        const varr = new SSA(node, "var", ir.length);
                        varr.ex = keyNm;
                        ir.push(varr);
                        const getter = new SSA(node.children.value, "map-get",
                            ir.length, coll, varr.idx);
                        ir.push(getter);
                        const setter = new SSA(node, "var-assign", ir.length, getter.idx);
                        setter.ex = valNm;
                        ir.push(setter);
                        break;
                    }

                    default:
                        throw new EYCTypeError(node, "No compiler for two-variable for-in " + node.children.collection.ctype.type);
                }

                // Then the body
                this.compileSSA(ir, s2, node.children.body);

                // Then end it
                ir.push(new SSA(node, "ni-rof", ir.length, loopHead.idx));
                break;
            }

            case "ReturnStatement":
            {
                const c = this.compileSSA(ir, symbols, node.children.value);
                ir.push(new SSA(node, "return", ir.length, c));
                break;
            }

            case "ExtendStatement":
            case "RetractStatement":
            {
                const c = this.compileSSA(ir, symbols, node.children.expression.children.expression);
                const ex = new SSA(node,
                    (node.type === "RetractStatement") ? "retract" : "extend",
                    ir.length, c);
                ex.ex = node.children.expression.children.type.ctype;
                ir.push(ex);
                break;
            }

            case "ExpStatement":
                return this.compileSSA(ir, symbols, node.children.expression);

            case "AssignmentExp":
            {
                const target = this.compileLExp(ir, symbols, node.children.target);

                // Special op case for sets
                if (node.children.target.ctype.isSet && node.children.op !== "=") {
                    const setType = <types.SetType> node.children.target.ctype;

                    // Adding or removing from a set
                    let op = "";
                    if (setType.valueType.isTuple) {
                        if (node.children.op === "-=")
                            op = "set-tuple-delete";
                        else
                            op = "set-tuple-add";
                    } else {
                        if (node.children.op === "-=")
                            op = "set-delete";
                        else
                            op = "set-add";
                    }

                    const tv = target.val;
                    tv.idx = ir.length;
                    ir.push(tv);
                    const value = this.compileSSA(ir, symbols, node.children.value);
                    ir.push(new SSA(node, op, ir.length, tv.idx, value));
                    return tv.idx;

                } else if (node.children.target.ctype.isArray && node.children.op === "+=") {
                    // And for array concatenation
                    let op = "";
                    if (node.children.target.ctype.equals(node.children.value.ctype)) {
                        // array-array concatenation
                        op = "array-concatenate";
                    } else {
                        // array-element append
                        op = "array-append";
                    }

                    const tv = target.val;
                    tv.idx = ir.length;
                    ir.push(tv);
                    const value = this.compileSSA(ir, symbols, node.children.value);
                    ir.push(new SSA(node, op, ir.length, tv.idx, value));
                    return tv.idx;

                }

                let value: number;

                // Special case for non-= ops
                if (node.children.op !== "=") {
                    const l = node.children.target.ctype.type;
                    const r = node.children.value.ctype.type;
                    let op: string;
                    switch (node.children.op) {
                        case "*=": op = "mul"; break;
                        case "/=": op = "div"; break;
                        case "%=": op = "mod"; break;
                        case "+=": op = "add"; break;
                        case "-=": op = "sub"; break;
                    }
                    op = op + "-" + l + "-" + r;

                    // Get the value of the left
                    const tv = target.val;
                    tv.idx = ir.length;
                    ir.push(tv);

                    // Then the value of the right
                    const rv = this.compileSSA(ir, symbols, node.children.value);

                    // Then put them together
                    value = ir.length;
                    const cv = new SSA(node, op, value, tv.idx, rv);
                    cv.ex = node.children.op[0];
                    ir.push(cv);
                } else {
                    value = this.compileSSA(ir, symbols, node.children.value);
                }

                // Finally, assign
                target.patch(value);
                target.assg.idx = ir.length;
                ir.push(target.assg);
                return value;
            }

            case "UnExp":
            {
                let type = "";
                switch (node.children.op) {
                    case "-": type = "neg"; break;
                    case "!": type = "not"; break;
                    default:
                        throw new EYCTypeError(node, "No compiler for unary " + node.children.op);
                }
                const s = this.compileSSA(ir, symbols, node.children.expression);
                ir.push(new SSA(node,
                    type + "-" + node.children.expression.ctype.type,
                    ir.length, s
                ));
                break;
            }

            case "OrExp":
            case "AndExp":
            {
                // Because of short-circuiting, these need to be rewritten as conditions
                const target = "$ss$" + (this.varCtr++);
                this.vars.push(target);

                // Left
                const l = this.compileSSA(ir, symbols, node.children.left);

                // Short circuit long case
                let iff: SSA;
                if (node.children.op === "||") {
                    // Only pass if it's false
                    const not = new SSA(node,
                        "not-" + node.children.left.ctype.type, ir.length, l);
                    ir.push(not);
                    iff = new SSA(node, "if", ir.length, not.idx);
                    ir.push(iff);

                } else { // &&
                    // Only pass if it's true
                    const bool = new SSA(node,
                        "bool-from-" + node.children.left.ctype.type,
                        ir.length, l);
                    ir.push(bool);
                    iff = new SSA(node, "if", ir.length, bool.idx);
                    ir.push(iff);

                }

                // Right
                const r = this.compileSSA(ir, symbols, node.children.right);
                const boolr = new SSA(node,
                    "bool-from-" + node.children.right.ctype.type, ir.length,
                    r);
                ir.push(boolr);

                // Set the result
                const set = new SSA(node, "var-assign", ir.length, boolr.idx);
                set.ex = target;
                ir.push(set);

                // Short circuit short case
                ir.push(new SSA(node, "fi", ir.length, iff.idx));
                ir.push(new SSA(node, "else", ir.length, iff.idx));
                const booll = new SSA(node,
                    "bool-from-" + node.children.left.ctype.type, ir.length,
                    l);
                ir.push(booll);
                const set2 = new SSA(node, "var-assign", ir.length, booll.idx);
                set2.ex = target;
                ir.push(set2);
                ir.push(new SSA(node, "esle", ir.length, iff.idx));

                // And retrieve the value
                const varr = new SSA(node, "var", ir.length);
                varr.ex = target;
                ir.push(varr);
                break;
            }

            case "EqExp":
            case "RelExp":
            case "AddExp":
            case "MulExp":
            {
                let op: string;
                switch (node.children.op) {
                    case "==": op = "eq"; break;
                    case "!=": op = "ne"; break;
                    case "<=": op = "le"; break;
                    case "<": op = "lt"; break;
                    case ">=": op = "ge"; break;
                    case ">": op = "gt"; break;
                    case "in": op = "in"; break;
                    case "is": op = "is"; break;
                    case "+": op = "add"; break;
                    case "-": op = "sub"; break;
                    case "*": op = "mul"; break;
                    case "/": op = "div"; break;
                    case "%": op = "mod"; break;
                    default: throw new Error(node.children.op); // Should never be reached
                }

                const l = this.compileSSA(ir, symbols, node.children.left);
                const r = this.compileSSA(ir, symbols, node.children.right);
                ir.push(new SSA(node,
                    op + "-" +
                    node.children.left.ctype.type + "-" +
                    node.children.right.ctype.type,
                    ir.length, l, r
                ));
                break;
            }

            case "CastExp":
            {
                if (node.ctype.isString) {
                    // An actual coercion
                    const sub = this.compileSSA(ir, symbols, node.children.expression);
                    ir.push(new SSA(node,
                        "string-from-" + node.children.expression.ctype.type,
                        ir.length, sub));
                } else {
                    // Just pass thru
                    return this.compileSSA(ir, symbols, node.children.expression);
                }
                break;
            }

            case "PostIncExp":
            case "PostDecExp":
            {
                // The target is written to
                const target = this.compileLExp(ir, symbols, node.children.expression);

                // Get the value
                const tv = target.val;
                tv.idx = ir.length;
                ir.push(tv);

                // Add/subtract one
                const one = new SSA(node, "compile-time-literal", ir.length);
                one.ex = "1";
                ir.push(one);
                const add = new SSA(node,
                    (node.children.op === "--") ? "sub-num-num" : "add-num-num",
                    ir.length, tv.idx, one.idx);
                add.ex = (node.children.op === "--") ? "-" : "+";
                ir.push(add);

                // Assign it
                target.patch(add.idx);
                target.assg.idx = ir.length;
                ir.push(target.assg);

                // Result is *pre* value
                return tv.idx;
            }

            case "SuperCall":
            {
                // Arguments
                const head = new SSA(node, "call-head", ir.length);
                ir.push(head);
                for (const c of node.children.args ? node.children.args.children : [])
                    ir.push(new SSA(node, "arg", ir.length, head.idx, this.compileSSA(ir, symbols, c)));

                // Then the call
                ir.push(new SSA(node, "call-call-super", ir.length, head.idx));
                break;
            }

            case "CallExp":
            {
                // First, the target
                const target = this.compileSSA(ir, symbols, node.children.expression.children.expression);

                // Then, the arguments
                const head = new SSA(node, "call-head", ir.length);
                ir.push(head);
                for (const c of node.children.args ? node.children.args.children : [])
                    ir.push(new SSA(node, "arg", ir.length, head.idx, this.compileSSA(ir, symbols, c)));

                // Then the call proper
                if (node.children.expression.children.expression.ctype.isClass) {
                    // Static method call
                    ir.push(new SSA(node, "call-call-static", ir.length, head.idx, target));
                } else {
                    // Standard method call
                    ir.push(new SSA(node, "call-call", ir.length, head.idx, target));
                }
                break;
            }

            case "IndexExp":
            {
                const target = this.compileSSA(ir, symbols, node.children.expression);
                const index = this.compileSSA(ir, symbols, node.children.index);

                switch (node.children.expression.ctype.type) {
                    case "array":
                    case "tuple":
                        ir.push(new SSA(node,
                            node.children.expression.ctype.type + "-index",
                            ir.length, target, index));
                        break;

                    case "map":
                    {
                        // Tuple case
                        let tuple = "";
                        if ((<types.MapType> node.children.expression.ctype).keyType.isTuple)
                            tuple = "-tuple";
                        ir.push(new SSA(node, "map" + tuple + "-get", ir.length, target, index));
                        break;
                    }

                    case "set":
                    {
                        // Tuple case
                        let tuple = "";
                        if ((<types.SetType> node.children.expression.ctype).valueType.isTuple)
                            tuple = "-tuple";
                        ir.push(new SSA(node, "set" + tuple + "-get", ir.length, target, index));
                        break;
                    }

                    default:
                        throw new EYCTypeError(node, "No compiler for index " + node.children.expression.ctype.type);
                }
                break;
            }

            case "SuggestionExtendExp":
            {
                const target = this.compileSSA(ir, symbols, node.children.expression);
                const sug = this.compileSuggestions(ir, symbols, node, node.children.suggestions);
                ir.push(new SSA(node, "add-suggestion-suggestion", ir.length, target, sug));
                break;
            }

            case "DotExp":
            {
                if (node.ctype.isClass) {
                    // Just get the class directly
                    const klass = new SSA(node, "class", ir.length);
                    klass.ex = node.ctype;
                    ir.push(klass);
                    break;
                }

                const target = this.compileSSA(ir, symbols, node.children.expression);
                const ttype = node.children.expression.ctype.type;
                switch (ttype) {
                    case "object":
                        ir.push(new SSA(node, "field", ir.length, target));
                        break;

                    case "array":
                    case "string":
                        // Must be length
                        console.assert(node.children.id.children.text === "length");
                        ir.push(new SSA(node, ttype + "-length", ir.length, target));
                        break;

                    default:
                        throw new EYCTypeError(node, "No compiler for dot " + ttype);
                }
                break;
            }

            case "SuggestionLiteral":
            {
                const sug = this.compileSuggestions(ir, symbols, node, node.children.suggestions);
                ir.push(new SSA(node, "suggestion-literal", ir.length, sug));
                break;
            }

            case "NewExp":
            {
                let ret: SSA;
                switch (node.ctype.type) {
                    case "object":
                    {
                        // The actual object creation
                        const neww = new SSA(node, "new-object", ir.length);
                        ir.push(neww);

                        // Then, we extend it
                        const ext = ret = new SSA(node, "extend", ir.length, neww.idx);
                        ext.ex = node.ctype;
                        ir.push(ext);
                        break;
                    }

                    case "set":
                        if ((<types.SetType> node.ctype).valueType.isTuple) {
                            // Sets of tuples are stored as maps
                            ret = new SSA(node, "new-map", ir.length);
                            ir.push(ret);
                            break;
                        }
                        // Intentional fallthrough

                    default:
                        ret = new SSA(node, "new-" + node.ctype.type, ir.length);
                        ir.push(ret);
                }

                // Now there may be a with block
                if (node.children.withBlock) {
                    ir.push(new SSA(node, "with", ir.length, ret.idx));
                    this.compileSSA(ir, symbols, node.children.withBlock);
                    ir.push(new SSA(node, "htiw", ir.length, ret.idx));
                }

                return ret.idx;
            }

            case "This":
                ir.push(new SSA(node, "this", ir.length));
                break;

            case "JavaScriptExpression":
            {
                // First, the arguments
                const params: string[] = [];
                const args: number[] = [];
                const head = new SSA(node, "javascript-head", ir.length);
                ir.push(head);
                for (const c of node.children.pass ? node.children.pass.children : []) {
                    const id = c.children.id.children.text;
                    params.push(id);
                    if (c.children.initializer) {
                        // Initialize to a set expression
                        const arg = this.compileSSA(ir, symbols, c.children.initializer);
                        args.push(ir.length);
                        ir.push(new SSA(node, "arg", ir.length, head.idx, arg));
                    } else {
                        // Just look up the name
                        if (!(id in symbols))
                            throw new EYCTypeError(c, "Undefined symbol " + id);
                        const jsnm = symbols[id];
                        const varr = new SSA(node, "var", ir.length);
                        varr.ex = jsnm;
                        ir.push(varr);
                        args.push(ir.length);
                        ir.push(new SSA(node, "arg", ir.length, head.idx, varr.idx));
                    }
                }

                // Now the actual code
                const ssa = new SSA(node, "javascript-call", ir.length, head.idx);
                ssa.ex = params;
                ir.push(ssa);
                break;
            }

            case "NullLiteral":
                ir.push(new SSA(node, "null", ir.length));
                break;

            case "HexLiteral":
                ir.push(new SSA(node, "hex-literal", ir.length));
                break;

            case "DecLiteral":
                ir.push(new SSA(node, "dec-literal", ir.length));
                break;

            case "StringLiteral":
                ir.push(new SSA(node, "string-literal", ir.length));
                break;

            case "TupleLiteral":
            {
                // Structurally similar to a call, just builds a tuple instead
                const head = new SSA(node, "tuple-literal-head", ir.length);
                ir.push(head);
                const args: number[] = [];
                for (const c of node.children.elements.children) {
                    const arg = this.compileSSA(ir, symbols, c);
                    args.push(ir.length);
                    ir.push(new SSA(node, "arg", ir.length, head.idx, arg));
                }
                ir.push(new SSA(node, "tuple-literal-tail", ir.length, head.idx));
                break;
            }

            case "ID":
            {
                const id = node.children.text;
                if (id in symbols) {
                    const ssa = new SSA(node, "var", ir.length);
                    ssa.ex = symbols[id];
                    ir.push(ssa);
                    break;
                }
                if (node.ctype.isClass) {
                    const ssa = new SSA(node, "class", ir.length);
                    ssa.ex = node.ctype;
                    ir.push(ssa);
                    break;
                }
                if (id in this.ccs.symbols) {
                    const l = new SSA(node, "compile-time-literal", ir.length);
                    l.ex = this.ccs.symbols[id];
                    ir.push(l);
                    break;
                }
                throw new EYCTypeError(node, "Undefined ID " + id);
            }

            default:
                console.error(node);
                throw new EYCTypeError(node, "No compiler for " + node.type);
        }

        return ir.length - 1;
    }

    // Compile a node as an l-expression
    compileLExp(ir: SSA[], symbols: Record<string, string>, node: types.Tree): LExp {
        switch (node.type) {
            case "IndexExp":
                switch (node.children.expression.ctype.type) {
                    case "map":
                    {
                        const mapType = <types.MapType> node.children.expression.ctype;

                        // Special case for tuple
                        let tuple = "";
                        if (mapType.keyType.isTuple)
                            tuple = "-tuple";

                        const target = this.compileSSA(ir, symbols, node.children.expression);
                        const index = this.compileSSA(ir, symbols, node.children.index);
                        const mapPair = new SSA(node, "map-pair", ir.length, target, index);
                        ir.push(mapPair);
                        const assg = new SSA(node, "map" + tuple + "-assign", -1, mapPair.idx);
                        const val = new SSA(node, "map" + tuple + "-get", -1, target, index);
                        return {
                            assg, val,
                            patch: (x) => {
                                assg.a2 = x;
                            }
                        };
                    }

                    default:
                        throw new EYCTypeError(node, "No compiler for l-expression index " + node.children.expression.ctype.type);
                }

            case "DotExp":
            {
                if (node.ctype.isClass) {
                    // Just get it directly
                    const val = new SSA(node, "class", -1);
                    val.ex = node.ctype;
                    return {
                        assg: null,
                        val: val,
                        patch: null
                    };
                } else {
                    const target = this.compileSSA(ir, symbols, node.children.expression);
                    const assg = new SSA(node, "field-assign", -1, target);
                    const val = new SSA(node, "field", -1, target);
                    return {
                        assg, val,
                        patch: (x) => {
                            assg.a2 = x;
                        }
                    };
                }
            }

            case "This":
                /* You can't actually change 'this', but it *can* be the LHS of
                 * certain assignments */
                return {
                    assg: null,
                    val: new SSA(node, "this", -1),
                    patch: null
                };

            case "ID":
            {
                const nm = node.children.text;
                if (!(nm in symbols))
                    throw new EYCTypeError(node, "Undefined variable " + nm);
                const jsnm = symbols[nm];
                const assg = new SSA(node, "var-assign", -1);
                assg.ex = jsnm;
                const val = new SSA(node, "var", -1);
                val.ex = jsnm;
                return {
                    assg, val,
                    patch: (x) => {
                        assg.a1 = x;
                    }
                };
            }

            default:
                throw new EYCTypeError(node, "No compiler for l-expression " + node.type);
        }
    }

    // Compile an array of suggestions
    compileSuggestions(ir: SSA[], symbols: Record<string, string>,
        parent: types.Tree, nodes: types.Tree[]): number {

        const head = new SSA(parent, "suggestion-head", ir.length);
        ir.push(head);

        for (const node of nodes) {
            const idx = this.compileSSA(ir, symbols, node);
            const ssa = ir[idx];

            // Transform it to a suggestion operation
            const type = ssa.type;
            ssa.type = "suggestion-" + type;

            // Then add the corresponding suggestion part
            ir.push(new SSA(node, "arg", ir.length, head.idx, idx));
        }

        ir.push(new SSA(parent, "suggestion-tail", ir.length, head.idx));

        return ir.length - 1;
    }

    compileFrag(ir: SSA[]) {
        // First count uses
        for (const ssa of ir) {
            if (ssa.a1 >= 0)
                ir[ssa.a1].uses++;
            if (ssa.a2 >= 0)
                ir[ssa.a2].uses++;
            if (ssa.type === "arg")
                ssa.uses++;
        }

        // Then compile fragments
        for (let iri = 0; iri < ir.length; iri++) {
            const ssa = ir[iri];
            ssa.target = "$" + ssa.idx;

            switch (ssa.type) {
                case "param":
                    ssa.expr = ssa.ex;
                    break;

                case "set-values-array":
                    ssa.expr = "(Array.from(" + ssa.arg(ir) +
                        ".values()).sort(eyc.cmp." +
                        (<types.SetType> ir[ssa.a1].ctx.ctype).valueType.type +
                        "))";
                    break;

                case "if":
                    ssa.skip = true;
                    ssa.stmts.push("if (" + ssa.arg(ir) + ") {\n");
                    break;

                case "else":
                    ssa.skip = true;
                    ssa.stmts.push("else {\n");
                    break;

                case "loop":
                    ssa.skip = true;
                    ssa.stmts.push("while (true) {\n");
                    break;

                case "break":
                    ssa.skip = true;
                    ssa.stmts.push("if (" + ssa.arg(ir) + ") break;\n");
                    break;

                case "for-in-array":
                case "for-in-string":
                {
                    const idx = "$$" + (this.varCtr++);
                    this.vars.push(idx);
                    const coll = ssa.arg(ir, 1, false);
                    ssa.skip = true;
                    ssa.stmts.push("for (" + idx + " = 0; " +
                        idx + " < " + coll + ".length; " +
                        idx + "++) {\n");
                    ssa.stmts.push(ssa.ex + " = " + coll + "[" + idx + "];\n");
                    break;
                }

                case "for-in-array-idx":
                case "for-in-string-idx":
                {
                    const idx = "$$" + (this.varCtr++);
                    this.vars.push(idx);
                    const coll = ssa.arg(ir, 1, false);
                    ssa.skip = true;
                    ssa.stmts.push("for (" + idx + " = 0; " +
                        idx + " < " + coll + ".length; " +
                        idx + "++) {\n");
                    ssa.stmts.push(ssa.ex + " = " + idx + ";\n");
                    break;
                }

                case "map-keys-array":
                {
                    /* NOTE: The resulting array is *not* an EYC array, and
                     * cannot be used as one! */
                    ssa.expr = "(Array.from(" + ssa.arg(ir) +
                        ".keys()).sort(eyc.cmp." +
                        (<types.MapType> ssa.ctx.ctype).keyType.type + "))";
                    break;
                }

                case "fi":
                case "esle":
                case "pool":
                case "ni-rof":
                    ssa.skip = true;
                    ssa.stmts.push("}\n");
                    // } } } make matching happy
                    break;

                case "return":
                    ssa.skip = true;
                    ssa.stmts.push("return " + ssa.arg(ir) + ";\n");
                    break;

                case "extend":
                case "retract":
                    ssa.expr = "(" + ssa.arg(ir) + "." + ssa.type + "(" +
                        JSON.stringify((<types.EYCObjectType> ssa.ex).instanceOf.prefix) +
                        "))";
                    break;

                case "suggestion-extend":
                case "suggestion-retract":
                    ssa.expr = "({action:" + JSON.stringify(ssa.type[11]) + "," +
                        "target:" + ssa.arg(ir) + "," +
                        "type:" +
                        JSON.stringify((<types.EYCObjectType> ssa.ex).instanceOf.prefix) +
                        "})";
                    break;

                case "array-append":
                {
                    const arr = ssa.arg(ir, 1, false);
                    ssa.expr = "(" + arr + ".push(" + ssa.arg(ir, 2) + ")," + arr + ")";
                    break;
                }

                case "map-assign":
                {
                    const val = ssa.arg(ir, 2, false);
                    // map-assign's target is actually a map-pair
                    const mapPair = ir[ssa.a1];
                    const idx = mapPair.arg(ir, 2);
                    const map = mapPair.arg(ir, 1);
                    ssa.expr = "(" + map + ".set(" + idx + "," + val + ")," + val + ")";
                    break;
                }

                case "map-tuple-assign":
                {
                    const val = ssa.arg(ir, 2, false);
                    const mapPair = ir[ssa.a1];
                    const idx = mapPair.arg(ir, 2, false);
                    const map = mapPair.arg(ir, 1);
                    ssa.expr = "(" + map + ".set(eyc.tupleStr(" + idx +
                        "),{key:" + idx + ",value:" + val + "})," + val + ")";
                    break;
                }

                case "set-add":
                {
                    const val = ssa.arg(ir, 2);
                    const set = ssa.arg(ir, 1, false);
                    ssa.expr = "(" + set + ".add(" + val + ")," + set + ")";
                    break;
                }

                case "set-delete":
                {
                    const val = ssa.arg(ir, 2);
                    const set = ssa.arg(ir, 1, false);
                    ssa.expr = "(" + set + ".delete(" + val + ")," + set + ")";
                    break;
                }

                case "in-object-map":
                {
                    const l = ssa.arg(ir, 1, false);
                    ssa.expr = "(" + ssa.arg(ir, 2) + ".has(" + l + "))";
                    break;
                }

                case "is-object-class":
                {
                    ssa.expr = "(!!(" + ssa.arg(ir, 1) +
                        ".type[" + ssa.arg(ir, 2) + "]))";
                    break;
                }

                case "eq-object-object":
                case "eq-object-null":
                case "eq-num-num":
                case "eq-string-string":
                case "ne-object-object":
                case "ne-object-null":
                case "ne-num-num":
                case "ne-string-string":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    const op = ssa.ctx.children.op;
                    ssa.expr = "(" + l + op + "=" + r + ")";
                    break;
                }

                case "gt-object-object":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    const op = ssa.ctx.children.op;
                    ssa.expr = "(" + l + ".id" + op + r + ".id)";
                    break;
                }

                case "lt-num-num":
                case "le-num-num":
                case "gt-num-num":
                case "ge-num-num":
                case "add-num-num":
                case "add-string-string":
                case "sub-num-num":
                case "mul-num-num":
                case "div-num-num":
                case "mod-num-num":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    const op = ssa.ex || ssa.ctx.children.op;
                    ssa.expr = "(" + l + op + r + ")";
                    break;
                }

                case "in-tuple-map":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    ssa.expr = "(" + r + ".has(eyc.tupleStr(" + l + ")))";
                    break;
                }

                case "add-suggestion-suggestion":
                {
                    const tmp = "$$" + (this.varCtr++);
                    this.vars.push(tmp);
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    ssa.expr = "(" + tmp + "=Array.prototype.concat.call(" +
                        l + "," + r + ")," +
                        tmp + '.id=self.prefix+"$"+eyc.freshId(),' +
                        tmp + ")";
                    break;
                }

                case "neg-num":
                    ssa.expr = "(-" + ssa.arg(ir) + ")";
                    break;

                case "not-bool":
                    ssa.expr = "(!" + ssa.arg(ir) + ")";
                    break;

                case "string-from-num":
                    ssa.expr = '(""+' + ssa.arg(ir) + ")";
                    break;

                case "call-call-super":
                case "call-call":
                case "call-call-static":
                {
                    // Find the head
                    const head = ssa.a1;

                    // Get the arguments
                    const args: string[] = [];
                    for (let j = iri - 1; j > head; j--) {
                        const sssa = ir[j];
                        if (sssa.type === "arg" && sssa.a1 === head)
                            args.unshift(sssa.arg(ir, 2, false));
                    }

                    if (ssa.type === "call-call-super") {
                        ssa.expr = "(this.proto." + this.decl.signature.id + "(eyc,self,self" +
                            (args.length?","+args.join(","):"") +
                            "))";

                    } else {
                        // Get the target
                        const target = ssa.arg(ir, 2, false);
                        const meth = ssa.ctx.children.expression.ctype.id;

                        // And perform the call
                        ssa.expr = "(" + target + ".methods." + meth + "?" +
                            target + ".methods." + meth + "(eyc," + target + ",self" +
                            (args.length?","+args.join(","):"") +
                            "):" +
                            (<types.Type> ssa.ctx.ctype).default() +
                            ")";

                    }
                    break;
                }

                case "suggestion-call-call":
                {
                    // Find the head
                    const head = ssa.a1;

                    // Get the arguments
                    const args: string[] = [];
                    for (let j = iri - 1; j > head; j--) {
                        const sssa = ir[j];
                        if (sssa.type === "arg" && sssa.a1 === head)
                            args.unshift(sssa.arg(ir, 2, false));
                    }

                    // Get the target
                    const target = ssa.arg(ir, 2, false);
                    const meth = ssa.ctx.children.expression.ctype.id;

                    // And create the suggestion
                    ssa.expr = '({action:"m",' +
                        "target:" + target + "," +
                        "source:self," +
                        "method:" + JSON.stringify(meth) + "," +
                        "args:[" + args.join(",") + "]})";
                    break;
                }

                case "array-index":
                {
                    /* Defaulting is different for numbers, because 0 and NaN
                     * are both falsey */
                    if (ssa.ctx.ctype.isNum) {
                        const arr = ssa.arg(ir, 1, false);
                        const idx = ssa.arg(ir, 2, false);
                        ssa.expr = "((" + idx + " in " + arr + ")?" +
                            arr + "[" + idx + "]:" +
                            (<types.Type> ssa.ctx.ctype).default() +
                            ")";

                    } else {
                        const idx = ssa.arg(ir, 2);
                        const arr = ssa.arg(ir, 1);
                        ssa.expr = "(" + arr + "[" + idx + "]||" +
                            (<types.Type> ssa.ctx.ctype).default() +
                            ")";

                    }
                    break;
                }

                case "tuple-index":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    ssa.expr = "(" + l + "[" + r + "])";
                    break;
                }

                case "string-index":
                {
                    const r = ssa.arg(ir, 2);
                    const l = ssa.arg(ir, 1);
                    ssa.expr = "(" + l + "[" + r + ']||"")';
                    break;
                }

                case "map-get":
                {
                    const map = ssa.arg(ir, 1, false);
                    const idx = ssa.arg(ir, 2, false);
                    ssa.expr = "(" + map + ".has(" + idx + ")?" +
                        map + ".get(" + idx + "):" +
                        (<types.Type> ssa.ctx.ctype).default() + ")";
                    break;
                }

                case "map-tuple-get":
                {
                    // Need a temporary for the tuple string
                    const tmp = "$$" + (this.varCtr++);
                    this.vars.push(tmp);
                    const map = ssa.arg(ir, 1, false);
                    const idx = ssa.arg(ir, 2, false);
                    ssa.expr = "(" + tmp + "=eyc.tupleStr(" + idx + ")," +
                        map + ".has(" + tmp + ")?" +
                        map + ".get(" + tmp + ").value:" +
                        (<types.Type> ssa.ctx.ctype).default() + ")";
                    break;
                }

                case "set-get":
                {
                    const idx = ssa.arg(ir, 2);
                    const set = ssa.arg(ir, 1);
                    ssa.expr = "(" + set + ".has(" + idx + "))";
                    break;
                }

                case "field":
                {
                    const left = ssa.ctx.children.expression;
                    const name = ssa.ctx.children.id.children.text;
                    const jsnm = left.ctype.instanceOf.fieldNames[name];

                    /* Defaulting is slightly different for numbers, because 0
                     * and NaN are both falsey */
                    if (ssa.ctx.ctype.isNum) {
                        const target = ssa.arg(ir, 1, false);
                        ssa.expr = "(" + JSON.stringify(jsnm) + "in " + target + "?" +
                            target + "." + jsnm + ":" +
                            (<types.Type> ssa.ctx.ctype).default() +
                            ")";

                    } else {
                        // Simple case, just ||default
                        const target = ssa.arg(ir);
                        ssa.expr = "(" + target + "." + jsnm + "||" +
                            (<types.Type> ssa.ctx.ctype).default() +
                            ")";

                    }
                    break;
                }

                case "field-assign":
                {
                    const target = ssa.arg(ir, 1, false);
                    const value = ssa.arg(ir, 2, false);
                    const left = ssa.ctx.children.expression;
                    const name = ssa.ctx.children.id.children.text;
                    const jsnm = left.ctype.instanceOf.fieldNames[name];

                    ssa.expr = "(" + JSON.stringify(jsnm) + "in " + target + "?" +
                        target + "." + jsnm + "=" + value + ":" +
                        value + ")";
                    break;
                }

                case "array-length":
                case "string-length":
                {
                    const target = ssa.arg(ir, 1);
                    ssa.expr = "(" + target + ".length)";
                    break;
                }

                case "suggestion-tail":
                {
                    const head = ssa.a1;

                    // Get the elements
                    const els: string[] = [];
                    for (let j = iri - 1; j > head; j--) {
                        const sssa = ir[j];
                        if (sssa.type === "arg" && sssa.a1 === head)
                            els.unshift(sssa.arg(ir, 2, false));
                    }

                    // And make the array
                    ssa.expr = "([" + els.join(",") + "])";
                    break;
                }

                case "suggestion-literal":
                {
                    const tmp = "$$" + (this.varCtr++);
                    this.vars.push(tmp);
                    ssa.expr = "(" + tmp + "=" + ssa.arg(ir, 1) + "," +
                        tmp + '.id=self.prefix+"$"+eyc.freshId(),' +
                        tmp + ")";
                    break;
                }

                case "new-object":
                    ssa.expr = "(new eyc.Object(self.prefix))";
                    break;

                case "new-array":
                {
                    const tmp = "$$" + (this.varCtr++);
                    this.vars.push(tmp);
                    ssa.expr = "(" + tmp + "=[]," +
                        tmp + ".prefix=self.prefix," +
                        tmp + '.id=self.prefix+"$"+eyc.freshId(),' +
                        tmp + ".valueType=" + JSON.stringify((<types.ArrayType> ssa.ctx.ctype).valueType.basicType()) + "," +
                        tmp + ")";
                    break;
                }

                case "new-map":
                {
                    const mapType = <types.MapType> ssa.ctx.ctype;
                    ssa.expr = "(new eyc.Map(self.prefix," +
                        JSON.stringify(mapType.keyType.basicType()) + "," +
                        JSON.stringify(mapType.valueType.basicType()) + "))";
                    break;
                }

                case "new-set":
                {
                    const setType = <types.SetType> ssa.ctx.ctype;
                    ssa.expr = "(new eyc.Set(self.prefix," +
                        JSON.stringify(setType.valueType.basicType()) +
                        "))";
                    break;
                }

                case "with":
                    ssa.skip = true;
                    ssa.stmts.push("(function(self) {\n");
                    break;

                case "htiw":
                    ssa.skip = true;
                    ssa.stmts.push("})(" + ssa.arg(ir) + ");\n");
                    break;

                case "this":
                    ssa.skip = true;
                    ssa.target = ssa.expr = "self";
                    break;

                case "javascript-call":
                {
                    // Find the head
                    const head = ssa.a1;

                    // Get the arguments
                    const args: string[] = [];
                    for (let j = iri - 1; j > head; j--) {
                        const sssa = ir[j];
                        if (sssa.type === "arg" && sssa.a1 === head)
                            args.unshift(sssa.arg(ir, 2));
                    }

                    // Put it together
                    ssa.expr = "((function(" +
                        ssa.ex.join(",") + "){" +
                        ssa.ctx.children.body + "})(" +
                        args.join(",") + "))";
                    break;
                }

                case "null":
                    ssa.skip = true;
                    ssa.target = ssa.expr = "(eyc.nil)";
                    break;

                case "default":
                    ssa.skip = true;
                    ssa.target = ssa.expr = "(" + (<types.Type> ssa.ctx.ctype).default() + ")";
                    break

                case "hex-literal":
                {
                    const text = ssa.ctx.children.text;
                    if (text.indexOf(".") >= 0) {
                        /* Fractional hex literals aren't supported by JS, so
                         * do it ourselves */
                        let cur = text;
                        let val = 0;

                        // Fractional part
                        // eslint-disable-next-line no-constant-condition
                        while (true) {
                            val += parseInt(cur.slice(-1), 16);
                            val /= 16;
                            cur = cur.slice(0, -1);
                            if (cur.slice(-1) === ".")
                                break;
                        }

                        // Whole part
                        val += parseInt("0" + cur.slice(0, -1), 16);
                        ssa.expr = "(" + val + ")";

                    } else {
                        ssa.expr = "(0x" + text + ")";
                    }
                    break;
                }

                case "dec-literal":
                    ssa.expr = "(" + (ssa.ctx.children.text.replace(/^0*/, "")||"0") + ")";
                    break;

                case "string-literal":
                    ssa.expr = "(" + ssa.ctx.children.text + ")";
                    break;

                case "string-from-object":
                    ssa.expr = "(" + ssa.arg(ir) + ".id)";
                    break;

                case "bool-from-bool":
                    ssa.expr = "(" + ssa.arg(ir) + ")";
                    break;

                case "tuple-literal-tail":
                {
                    // Find the head
                    const head = ssa.a1;

                    // Get the elements
                    const els: string[] = [];
                    for (let j = iri - 1; j > head; j--) {
                        const sssa = ir[j];
                        if (sssa.type === "arg" && sssa.a1 === head)
                            els.unshift(sssa.arg(ir, 2, false));
                    }

                    // And make the array
                    ssa.expr = "([" + els.join(",") + "])";
                    break;
                }

                case "var":
                case "compile-time-literal":
                    ssa.skip = true;
                    ssa.target = ssa.expr = ssa.ex;
                    break;

                case "var-assign":
                    ssa.expr = "(" + ssa.ex + "=" + ssa.arg(ir) + ")";
                    break;

                case "class":
                    ssa.expr = "(eyc.classes." + (<types.EYCClass> ssa.ex).prefix + ")";
                    break;

                case "arg":
                case "call-head":
                case "javascript-head":
                case "map-pair":
                case "suggestion-head":
                case "tuple-literal-head":
                    // No code
                    ssa.skip = true;
                    break;

                default:
                    throw new EYCTypeError(ssa.ctx, "No compiler for " + ssa.type);
            }
        }
    }

    compileJS(ir: SSA[], retType: types.Type): string {
        // Figure out what variables need to be defined
        const vars: string[] = this.vars.slice(0);
        for (const ssa of ir) {
            if (ssa.uses && !ssa.skip)
                vars.push(ssa.target);
        }

        const varStr = vars.length ? ("var " + vars.join(",") + ";\n") : "";

        // And put it all together
        return varStr +
            ir.map(ssa => {
                const pre = ssa.stmts.join("");
                if (ssa.skip)
                    return pre;
                else if (ssa.uses)
                    return pre + ssa.target + "=" + ssa.expr + ";\n";
                else
                    return pre + ssa.expr + ";\n";
            }).join("") +
            "return " + retType.default() + ";\n";
    }
}

// Compile a FieldDecl
function compileFieldDecl(ccs: ClassCompilationState, fieldDecl: types.Tree) {
    const type = <types.Type> fieldDecl.ctype;
    const klass = (<types.ClassNode> fieldDecl.parent).klass;

    for (const d of fieldDecl.children.decls.children) {
        const iname = klass.prefix + "$" + d.children.id.children.text;
        let init;
        if (d.children.initializer) {
            // Make it a method
            const mcs = new MethodCompilationState(ccs, null);
            const ir: SSA[] = [];
            const symbols: Record<string, string> = Object.create(null);
            const val = mcs.compileSSA(ir, symbols, d.children.initializer);
            ir.push(new SSA(d.children.initializer, "return", ir.length, val));
            mcs.compileFrag(ir);
            init = mcs.compileJS(ir, type);
        } else {
            init = "return " + type.default({build: true}) + ";";
        }
        klass.fieldInits[iname] = <types.CompiledFunction> Function("eyc", "self", "caller", init);
    }
}
