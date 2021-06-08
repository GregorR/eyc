{
    function Tree(type, location, children) {
        this.type = type;
        this.location = location;
        this.children = children;
    }

    function left(type, location, a, b) {
        if (!b) return a;
        var ret = a;
        while (b.length) {
            var c = b.shift();
            ret = new Tree(type, location, {left: ret, op: c[0], right: c[2]});
        }
        return ret;
    }
}

module
 = a:declaration* { return new Tree("Module", location(), a); }

declaration
 = copyrightDecl
 / licenseDecl
 / importDecl
 / aliasDecl
 / classDecl
 / spriteSheetDecl
 / soundDecl
 / fabricDecl
 / prefixDecl

copyrightDecl
 = a:(a:idLike & {return a === "Not" || a === "not";})?
   b:idLike & {return b === "Copyright" || b === "copyright";}
   c:textBlock ";" white
   { return new Tree("CopyrightDecl", location(), {not: a, text: c}); }

licenseDecl
 = a:idLike & {return a === "license";} b:textBlock ";" white { return new Tree("LicenseDecl", location(), {text: b}); }

textBlock
 = a:(a:[^();]+ { return a.join(""); } / textBlockParens)* { return a.join(""); }

textBlockNestable
 = a:(a:[^()]+ { return a.join(""); } / textBlockParens)* { return a.join(""); }

textBlockParens
 = a:"(" b:textBlockNestable c:")" { return a + b + c; }

importDecl
 = a:exportClause? import b:asClause "{" white c:module "}" white { return new Tree("InlineImportDecl", location(), {exportClause: a, asClause: b, module: c}); }
 / a:exportClause? import b:package c:versionClause* d:asClause? ";" white { return new Tree("ImportDecl", location(), {exportClause: a, package: b, version: c, asClause: d}); }

exportClause
 = export a:mainClause? { return new Tree("ExportClause", location(), {main: a}); }

mainClause
 = a:idLike & {return a === "main";} {return a;}

package
 = a:[^ \t\r\n;]* white { return a.join(""); }

versionClause
 = a:("@"/"^"/">="/">"/"<="/"<") white b:package { return new Tree("Version", location(), {comparator: a, version: b}); }

asClause
 = as a:id { return a; }

aliasDecl
 = a:exportClause? alias b:name c:asClause? ";" white { return new Tree("AliasDecl", location(), {exportClause: a, name: b, asClause: c}); }
 / alias a:name ".*" white ";" white { return new Tree("AliasStarDecl", location(), {name: a}); }

spriteSheetDecl
 = a:exportClause? b:idLike & {return b === "sprites";} c:id d:package "{" white e:sprite* "}" white {
     return new Tree("SpriteSheetDecl", location(), {exportClause: a, id: c, url: d, sprites: e});
 }

soundDecl
 = a:exportClause? b:idLike & {return b === "sounds";} c:id d:package "{" white e:sound* "}" white {
     return new Tree("SoundSetDecl", location(), {exportClause: a, id: c, url: d, sounds: e});
 }

fabricDecl
// With properties
 = a:exportClause? b:idLike & {return b === "fabric";} c:id d:package "{" white e:fabricProp* "}" white {
     return new Tree("FabricDecl", location(), {exportClause: a, id: c, url: d, props: e});
 }
// Without properties
 / a:exportClause? b:idLike & {return b === "fabric";} c:id d:package ";" white {
     return new Tree("FabricDecl", location(), {exportClause: a, id: c, url: d, props: []});
 }

prefixDecl
 = "@prefix" ![a-zA-Z0-9_] white a:textBlock ";" white { return new Tree("PrefixDecl", location(), {text: a}); }

classDecl
 = a:exportClause? class b:id c:extendsClause? "{" white d:memberDeclList "}" white { return new Tree("ClassDecl", location(), {exportClause: a, id: b, extendsClause: c, members: d}); }

extendsClause
 = ":" white a:nameList { return a; }

nameList
 = a:name b:nameListNext? { var ret = new Tree("NameList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

nameListNext
 = "," white a:nameList { return a; }

memberDeclList
 = a:memberDecl* { return new Tree("MemberDeclList", location(), a); }

memberDecl
 = a:override? b:mutating? c:this? d:type e:id "(" white f:paramList? ")" white g:block {
     return new Tree("MethodDecl", location(), {
         override: a,
         mutating: b,
         thisClause: c,
         type: d,
         id: e,
         params: f,
         body: g
     });
 }
 / a:type b:fieldDeclList ";" white { return new Tree("FieldDecl", location(), {type: a, decls: b}); }

paramList
 = a:param b:paramListNext? { var ret = new Tree("ParamList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

param
 = a:type b:id { return new Tree("Param", location(), {type: a, id: b}); }

paramListNext
 = "," white a:paramList { return a; }

fieldDeclList
 = a:fieldDecl b:fieldDeclListNext? { var ret = new Tree("FieldDeclList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

fieldDecl
 = a:id b:fieldInitializer? { return new Tree("FieldDeclPart", location(), {id: a, initializer: b}); }

fieldDeclListNext
 = "," white a:fieldDeclList { return a; }

fieldInitializer
 = "=" white a:literal { return a; }

statement
 = block
 / varDecl
 / ifStatement
 / whileStatement
 / forStatement
 / returnStatement
 / extendStatement
 / expStatement

block
 = "{" white a:statement* "}" white { return new Tree("Block", location(), a); }

varDecl
 = a:type b:varDeclList ";" white { return new Tree("VarDecl", location(), {type: a, decls: b}); }

varDeclList
 = a:varDeclPart b:varDeclListNext? { var ret = new Tree("VarDeclList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

varDeclPart
 = a:id b:varDeclInitializer? { return new Tree("VarDeclPart", location(), {id: a, initializer: b}); }

varDeclListNext
 = "," white a:varDeclList { return a; }

varDeclInitializer
 = "=" white a:expression { return a; }

ifStatement
 = if "(" white a:expression ")" white b:statement c:elseClause? { return new Tree("IfStatement", location(), {condition: a, ifStatement: b, elseStatement: c}); }

elseClause
 = else a:statement { return a; }

whileStatement
 = while "(" white a:expression ")" white b:statement { return new Tree("WhileStatement", location(), {condition: a, body: b}); }

forStatement
 = for "(" white a:expression? ";" white b:expression? ";" white c:expression? ")" white d:statement {
     return new Tree("ForStatement", location(), {initializer: a, condition: b, increment: c, body: d});
 }
 / for "(" white a:varDecl b:expression? ";" white c:expression? ")" white d:statement {
     return new Tree("ForStatement", location(), {initializer: a, condition: b, increment: c, body: d});
 }
 // FIXME: Types don't work like this :(
 / for a:reverse? "(" white b:type? c:id in d:expression ")" white e:statement {
     return new Tree("ForInStatement", location(), {reverseClause: a, type: b, id: c, collection: d, body: e});
 }
 / for a:reverse? "(" white b:type? c:id "," white d:type? e:id in f:expression ")" white g:statement {
     return new Tree("ForInMapStatement", location(), {reverseClause: a, keyType: b, key: c, valueType: d, value: e, collection: f, body: g});
 }

reverse
 = a:idLike & {return a === "reverse";} {return a;}

returnStatement
 = return a:expression? ";" white { return new Tree("ReturnStatement", location(), {value: a}); }

extendStatement
 // In practice, the expression must be a cast expression for the extend statement to be valid
 = extend a:expression ";" white { return new Tree("ExtendStatement", location(), {expression: a}); }
 / retract a:expression ";" white { return new Tree("RetractStatement", location(), {expression: a}); }

expStatement
 = a:expression ";" white { return new Tree("ExpStatement", location(), {expression: a}); }

expression
 = a:orExp b:(assignmentOp white expression)? {
     if (b)
         return new Tree("AssignmentExp", location(), {target: a, op: b[0], value: b[2]});
     return a;
 }

assignmentOp
 = "=" / "*=" / "/=" / "%=" / "+=" / "-="

orExp
 = a:andExp b:("||" white andExp)* { return left("OrExp", location(), a, b); }

andExp
 = a:eqExp b:("&&" white eqExp)* { return left("AndExp", location(), a, b); }

eqExp
 = a:relExp b:(eqOp white relExp)* { return left("EqExp", location(), a, b); }

eqOp
 = "==" / "!="

relExp
 = a:addExp b:(relOp white addExp)* { return left("RelExp", location(), a, b); }

relOp
 = "<=" / "<" / ">=" / ">" / in { return "in"; } / is { return "is"; }

addExp
 = a:mulExp b:(addOp white mulExp)* { return left("AddExp", location(), a, b); }

addOp
 = "+" / "-"

mulExp
 = a:unExp b:(mulOp white unExp)* { return left("MulExp", location(), a, b); }

mulOp
 = "*" / "/" !"/" { return "/"; } / "%"

unExp
 = a:unOp white b:unExp { return new Tree("UnExp", location(), {op: a, expression: b}); }
 / postExp

unOp
 = "++" / "--" / "+" / "-" / "!"

postExp
 = a:primary b:postExpPart* {
     var ret = a;
     while (b.length) {
         var next = b.shift();
         next.children.expression = ret;
         ret = next;
     }
     return ret;
 }

postExpNoType
 = a:primary b:postExpPartNoType* {
     var ret = a;
     while (b.length) {
         var next = b.shift();
         next.children.expression = ret;
         ret = next;
     }
     return ret;
 }

postExpPart
 = postExpPartNoType
 / ":" white a:type { return new Tree("CastExp", location(), {type: a}); }

postExpPartNoType
 = "++" white { return new Tree("PostIncExp", location(), {op: "++"}); }
 / "--" white { return new Tree("PostDecExp", location(), {op: "--"}); }
 / "(" white a:argList? ")" white { return new Tree("CallExp", location(), {args: a}); }
 / "[" white a:expression "]" white { return new Tree("IndexExp", location(), {index: a}); }
 / suggest "{" white a:statement* "}" white {
     return new Tree("SuggestionExtendExp", location(), {suggestions: a});
 }
 / "." white a:id { return new Tree("DotExp", location(), {id: a}); }

argList
 = a:expression b:argListNext? { var ret = new Tree("ArgList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

argListNext
 = "," white a:argList { return a; }

primary
 = literal
 / parenExp
 / suggest "{" white a:statement* "}" white { return new Tree("SuggestionLiteral", location(), a); }
 / new a:("[" white a:expression "]" white { return a; })? b:type? c:block? {
     return new Tree("NewExp", location(), {prefix: a, type: b, withBlock: c});
 }
 / super "(" white a:argList? ")" white { return new Tree("SuperCall", location(), {args: a}); }
 / this { return new Tree("This", location(), {}); }
 / caller { return new tree("Caller", location(), {}); }
 / "@js" white "(" white a:varDeclList? ")" white "{" b:jsBlock "}" white ":" white c:type {
     return new Tree("JavaScriptExpression", location(), {pass: a, body: b, type: c});
 }
 / id

parenExp
 = "(" white a:expression ")" white { return a; }

jsBlock
 = a:(a:[^{}]+ { return a.join(""); } / jsBlockBraces)* { return a.join(""); }

jsBlockBraces
 = a:"{" b:jsBlock c:"}" { return a + b + c; }

literal
 = hexLiteral
 / b64Literal
 / decLiteral
 / stringLiteral
 / boolLiteral
 / arrayLiteral
 / tupleLiteral
 / null { return new Tree("NullLiteral", location(), {}); }

hexLiteral
 = "0x" a:[0-9A-Fa-f]* b:("." [0-9A-Fa-f]*)? white { return new Tree("HexLiteral", location(), {text: a.join("") + (b ? b[0] + b[1].join("") : "")}); }

b64Literal
 = "0~" a:[0-9A-Za-z|~]* b:("." [0-9A-Za-z|~]*)? white { return new Tree("B64Literal", location(), {text: a.join("") + (b ? b[0] + b[1].join("") : "")}); }

decLiteral
 = a:[0-9]+ b:"." c:[0-9]* white { return new Tree("DecLiteral", location(), {text: a.join("") + b + c.join("")}); }
 / a:"." b:[0-9]+ white { return new Tree("DecLiteral", location(), {text: a + b.join("")}); }
 / a:[0-9]+ white { return new Tree("DecLiteral", location(), {text: a.join("")}); }

stringLiteral
 = a:'"' b:stringChar* c:'"' white { return new Tree("StringLiteral", location(), {text: a + b.join("") + c}); }

stringChar
 = [^"\\]
 / a:"\\" b:. { return a + b; }

boolLiteral
 = true { return new Tree("BoolLiteral", location(), {text: "true"}); }
 / false { return new Tree("BoolLiteral", location(), {text: "false"}); }

arrayLiteral
 = "[" white a:argList? "]" white { return new Tree("ArrayLiteral", location(), {elements: a}); }

tupleLiteral
 = tuple "(" white a:argList ")" white { return new Tree("TupleLiteral", location(), {elements: a}); }

type
 = set "(" white a:type ")" white { return new Tree("TypeSet", location(), {type: a}); }
 / array "(" white a:type ")" white { return new Tree("TypeArray", location(), {type: a}); }
 / tuple "(" white a:typeList ")" white { return new Tree("TypeTuple", location(), {types: a}); }
 / map "(" white a:type "," white b:type ")" white { return new Tree("TypeMap", location(), {keyType: a, valueType: b}); }
 / num { return new Tree("TypeNum", location(), {}); }
 / string { return new Tree("TypeString", location(), {}); }
 / bool { return new Tree("TypeBool", location(), {}); }
 / suggestion { return new Tree("TypeSuggestion", location(), {}); }
 / void { return new Tree("TypeVoid", location(), {}); }
 / a:name { return new Tree("TypeName", location(), {name: a}); }

typeList
 = a:type b:typeListNext? { var ret = new Tree("TypeList", location(), [a]); if (b) ret.children = ret.children.concat(b.children); return ret; }

typeListNext
 = "," white a:typeList { return a; }

sprite
 = a:id "(" white b:argList? ")" white ";" white { return new Tree("Sprite", location(), {id: a, args: b}); }
 / copyrightDecl
 / licenseDecl

sound
 // An actual sound
 = a:id ";" white { return new Tree("Sound", location(), {id: a, args: {children: []}}); }
 / a:id "(" white b:argList? ")" white ";" white { return new Tree("Sound", location(), {id: a, args: b}); }
 // A property of this sound set
 / a:id "=" white b:literal ";" white { return new Tree("SoundSetProperty", location(), {key: a, value: b}); }
 // Copyright and license info
 / copyrightDecl
 / licenseDecl

fabricProp
 = a:id "=" white b:literal ";" white { return new Tree("FabricProperty", location(), {key: a, value: b}); }
 / copyrightDecl
 / licenseDecl

name
 = a:id b:dotName? { var ret = new Tree("Name", location(), [a]); if (b) { ret.children = ret.children.concat(b.children); } return ret; }

dotName
 = "." white a:name { return a; }

id
 = a:idLike & {
    return (a !== "alias") &&
        (a !== "array") &&
        (a !== "as") &&
        (a !== "bool") &&
        (a !== "caller") &&
        (a !== "class") &&
        (a !== "else") &&
        (a !== "export") &&
        (a !== "false") &&
        (a !== "for") &&
        (a !== "if") &&
        (a !== "in") &&
        (a !== "is") &&
        (a !== "import") &&
        (a !== "map") &&
        (a !== "mutating") &&
        (a !== "new") &&
        (a !== "null") &&
        (a !== "num") &&
        (a !== "override") &&
        (a !== "return") &&
        (a !== "set") &&
        (a !== "string") &&
        (a !== "suggest") &&
        (a !== "suggestion") &&
        (a !== "super") &&
        (a !== "this") &&
        (a !== "true") &&
        (a !== "tuple") &&
        (a !== "void") &&
        (a !== "while");
 } { return new Tree("ID", location(), {text: a}); }

idLike
 = a:[A-Za-z_] b:[A-Za-z0-9_]* white { return a + b.join(""); }

alias = a:idLike & {return a === "alias";}
array = a:idLike & {return a === "array";}
as = a:idLike & {return a === "as";}
bool = a:idLike & {return a === "bool";}
caller = a:idLike & {return a === "caller";}
class = a:idLike & {return a === "class";}
else = a:idLike & {return a === "else";}
export = a:idLike & {return a === "export";}
extend = a:idLike & {return a === "extend";}
false = a:idLike & {return a === "false";}
for = a:idLike & {return a === "for";}
if = a:idLike & {return a === "if";}
import = a:idLike & {return a === "import";}
in = a:idLike & {return a === "in";}
is = a:idLike & {return a === "is";}
map = a:idLike & {return a === "map";}
mutating = a:idLike & {return a === "mutating";}
new = a:idLike & {return a === "new";}
null = a:idLike & {return a === "null";}
num = a:idLike & {return a === "num";}
override = a:idLike & {return a === "override";}
retract = a:idLike & {return a === "retract";}
return = a:idLike & {return a === "return";}
set = a:idLike & {return a === "set";}
string = a:idLike & {return a === "string";}
suggest = a:idLike & {return a === "suggest";}
suggestion = a:idLike & {return a === "suggestion";}
super = a:idLike & {return a === "super";}
this = a:idLike & {return a === "this";}
true = a:idLike & {return a === "true";}
tuple = a:idLike & {return a === "tuple";}
void = a:idLike & {return a === "void";}
while = a:idLike & {return a === "while";}

white
 = whitePart*

whitePart
 = [ \t\r\n]
 / "/*" commentChar* "*/"
 / "//" [^\n]* "\n"

commentChar
 = [^*]
 / "*" !"/"
