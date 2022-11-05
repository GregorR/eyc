# Objects

Objects in EYC are objects in JavaScript. Field and method names are mangled
with the type name: `<url>$<type>$<field>`. Overridden methods share the name of
their root. Compiled objects look like so:

```
{
    id: <object ID>,
    prefix: <object prefix>,
    type: {<types map>},
    types: [<types array>],
    methods: {<method object>},
    randts: <number>,
    randseed: <string>,
    <fields>
}
```

`<object ID>` is a hopefully-unique ID for the object, prefixed by
`<object prefix>$`. `<types map>` is the set of types, with each (mangled) type
name simply mapping to true. `<types array>` is an array of the types that the
object *explicitly* has, in the order that they were expanded.
`<method object>` is an object generated to have the methods with the correct
inheritance so that the most surface method will always be extracted first.
Each method object additionally has a `proto` field that points to its own
prototype, so that we don't depend on semi-standard `__proto__`.

Random number generation is handled per object, to make it more repeatable.
`randts` is the last timestamp when a random number was generated, and
`randseed` is the (ever-changing) seed of the next random number, only used if
the last random number was generated in the same timestamp. "Randomness" is
actually SHA-1 repeated.

The default object is `null`, which is `eyc.nil`, not JavaScript's `null`.


# Array

Arrays are JavaScript Arrays. In addition, they have an `id` field, like
objects, and a `valueType` field, which stores the basic type of the array's
elements as a string.

The default array is `null`. Array fields in objects are initialized to an empty
array, not `null`.


# Tuples

Tuples are JavaScript arrays.

When tuples are used as keys in maps or items in sets, the maps and sets are
stored slightly differently, because all tuples of the same values should be
indistinguishable. Tuples can be converted into strings which act as keys for
maps and sets.
 
## Maps of tuples

When tuples are keys in maps, the internal JavaScript Map will instead map
string keys to objects of the form `{key: <tuple>, value: <value>}`.

## Sets of tuples

Sets of tuples are stored as maps. The key is the string key, and the value is
the tuple.


# Maps

Maps are stored as JavaScript Maps, with an `id`. For serializability, maps
store the basic type of their keys and values as strings in the fields
`keyType` and `valueType`. If the map is actually a set of tuples, then
`keyType` is `"-set"` and `valueType` is the tuple type.

The default map is `null`. Map fields in objects are initialized to a new map,
not `null`.


# Sets

Sets are stored as JavaScript Sets, with an `id`. For serializability, maps
store the basic type of their values as strings in the field `valueType`.

The default set is `null`. Set fields in objects are initialized to a new set,
not `null`.


# Nums

Numbers are JavaScript numbers.

The default number is 0.


# Strings

Strings are JavaScript strings. The default string is `""`.


# Booleans

Booleans are JavaScript booleans. The default boolean is `false`.


# Suggestions

Suggestions are the most unique and sophisticated type in EYC.

A suggestion is an array of actions, each of which comes in one of three forms:
an extension, a retraction, or a method call. Suggestions are stored as arrays,
with an additional `id` field.

Each suggestion action is an object, with a form dependent on which type of
action.

Extensions and retractions:
```
{
    action: "e" for extension, "r" for retraction,
    target: <target object>,
    type: <class to add/remove>
}
```

Method calls:
```
{
    action: "m",
    target: <target object>,
    source: <source object>,
    method: <method name string>,
    args: [<argument array>]
}
```


# Modules, classes, methods

EYC modules, classes, and methods are not first-class, and are therefore not
values. For importing and exporting, modules and classes are stored in
dictionaries in `eyc`.

Methods are simply JavaScript functions. However, their `this` is not EYC's
`this`.  Instead, they take three arguments before their EYC arguments: `eyc`,
`self`, and `caller`.  `eyc` is the EYC globals needed to run an EYC program,
`self` is EYC's `this`, and `caller` is the calling object. Methods do use
their own `this`, however, to implement `super`.


# Spritesheets

For easy communication between the frontend and backend, spritesheets are
represented directly, but are not first-class values.
