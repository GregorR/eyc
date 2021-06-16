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
    const module = new eyc.Module(url, url + ".eyc", opts.ctx || {privileged: false});

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
        factor: 1
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
                const vals = {
                    x: defaults.x,
                    y: defaults.y,
                    w: defaults.w,
                    h: defaults.h,
                    scale: defaults.scale,
                    factor: defaults.factor
                };

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
                    av = Function("return " + compileExpression(eyc, null, {}, av))();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (<any> vals)[an] = av;
                }

                if (nm === "default") {
                    // These are the new defaults
                    defaults = vals;

                } else {
                    // Adjust x and y to be relative to the grid size
                    vals.x *= vals.factor;
                    vals.y *= vals.factor;

                    // This is a new sprite
                    sheet.add(new eyc.Sprite(sheet, nm, vals.x, vals.y, vals.w, vals.h, vals.scale));

                    // Now bump the default x
                    defaults.x++;

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
                    av = Function("return " + compileExpression(eyc, null, {}, av))();
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
        new eyc.Fabric(fabricDecl.module, fabricDecl.children.id.children.text,
            fabricDecl.children.url,
            await eyc.ext.fetch(url));

    // FIXME: Properties

    // The actual type of a fabric in code is just an array of strings
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
        if (name in classType.methodTypes || name in classType.fieldTypes) {
            // Invalid declaration!
            throw new EYCTypeError(fieldDecl, "Declaration of name that already exists in this type");
        }
        classType.fieldTypes[name] = decl.ctype = fieldType;
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
            if (!leftType.equals(rightType, {castable: true})) {
                // Special case if the left or right type *is* null
                if (!(leftType.isNullable && rightType.isNull) &&
                    !(leftType.isNull && rightType.isNullable))
                    throw new EYCTypeError(exp, "Incomparable types");
            }
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

        case "CloneExp":
        {
            resType = typeCheckExpression(eyc, methodDecl, ctx, symbols, exp.children.expression);

            // Only certain types are clonable
            let isClonable = false;
            switch (resType.type) {
                case "object":
                {
                    // Needs to be a subclass of $$core$Clonable
                    const klass = (<types.EYCObjectType> resType).instanceOf;
                    if (!klass.subtypeOf(eyc.classes["$$core$Clonable"]))
                        throw new EYCTypeError(exp, "Only subclasses of core.Clonable are clonable");
                    isClonable = true;
                    break;
                }

                case "array":
                case "map":
                case "set":
                    isClonable = true;
                    break;
            }

            if (!isClonable)
                throw new EYCTypeError(exp, "The type " + resType.type + " is not clonable");

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

            // Only this[...] = ... is allowed
            if (opts.mutating || (!ctx.mutating && exp.children.expression.type !== "This"))
                throw new EYCTypeError(exp, "Illegal mutation");

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
                compileClassDecl(eyc, c, symbols);
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

// Compile this class
function compileClassDecl(eyc: types.EYC, classDecl: types.Tree, symbols: Record<string, string>) {
    for (const c of classDecl.children.members.children) {
        switch (c.type) {
            case "MethodDecl":
                compileMethodDecl(eyc, c, symbols);
                break;

            case "FieldDecl":
                compileFieldDecl(eyc, c);
                break;

            default:
                throw new EYCTypeError(c, "No compiler for " + c.type);
        }
    }
}

// State while compiling a method
class MethodCompilationState {
    method: types.MethodNode;
    varCt: number;
    outDecls: string[];
    halfFreeTmps: string[];
    freeTmps: string[];
    outCode: string;
    postExp: string;

    constructor(method: types.MethodNode) {
        this.method = method;
        this.varCt = 0;
        this.outDecls = [];
        this.halfFreeTmps = [];
        this.freeTmps = [];
        this.outCode = "";
        this.postExp = "";
    }

    allocateVar(nm: string, init?: string) {
        nm += "$" + (this.varCt++);
        if (init)
            init = "=" + init;
        else
            init = "";
        this.outDecls.push(nm + init);
        return nm;
    }

    allocateTmp() {
        if (this.freeTmps.length)
            return this.freeTmps.shift();
        else
            return this.allocateVar("");
    }

    freeTmp(nm: string) {
        this.halfFreeTmps.push(nm);
    }

    flushPost() {
        this.outCode += this.postExp;
        this.postExp = "";
        this.freeTmps = this.freeTmps.concat(this.halfFreeTmps);
        this.halfFreeTmps = [];
    }
}

// Compile this method
function compileMethodDecl(eyc: types.EYC, methodDecl: types.MethodNode, symbols: Record<string, string>) {
    const klass = methodDecl.parent.klass;
    symbols = Object.create(symbols);

    const state = new MethodCompilationState(methodDecl);

    // Start with the parameters
    const params: string[] = ["eyc", "self", "caller"];
    if (methodDecl.children.params) {
        for (const param of methodDecl.children.params.children) {
            const nm = param.children.id.children.text;
            const stateNm = nm + "$" + (state.varCt++);
            symbols[nm] = stateNm;
            params.push(stateNm);
        }
    }
    const paramsStr = params.join(",");

    // Then compile the function into JavaScript
    compileStatement(eyc, state, symbols, methodDecl.children.body);

    // And compile the JavaScript
    const js =
        (state.outDecls.length ? "var " + state.outDecls.join(",") + ";\n" : "") +
        state.outCode +
        (methodDecl.signature.retType.isVoid ? "" : "return " + methodDecl.signature.retType.default() + ";\n");
    //console.log(methodDecl.ctype.id + "(" + params + "):\n" + js + "---");
    klass.methods[methodDecl.signature.id] = <types.CompiledFunction> Function(paramsStr, js);
}

// Compile a FieldDecl
function compileFieldDecl(eyc: types.EYC, fieldDecl: types.Tree) {
    const type = <types.Type> fieldDecl.ctype;
    console.assert(type.isType);
    const klass = (<types.ClassNode> fieldDecl.parent).klass;

    for (const d of fieldDecl.children.decls.children) {
        const iname = klass.prefix + "$" + d.children.id.children.text;
        let init;
        if (d.children.initializer)
            init = compileExpression(eyc, null, Object.create(null), d.children.initializer);
        else
            init = type.default({build: true});
        klass.fieldInits[iname] = <types.CompiledFunction> Function("eyc", "self", "caller", "return " + init + ";");
    }
}

// Compile a statement
function compileStatement(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, stmt: types.Tree) {
    switch (stmt.type) {
        case "Block":
            symbols = Object.create(symbols);
            for (const c of stmt.children)
                compileStatement(eyc, state, symbols, c);
            break;

        case "VarDecl":
            for (const d of stmt.children.decls.children) {
                const name = d.children.id.children.text;
                const sym = state.allocateVar(name);

                if (d.children.initializer) {
                    state.postExp = "";
                    const init = compileExpression(eyc, state, symbols, d.children.initializer);
                    state.outCode += sym + "=" + init + ";\n";
                    state.flushPost();
                } else {
                    state.outCode += sym + "=" + d.ctype.default() + ";\n";
                }

                symbols[name] = sym;
            }
            break;

        case "IfStatement":
        {
            // Condition
            const tmp = state.allocateTmp();
            state.postExp = "";
            const condition = compileExpressionBool(eyc, state, symbols, stmt.children.condition);
            state.outCode += tmp + "=" + condition + ";\n";
            state.freeTmp(tmp);
            state.flushPost();

            // Body
            state.outCode += "if(" + tmp + "){\n";
            compileStatement(eyc, state, Object.create(symbols), stmt.children.ifStatement);

            // Else clause
            if (stmt.children.elseStatement) {
                state.outCode += "}else{\n";
                compileStatement(eyc, state, Object.create(symbols), stmt.children.elseStatement);
            }

            // Cleanup
            state.outCode += "}\n";
            break;
        }

        case "ForStatement":
        {
            symbols = Object.create(symbols);

            // Initializer
            if (stmt.children.initializer) {
                if (stmt.children.initializer.type === "VarDecl") {
                    compileStatement(eyc, state, symbols, stmt.children.initializer);
                } else {
                    state.postExp = "";
                    const init = compileExpression(eyc, state, symbols, stmt.children.initializer);
                    state.outCode += init + ";\n";
                    state.flushPost();
                }
            }

            // Loop
            state.outCode += "while(1){\n";

            // Condition
            if (stmt.children.condition) {
                state.postExp = "";
                const cond = compileExpression(eyc, state, symbols, stmt.children.condition);
                state.outCode +=
                    "if(!(" + cond + ")){\n" +
                    state.postExp +
                    "break;\n" +
                    "}\n";
                state.flushPost();
            }

            // Body
            compileStatement(eyc, state, Object.create(symbols), stmt.children.body);

            // Increment
            if (stmt.children.increment) {
                state.postExp = "";
                const inc = compileExpression(eyc, state, symbols, stmt.children.increment);
                state.outCode +=
                    inc + ";\n";
                state.flushPost();
            }

            state.outCode += "}\n";
            break;
        }

        case "ForInStatement":
        {
            symbols = Object.create(symbols);

            // Get the collection code
            state.postExp = "";
            const collection = compileExpression(eyc, state, symbols, stmt.children.collection);

            // Convert it to an iterable array
            const tmpCollection = state.allocateTmp(),
                tmpIterator = state.allocateTmp(),
                tmpLength = state.allocateTmp();
            let arrayCode;
            switch (stmt.children.collection.ctype.type) {
                case "string":
                case "array":
                    arrayCode = collection;
                    break;

                case "set":
                    arrayCode = "Array.from(" + collection + ".values()).sort(eyc.cmp." +
                        stmt.children.collection.ctype.valueType.type +
                        ")";
                    break;

                default:
                    throw new EYCTypeError(stmt, "Cannot iterate over " + stmt.children.collection.ctype.type);
            }
            state.outCode +=
                tmpCollection + "=" + arrayCode + ";\n" +
                tmpLength + "=" + tmpCollection + ".length;\n";
            state.flushPost();

            // Allocate the iterator
            let iterator;
            if (stmt.children.type) {
                const name = stmt.children.id.children.text;
                iterator = symbols[name] = state.allocateVar(name);
            } else {
                iterator = symbols[stmt.children.id.children.text];
            }

            // Get the loop header
            if (stmt.children.reverse) {
                state.outCode +=
                    "for(" + tmpIterator + "=" + tmpLength + "-1;" + tmpIterator + ">=0;" + tmpIterator + "--){\n";
            } else {
                state.outCode +=
                    "for(" + tmpIterator + "=0;" + tmpIterator + "<" + tmpLength + ";" + tmpIterator + "++){\n";
            }
            state.outCode +=
                iterator + "=" + tmpCollection + "[" + tmpIterator + "];\n";

            // Then the loop body
            compileStatement(eyc, state, symbols, stmt.children.body);

            // End the loop
            state.outCode += "}\n";

            // And clear everything up
            state.outCode +=
                tmpCollection + "=0;\n";
            state.freeTmp(tmpCollection);
            state.freeTmp(tmpIterator);
            state.freeTmp(tmpLength);

            break;
        }

        case "ForInMapStatement":
        {
            const collectionNode = stmt.children.collection;

            if (collectionNode.ctype.isString || collectionNode.ctype.isArray) {
                // Special form for strings and arrays

                // Allocate variables
                symbols = Object.create(symbols);
                if (stmt.children.keyType)
                    symbols[stmt.children.key.children.text] = state.allocateVar(stmt.children.key.children.text);
                if (stmt.children.valueType)
                    symbols[stmt.children.value.children.text] = state.allocateVar(stmt.children.value.children.text);

                // Get the thing we're iterating over
                const arrayTmp = state.allocateTmp();
                state.postExp = "";
                state.outCode +=
                    arrayTmp + "=" +
                    compileExpression(eyc, state, symbols, collectionNode) +
                    ";\n";
                state.flushPost();

                // Initializer
                state.outCode +=
                    symbols[stmt.children.key.children.text] + "=0;\n" +
                    symbols[stmt.children.value.children.text] + "=0;\n";

                // Loop
                const lv = symbols[stmt.children.key.children.text];
                const vv = symbols[stmt.children.value.children.text];
                state.outCode += "for(" + lv + "=0;" + lv + "<" + arrayTmp + ".length;" + lv + "++){\n" +
                    vv + "=" + arrayTmp + "[" + lv + ']||"";\n';

                // Body
                compileStatement(eyc, state, Object.create(symbols), stmt.children.body);

                state.outCode += "}\n";
                break;
            }

            console.assert(collectionNode.ctype.isMap);

            // FIXME: Maps with tuple keys
            symbols = Object.create(symbols);

            // Get the collection code
            state.postExp = "";
            const collection = compileExpression(eyc, state, symbols, collectionNode);

            // Convert it to an iterable array
            const tmpCollection = state.allocateTmp(),
                tmpKeys = state.allocateTmp(),
                tmpIterator = state.allocateTmp(),
                tmpLength = state.allocateTmp();
            state.outCode +=
                tmpCollection + "=" + collection + ";\n" +
                tmpKeys + "=Array.from(" + tmpCollection + ".keys()).sort(eyc.cmp." +
                    stmt.children.collection.ctype.keyType.type +
                    ");\n" +
                tmpLength + "=" + tmpKeys + ".length;\n";
            state.flushPost();

            // Allocate the iterator(s)
            let keyIterator;
            if (stmt.children.keyType) {
                const name = stmt.children.key.children.text;
                keyIterator = symbols[name] = state.allocateVar(name);
            } else {
                keyIterator = symbols[stmt.children.key.children.text];
            }
            let valIterator;
            if (stmt.children.valueType) {
                const name = stmt.children.value.children.text;
                valIterator = symbols[name] = state.allocateVar(name);
            } else {
                valIterator = symbols[stmt.children.value.children.text];
            }

            // Get the loop header
            if (stmt.children.reverse) {
                state.outCode +=
                    "for(" + tmpIterator + "=" + tmpLength + "-1;" + tmpIterator + ">=0;" + tmpIterator + "--){\n";
            } else {
                state.outCode +=
                    "for(" + tmpIterator + "=0;" + tmpIterator + "<" + tmpLength + ";" + tmpIterator + "++){\n";
            }
            state.outCode +=
                keyIterator + "=" + tmpKeys + "[" + tmpIterator + "];\n" +
                valIterator + "=" + tmpCollection + ".has(" + keyIterator + ")?" +
                    tmpCollection + ".get(" + keyIterator + "):" +
                    stmt.children.collection.ctype.valueType.default() +
                    ";\n";

            if (stmt.children.collection.ctype.keyType.isTuple) {
                state.outCode +=
                    keyIterator + "=" + valIterator + ".key;\n" +
                    valIterator + "=" + valIterator + ".value;\n";
            }

            // Then the loop body
            compileStatement(eyc, state, symbols, stmt.children.body);

            // End the loop
            state.outCode += "}\n";

            // And clear everything up
            state.outCode +=
                tmpCollection + "=0;\n" +
                tmpKeys + "=0;\n";
            state.freeTmp(tmpCollection);
            state.freeTmp(tmpKeys);
            state.freeTmp(tmpIterator);
            state.freeTmp(tmpLength);

            break;
        }

        case "ReturnStatement":
            if (stmt.children.value) {
                state.postExp = "";
                const exp = compileExpression(eyc, state, symbols, stmt.children.value);
                state.outCode += "return " + exp + ";\n";
                state.flushPost();
            } else {
                state.outCode += "return;\n";
            }
            break;

        case "ExtendStatement":
        case "RetractStatement":
        {
            state.postExp = "";
            const exp = stmt.children.expression;
            console.assert(exp.type === "CastExp");
            const expCode = compileExpression(eyc, state, symbols, exp.children.expression);
            const type = exp.children.type.ctype.instanceOf.prefix;
            state.outCode += expCode + "." +
                (stmt.type==="ExtendStatement"?"extend":"retract") +
                "(" + JSON.stringify(type) + ");\n";
            state.flushPost();
            break;
        }

        case "ExpStatement":
        {
            state.postExp = "";
            const exp = compileExpression(eyc, state, symbols, stmt.children.expression);
            state.outCode += exp + ";\n";
            state.flushPost();
            break;
        }

        default:
            throw new EYCTypeError(stmt, "No compiler for " + stmt.type);
    }
}

// Compile an expression
function compileExpression(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, exp: types.Tree): string {
    function sub(e: string) {
        return compileExpression(eyc, state, symbols, exp.children[e]);
    }

    function subb(e: string) {
        return compileExpressionBool(eyc, state, symbols, exp.children[e]);
    }

    switch (exp.type) {
        case "OrExp":
        case "AndExp":
            return "(" + subb("left") + exp.children.op + subb("right") + ")";

        case "EqExp":
        {
            const op = exp.children.op + "=";
            if (exp.children.left.ctype.isTuple)
                throw new EYCTypeError(exp, "Equality comparison of tuples is not yet implemented");

            return "(" + sub("left") + op + sub("right") + ")";
        }

        case "AssignmentExp":
            return compileAssignmentExpression(eyc, state, symbols, exp);

        case "RelExp":
            if (exp.children.op === "in") {
                const tmp = state.allocateTmp();
                let out = "(" +
                    tmp + "=" + sub("left") + ",";

                const rightType = exp.children.right.ctype;
                switch (rightType.type) {
                    case "map":
                        if (rightType.keyType.isTuple) {
                            // string->special object instead of tuple->*
                            out += sub("right") + ".has(eyc.tupleStr(" + tmp + "))";
                        } else {
                            out += sub("right") + ".has(" + tmp + ")";
                        }
                        break;

                    default:
                        throw new EYCTypeError(exp, "No compiler for in " + exp.children.right.ctype.type);
                }

                out += ")";

                state.postExp += tmp + "=0;\n";
                state.freeTmp(tmp);
                return out;

            } else if (exp.children.op === "is") {
                return "(!!" + sub("left") + ".type." + exp.children.right.ctype.prefix + ")";

            } else {
                const ltype = exp.children.left.ctype;
                let op = exp.children.op;
                if (op === "==")
                    op = "===";
                else if (op === "!=")
                    op = "!==";

                if (ltype.isNullable) {
                    // Compare ID's
                    return "(" + sub("left") + ".id" + op + sub("right") + ".id)";

                } else if (ltype.isTuple) {
                    throw new EYCTypeError(exp, "No compiler for comparisons for tuples");

                } else {
                    return "(" + sub("left") + op + sub("right") + ")";

                }

            }

        case "AddExp":
        case "MulExp":
        {
            const types = exp.children.left.ctype.type + ":" + exp.children.right.ctype.type;
            switch (types) {
                case "num:num":
                    return "(" + sub("left") + exp.children.op + sub("right") + ")";

                case "string:string":
                    return "(" + sub("left") + exp.children.op + sub("right") + ")";

                case "suggestion:suggestion":
                    console.assert(exp.children.op === "+");
                    return "(eyc.Suggestion(self.prefix," + sub("left") + "," + sub("right") + "))";

                default:
                    throw new EYCTypeError(exp, "No compiler for AddExp(" + types + ")");
            }
        }

        case "UnExp":
            switch (exp.children.op) {
                case "-":
                    return "(-" + subb("expression") + ")";

                case "!":
                    return "(!" + subb("expression") + ")";

                default:
                    throw new EYCTypeError(exp, "No UnExp compiler for " + exp.children.op);
            }
            break;

        case "PostIncExp":
        case "PostDecExp":
            return compileIncDecExpression(eyc, state, symbols, exp, true);

        case "CastExp":
            if (exp.ctype.isString) {
                // Coerce to a string
                const from = exp.children.expression.ctype;
                if (from.isNullable)
                    return "(" + sub("expression") + ".id)";
                else if (from.isTuple)
                    return "(eyc.tupleStr(" + sub("expression") + "))";
                else
                    return '(""+' + sub("expression") + ")";

            } else {
                // This is only meaningful for types
                return sub("expression");

            }

        case "CallExp":
        {
            // This depends on a lot of steps
            const left = exp.children.expression;
            const leftLeft = left.children.expression;
            let lhs = null;
            let out = "(";

            // 1: Compute the leftLeft
            if (leftLeft.ctype.isObject) {
                lhs = state.allocateTmp();
                out += lhs + "=" + compileExpression(eyc, state, symbols, leftLeft) + ",";
            }

            // 2: Compute arguments
            const argTmps = [];
            if (exp.children.args) {
                for (const a of exp.children.args.children) {
                    const argTmp = state.allocateTmp();
                    argTmps.push(argTmp);
                    out += argTmp + "=" + compileExpression(eyc, state, symbols, a) + ",";
                }
            }

            // 3: Call target
            switch (leftLeft.ctype.type) {
                case "object":
                    out += lhs + ".methods." + left.ctype.id + "?" + lhs + ".methods." + left.ctype.id + "(eyc," + lhs + ",self";
                    break;

                case "class":
                    out += "eyc.classes." + leftLeft.ctype.prefix + ".methods." + left.ctype.id + "(eyc,eyc.nil,self";
                    break;

                default:
                    throw new EYCTypeError(exp, "Cannot call method on " + leftLeft.ctype.type);
            }

            // 4: Actual arguments
            for (const a of argTmps)
                out += "," + a;
            out += ")";

            // 5: Default
            if (leftLeft.ctype.isObject)
                out += ":" + (<types.Type> exp.ctype).default();

            // 6: Cleanup
            if (lhs) {
                // Cleanup
                state.postExp += lhs + "=0;\n";
                state.freeTmp(lhs);
            }
            for (const a of argTmps) {
                state.postExp += a + "=0;\n";
                state.freeTmp(a);
            }

            out += ")";

            return out;
        }

        case "IndexExp":
        {
            const left = exp.children.expression;

            switch (left.ctype.type) {
                case "array":
                {
                    const tmpArray = state.allocateTmp(),
                        tmpIdx = state.allocateTmp();

                    const out = "(" +
                        tmpArray + "=" + sub("expression") + "," +
                        tmpIdx + "=" + sub("index") + "," +
                        tmpIdx + " in " + tmpArray + "?" +
                        tmpArray + "[" + tmpIdx + "]:" +
                        (<types.Type> exp.ctype).default() +
                        ")";

                    state.postExp += tmpArray + "=0;\n";
                    state.freeTmp(tmpArray);
                    state.freeTmp(tmpIdx);

                    return out;
                }

                case "tuple":
                    return "(" + sub("expression") + "[" + exp.children.idx + "])";

                case "map":
                    // Simplest case: Non-tuple key, non-number value
                    if (!left.ctype.keyType.isTuple && !exp.ctype.isNum) {
                        // We can just pull it out directly with a default
                        return "(" +
                            sub("expression") +
                            ".get(" + sub("index") +
                            ")||" + (<types.Type> exp.ctype).default() +
                            ")";

                    } else if (left.ctype.keyType.isTuple) {
                        // The key type is a tuple, so it's really string->special object
                        const tmpMap = state.allocateTmp(),
                            tmpKey = state.allocateTmp();
                        const out = "(" +
                            tmpMap + "=" + sub("expression") + "," +
                            tmpKey + "=" + sub("index") + "," +
                            "(" +
                                tmpMap + ".get(eyc.tupleStr(" + tmpKey + "))" +
                                "||{value:" + (<types.Type> exp.ctype).default() + "}" +
                            ").value" +
                            ")";
                        state.postExp +=
                            tmpMap + "=0;\n" +
                            tmpKey + "=0;\n";
                        state.freeTmp(tmpMap);
                        state.freeTmp(tmpKey);
                        return out;

                    } else { // value type is number
                        // This is slightly complicated because numbers have multiple falsey values
                        const tmpMap = state.allocateTmp(),
                            tmpKey = state.allocateTmp();
                        const out = "(" +
                            tmpMap + "=" + sub("expression") + "," +
                            tmpKey + "=" + sub("index") + "," +
                            tmpMap + ".has(" + tmpKey + ")?" +
                            tmpMap + ".get(" + tmpKey + "):0)";
                        state.postExp +=
                            tmpMap + "=0;\n" +
                            tmpKey + "=0;\n";
                        state.freeTmp(tmpMap);
                        state.freeTmp(tmpKey);
                        return out;

                    }

                case "set":
                    return "(" + sub("expression") + ".has(" + sub("index") + "))";

                case "string":
                    return "(" +
                        sub("expression") +
                        "[" + sub("index") +
                        ']||"")';
                    break;

                case "sprites":
                    return "(" + JSON.stringify((<types.Spritesheet> left.ctype).prefix + "$") +
                        "+" + sub("index") + ")";

                default:
                    throw new EYCTypeError(exp, "No compiler for indexing " + left.ctype.type);
            }
        }

        case "SuggestionExtendExp":
        {
            const subExp = sub("expression");
            const sug = compileSuggestions(eyc, state, symbols, exp.children.suggestions);
            return "(eyc.Suggestion(self.prefix," + subExp + "," + sug + "))";
        }

        case "DotExp":
        {
            const left = exp.children.expression;
            const name = exp.children.id.children.text;
            const leftExp = sub("expression");

            switch (left.ctype.type) {
                case "object":
                    // Normal case, handled next
                    break;

                case "array":
                    console.assert(name === "length");
                    return "(" + leftExp + ".length)";

                case "set":
                    console.assert(name === "length");
                    return "(" + leftExp + ".size)";

                case "string":
                    console.assert(name === "length");
                    return "(" + leftExp + ".length)";

                default:
                    throw new EYCTypeError(exp, "No compiler for dot expression of " + left.ctype.type);
            }

            const iname = left.ctype.instanceOf.fieldNames[name];

            // Fix possibility of missing fields
            if (exp.ctype.isNum) {
                const tmp = state.allocateTmp();
                const out = "(" + tmp + "=" + leftExp + "," +
                    JSON.stringify(iname) + "in " + tmp + "?" +
                    tmp + "." + iname + ":" +
                    (<types.Type> exp.ctype).default() +
                    ")";
                state.postExp += tmp + "=0;\n";
                state.freeTmp(tmp);
                return out;

            } else {
                // All other types are either always truthy or falsey=default
                return "(" + leftExp + "." + iname + "||" + (<types.Type> exp.ctype).default() + ")";

            }
        }

        case "SuggestionLiteral":
        {
            const sug = compileSuggestions(eyc, state, symbols, exp.children.suggestions);
            return "(eyc.Suggestion(self.prefix," + sug + "))";
        }

        case "NewExp":
        {
            let out;
            switch (exp.ctype.type) {
                case "object":
                    out = "(new eyc.Object(self.prefix).extend(" + JSON.stringify((<types.EYCObjectType> exp.ctype).instanceOf.prefix) + "))";
                    break;

                case "array":
                {
                    const tmp = state.allocateTmp();

                    out = "(" +
                        tmp + "=[]," +
                        tmp + '.id=self.prefix+"$"+eyc.freshId(),' +
                        tmp + ")";

                    state.postExp += tmp + "=0;\n";
                    state.freeTmp(tmp);

                    break;
                }

                case "map":
                    out = "(new eyc.Map(self.prefix))";
                    break;

                case "set":
                    if ((<types.SetType> exp.ctype).valueType.isTuple) {
                        // Sets of tuples are stored as maps
                        out = "(new eyc.Map(self.prefix))";
                    } else {
                        out = "(new eyc.Set(self.prefix))";
                    }
                    break;

                default:
                    throw new EYCTypeError(exp, "No compiler for new " + exp.ctype.type);
            }

            if (exp.children.withBlock) {
                // Perform this with-block action
                const tmpV = state.allocateTmp(),
                    tmpF = "$" + (state.varCt++);

                out = "(" +
                    tmpV + "=" + out + "," +
                    tmpF + "(" + tmpV + ")," +
                    tmpV +
                    ")";

                state.postExp += tmpV + "=0;\n";
                state.freeTmp(tmpV);

                // Compile the with-block action
                state.outCode += "function " + tmpF + "(self){\n";
                const postExp = state.postExp;
                state.postExp = "";
                const halfFreeTmps = state.halfFreeTmps;
                state.halfFreeTmps = [];
                compileStatement(eyc, state, symbols, exp.children.withBlock);
                state.postExp = postExp;
                state.halfFreeTmps = halfFreeTmps;

                state.outCode += "}\n";
            }

            return out;
        }

        case "CloneExp":
        {
            let out = "(eyc.clone." + exp.ctype.type + "(self, " + sub("expression") + "))";

            if (exp.children.withBlock) {
                // FIXME: duplication

                // Perform this with-block action
                const tmpV = state.allocateTmp(),
                    tmpF = "$" + (state.varCt++);

                out = "(" +
                    tmpV + "=" + out + "," +
                    tmpF + "(" + tmpV + ")," +
                    tmpV +
                    ")";

                state.postExp += tmpV + "=0;\n";
                state.freeTmp(tmpV);

                // Compile the with-block action
                state.outCode += "function " + tmpF + "(self){\n";
                const postExp = state.postExp;
                state.postExp = "";
                const halfFreeTmps = state.halfFreeTmps;
                state.halfFreeTmps = [];
                compileStatement(eyc, state, symbols, exp.children.withBlock);
                state.postExp = postExp;
                state.halfFreeTmps = halfFreeTmps;

                state.outCode += "}\n";
            }

            return out;
        }

        case "SuperCall":
        {
            let out = "(this.proto." + state.method.signature.id + "(eyc,self,self";

            // Arguments
            if (exp.children.args) {
                for (const a of exp.children.args.children)
                    out += "," + compileExpression(eyc, state, symbols, a);
            }

            out += "))";

            return out;
        }


        case "This":
            return "(self)";

        case "JavaScriptExpression":
        {
            let out = "((function(";

            // Argument names
            if (exp.children.pass)
                out += exp.children.pass.children.map((c: types.Tree) => c.children.id.children.text).join(",");

            // The body
            out += "){" + exp.children.body + "})(";

            // Argument values
            if (exp.children.pass) {
                out += exp.children.pass.children.map((c: types.Tree) => {
                    if (c.children.initializer)
                        return compileExpression(eyc, state, symbols, c.children.initializer);
                    else
                        return symbols[c.children.id.children.text];
                });
            }

            out += "))";
            return out;
        }

        case "NullLiteral":
            return "(eyc.nil)";

        case "HexLiteral":
            if (exp.children.text.indexOf(".") >= 0) {
                // Fractional hex literals aren't supported by JS, so do it ourselves.
                let cur = exp.children.text;
                let val = 0;
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    val += parseInt(cur.slice(-1), 16);
                    val /= 16;
                    cur = cur.slice(0, -1);
                    if (cur.slice(-1) === ".")
                        break;
                }
                val += parseInt("0" + cur.slice(0, -1), 16);
                return "(" + val + ")";

            } else {
                return "(0x" + exp.children.text + ")";

            }

        case "B64Literal":
            return "(" + lexNum.lexStringToNum("000" + exp.children.text) + ")";

        case "DecLiteral":
            return "(" + (exp.children.text.replace(/^0*/, "")||"0") + ")";

        case "StringLiteral":
            return "(" + exp.children.text + ")";

        case "ArrayLiteral":
        {
            const arrayTmp = state.allocateTmp();
            const out = "(" +
                arrayTmp + "=[" +
                exp.children.elements.children.map((c: types.Tree) => compileExpression(eyc, state, symbols, c)).join(",") +
                "]," +
                arrayTmp + '.id=self.prefix+"$"+eyc.freshId(),' +
                arrayTmp + ")";
            state.postExp += arrayTmp + "=0;\n";
            state.freeTmp(arrayTmp);
            return out;
        }

        case "TupleLiteral":
            return "([" +
                exp.children.elements.children.map((c: types.Tree) => compileExpression(eyc, state, symbols, c)).join(",") +
                "])";

        case "ID":
        {
            const nm = exp.children.text;
            if (nm in symbols) {
                return symbols[nm];
            } else if (exp.ctype.isClass) {
                // Get the class directly
                return "(eyc.classes." + nm.ctype.prefix + ")";
            } else {
                throw new EYCTypeError(exp, "Cannot find ID " + nm);
            }
        }

        default:
            throw new EYCTypeError(exp, "No compiler for " + exp.type);
    }
}

// Compile an assignment expression
function compileAssignmentExpression(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, exp: types.Tree) {
    function sub(e: types.Tree) {
        return compileExpression(eyc, state, symbols, e);
    }

    const left = exp.children.target;
    const right = exp.children.value;

    if (exp.children.op === "+=") {
        // There are several special cases of +=
        switch (left.ctype.type) {
            case "array":
            {
                const arrayTmp = state.allocateTmp(),
                    valTmp = state.allocateTmp();
                let out = "(" +
                    arrayTmp + "=" + sub(left) + "," +
                    valTmp + "=" + sub(right) + ",";

                // Either array concatenation or array push
                if (right.ctype.equals(left.ctype, {subtype: true})) {
                    // The types are the same, so it's concatenation
                    out += arrayTmp + ".push.apply(" + arrayTmp + "," + valTmp + "),";

                } else {
                    // Just pushing onto the array
                    out += arrayTmp + ".push(" + valTmp + "),";

                }

                out += arrayTmp + ")";

                state.postExp +=
                    arrayTmp + "=0;\n" +
                    valTmp + "=0;\n";
                state.freeTmp(arrayTmp);
                state.freeTmp(valTmp);

                return out;
            }

            case "set":
            {
                const setTmp = state.allocateTmp();
                const out = "(" +
                    setTmp + "=" + sub(left) + "," +
                    setTmp + ".add(" + sub(right) + ")," +
                    setTmp + ")";
                state.postExp += setTmp + "=0;\n";
                state.freeTmp(setTmp);
                return out;
            }

            case "num":
            case "string":
                // Handled below
                break;

            default:
                throw new EYCTypeError(exp, "No compiler for += " + left.ctype.type);
        }

    } else if (exp.children.op === "-=") {
        // There's a special case for removing elements from maps or sets
        switch (left.ctype.type) {
            case "map":
            {
                const mapTmp = state.allocateTmp(),
                    valTmp = state.allocateTmp();

                let out = "(" +
                    mapTmp + "=" + sub(left) + "," +
                    valTmp + "=" + sub(right) + ",";

                if (left.ctype.keyType.isTuple) {
                    // Removing a tuple from a map means removing its string
                    out += mapTmp + ".delete(eyc.tupleStr(" + valTmp + ")),";

                } else {
                    // Everything else can simply be removed
                    out += mapTmp + ".delete(" + valTmp + "),";

                }

                out += mapTmp + ")";

                state.postExp +=
                    mapTmp + "=0;\n" +
                    valTmp + "=0;\n";
                state.freeTmp(mapTmp);
                state.freeTmp(valTmp);

                return out;

            }

            case "set":
            {
                const setTmp = state.allocateTmp();
                const out = "(" +
                    setTmp + "=" + sub(left) + "," +
                    setTmp + ".delete(" + sub(right) + ")," +
                    setTmp + ")";
                state.postExp += setTmp + "=0;\n";
                state.freeTmp(setTmp);
                return out;
            }

            case "num":
                // Handled below
                break;

            default:
                throw new EYCTypeError(exp, "No compiler for -= " + left.ctype.type);
        }

    } else if (exp.children.op !== "=") {
        // Every other case is only valid for numbers
        if (left.ctype.type !== "num")
            throw new EYCTypeError(exp, exp.children.op + " is only valid on numbers");

    }

    switch (left.type) {
        case "IndexExp":
        {
            const leftLeftType = left.children.expression.ctype;
            switch (leftLeftType.type) {
                case "map":
                {
                    const mapTmp = state.allocateTmp(),
                        keyTmp = state.allocateTmp(),
                        valueTmp = state.allocateTmp();

                    let out = "(" +
                        mapTmp + "=" + sub(left.children.expression) + "," +
                        keyTmp + "=" + sub(left.children.index) + "," +
                        valueTmp + "=" + sub(right) + ",";

                    // If we're doing += or -=, do that now
                    if (exp.children.op !== "=") {
                        // We must be num or string, because only that falls through to here

                        // Get the original value
                        const prevValueTmp = state.allocateTmp();
                        if (leftLeftType.keyType.isTuple)
                            out += prevValueTmp + "=" + mapTmp + ".get(eyc.tupleStr(" + keyTmp + "))," +
                                   prevValueTmp + "=" + prevValueTmp + "?" + prevValueTmp + ".value:0,";
                        else
                            out += prevValueTmp + "=" + mapTmp + ".get(eyc.tupleStr(" + keyTmp + "))||0,";

                        // Make the change
                        out += prevValueTmp + exp.children.op + valueTmp + "," +
                            valueTmp + "=" + prevValueTmp + ",";

                        state.postExp += prevValueTmp + "=0;\n";
                        state.freeTmp(prevValueTmp);
                    }

                    if (leftLeftType.keyType.isTuple) {
                        // Maps tuple->* instead are maps string->special object
                        out += mapTmp + ".set(eyc.tupleStr(" + keyTmp + "),{key:" + keyTmp + ",value:" + valueTmp + "}),";
                    } else {
                        out += mapTmp + ".set(" + keyTmp + "," + valueTmp + "),";
                    }

                    out += valueTmp + ")";

                    state.postExp +=
                        mapTmp + "=0;\n" +
                        keyTmp + "=0;\n" +
                        valueTmp + "=0;\n";
                    state.freeTmp(mapTmp);
                    state.freeTmp(keyTmp);
                    state.freeTmp(valueTmp);

                    return out;
                }

                case "set":
                {
                    const setTmp = state.allocateTmp(),
                        valueTmp = state.allocateTmp();

                    console.assert(exp.children.op === "=");

                    let out = "(" +
                        setTmp + "=" + sub(left.children.expression) + "," +
                        valueTmp + "=" + sub(left.children.index) + ",";

                    if (right.type === "BoolLiteral") {
                        // Simpler case
                        const b = JSON.parse(right.children.text);

                        if (leftLeftType.valueType.isTuple) {
                            // Sets of tuples are instead maps of string->tuple
                            out += setTmp + "." + (b?"set":"delete") + "(eyc.tupleStr(" + valueTmp + ")," + valueTmp + "),";
                        } else {
                            out += setTmp + "." + (b?"add":"delete") + "(" + valueTmp + "),";
                        }
                        out += b + ")";

                    } else {
                        // Depends on boolean value
                        const bTmp = state.allocateTmp();

                        out += bTmp + "=" + sub(right) + ",";

                        if (leftLeftType.valueType.isTuple) {
                            out += setTmp + "[" + bTmp + '?"set":"delete"](eyc.tupleStr(' + valueTmp + ")," + valueTmp + "),";
                        } else {
                            out += setTmp + "[" + bTmp + '?"add":"delete"](' + valueTmp + "),";
                        }
                        out += bTmp + ")";

                        state.freeTmp(bTmp);
                    }

                    state.postExp +=
                        setTmp + "=0;\n"
                        valueTmp + "=0;\n";
                    state.freeTmp(setTmp);
                    state.freeTmp(valueTmp);

                    return out;
                }

                default:
                    throw new EYCTypeError(exp, "No compiler for index assignment to " + left.children.expression.ctype.type);
            }
        }

        case "DotExp":
        {
            const leftTmp = state.allocateTmp(),
                rightTmp = state.allocateTmp();
            const name = left.children.id.children.text;
            const iname = left.children.expression.ctype.instanceOf.fieldNames[name];

            let out = "(" +
                leftTmp + "=" + sub(left.children.expression) + "," +
                rightTmp + "=" + sub(right) + ",";

            // If we're doing += or -=, do that now
            if (exp.children.op !== "=") {
                // We must be num or string, because only that falls through to here

                // Get the original value
                const prevValueTmp = state.allocateTmp();
                out += prevValueTmp + "=" + leftTmp + "." + iname + "||0," +
                    prevValueTmp + exp.children.op + rightTmp + "," +
                    rightTmp + "=" + prevValueTmp + ",";

                state.postExp += prevValueTmp + "=0;\n";
                state.freeTmp(prevValueTmp);
            }

            out +=
                JSON.stringify(iname) + "in " + leftTmp + "?" +
                leftTmp + "." + iname + "=" + rightTmp + ":" +
                rightTmp + ")";

            state.postExp +=
                leftTmp + "=0;\n" +
                rightTmp + "=0;\n";
            state.freeTmp(leftTmp);
            state.freeTmp(rightTmp);

            return out;
        }

        case "ID":
            return "(" +
                symbols[left.children.text] + exp.children.op +
                sub(right) +
                ")";

        default:
            throw new EYCTypeError(exp, "No compiler for assignment to " + exp.children.target.type);
    }
}

// Compile an increment/decrement expression
function compileIncDecExpression(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, exp: types.Tree, post: boolean) {
    const subExp = exp.children.expression;
    const op = exp.children.op;

    switch (subExp.type) {
        case "DotExp":
        {
            // Remember that even *having* this field isn't guaranteed!
            const tmpExp = state.allocateTmp();
            const left = subExp.children.expression;
            const name = subExp.children.id.children.text;
            const iname = left.ctype.instanceOf.fieldNames[name];

            const out = "(" +
                tmpExp + "=" + compileExpression(eyc, state, symbols, left) + "," +
                JSON.stringify(iname) + "in " + tmpExp + "?" +
                    (post?"":op) +
                    tmpExp + "." + iname +
                    (post?op:"") +
                ":0)";

            state.postExp += tmpExp + "=0;\n";
            state.freeTmp(tmpExp);
            return out;
        }

        case "ID":
            return "(" +
                (post?"":op) +
                symbols[subExp.children.text] +
                (post?op:"") +
                ")";

        default:
            throw new EYCTypeError(exp, "No compiler for increment/decrement of " + subExp.type);
    }
}

// Compile an expression to bool
function compileExpressionBool(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, exp: types.Tree) {
    let out = compileExpression(eyc, state, symbols, exp);

    switch (exp.ctype.type) {
        // Nullable types
        case "suggestion":
            out = "(" + out + "!==eyc.nil)";
            break;

        case "num":
            out = "(!!" + out + ")";
            break;

        case "bool":
            break;

        default:
            throw new EYCTypeError(exp, "Cannot convert " + exp.ctype.type + " to boolean");
    }

    return out;
}

// Compile this list of suggestions into an object literal
function compileSuggestions(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, suggestions: types.Tree[]) {
    const out = [];
    for (const s of suggestions)
        out.push(compileSuggestion(eyc, state, symbols, s));
    return "[" + out.join(",") + "]";
}

// Compile this suggestion into a field
function compileSuggestion(eyc: types.EYC, state: MethodCompilationState, symbols: Record<string, string>, suggestion: types.Tree) {
    function sub(e: types.Tree) {
        return compileExpression(eyc, state, symbols, e);
    }

    switch (suggestion.type) {
        case "ExtendStatement":
        case "RetractStatement":
        {
            let out = '({action:"' +
                (suggestion.type==="ExtendStatement"?"e":"r") +
                '",target:';

            // Compile the expression
            const exp = suggestion.children.expression;
            console.assert(exp.type === "CastExp");
            out += compileExpression(eyc, state, symbols, exp.children.expression);

            // And get the target type
            out += ",type:" + JSON.stringify(exp.children.type.ctype.instanceOf.prefix) + "})";
            return out;
        }

        case "ExpStatement":
        {
            let out = '({action:"m"';

            const exp = suggestion.children.expression;
            console.assert(exp.type === "CallExp");

            // FIXME: Static methods?

            out +=
                ",target:" + compileExpression(eyc, state, symbols, exp.children.expression.children.expression) +
                ",source:self" +
                ",method:" + JSON.stringify(exp.children.expression.ctype.id) +
                ",args:[";

            const outArgs = [];
            for (const arg of (exp.children.args ? exp.children.args.children : [])) {
                outArgs.push(compileExpression(eyc, state, symbols, arg));
            }

            out += outArgs.join(",") +
                "]})";
            return out;
        }

        default:
            throw new EYCTypeError(suggestion, "No compiler for suggestion " + suggestion.type);
    }
}
