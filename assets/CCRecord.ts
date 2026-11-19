/**
 * CCRecord v0.2.5 — experimental typed key/value CCClass factory for Creator 3.8.
 *
 * This is intentionally a SERIALIZABLE WRAPPER, not a plain JS Record.
 * It stores entries as a CCClass array, so scene/prefab serialization can
 * preserve Engine object references (Node/Asset) and scalar values.
 *
 * In two-argument mode enum schemas are identified by KEY CATEGORY and VALUE CLASS,
 * not by the enum member list. Numeric enum key values remain serialized unchanged.
 * There is one supported enum schema per enum/value pairing in a JS VM; see README.
 */
import { _decorator, CCString, CCInteger, CCFloat, CCBoolean, Enum, js, Node, Asset, Component } from 'cc';

const { ccclass, property } = _decorator;

export type RecordKey = string | number | object;
export type PrimitiveRecordKey = string | number;
export interface CCRecordOptions<K extends RecordKey> {
    /** Optional for object keys. Enables lookup using a stable field after deserialization.
     * Without keyField, object-key lookup uses reference identity (Map semantics). */
    keyField?: K extends object ? keyof K & string : never;
}

export type RecordTypeToken = any; // Runtime Cocos type tokens vary (primitives, enums, CCClasses)

export interface CCRecordEntry<K extends RecordKey, V> {
    key: K;
    value: V;
}

export interface ICCRecord<K extends RecordKey, V> {
    entries: CCRecordEntry<K, V>[];
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    remove(key: K): boolean;
    has(key: K): boolean;
    /** Snapshot Map. Its object keys are serialized key objects, not lookup-by-id Map keys. */
    toMap(): Map<K, V>;
    /** Only valid for string / numeric keys, not for custom object keys. */
    toRecord(): [K] extends [PrimitiveRecordKey] ? Record<Extract<K, PrimitiveRecordKey>, V> : never;
}

export type CCRecordConstructor<K extends RecordKey, V> = new () => ICCRecord<K, V>;

/**
 * A typed, index-accessible serializable instance.
 * Use as the field initializer, not a plain `{}`. Cocos still serializes
 * its internal `entries` CCClass array; index access works at runtime.
 */
export function createRecord<K extends PrimitiveRecordKey, V>(
    RecordClass: CCRecordConstructor<K, V>,
): Record<K, V> {
    return new RecordClass() as unknown as Record<K, V>;
}

const registry = new Map<string, {
    keyType: RecordTypeToken;
    valueType: RecordTypeToken;
    keyField?: string;
    ctor: CCRecordConstructor<any, any>;
    entryCtor: new () => CCRecordEntry<any, any>;
}>();

const isValidId = (id: string) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id);

/** The third argument contains only named options; serialized IDs are derived from types. */
function validateOptions<K extends RecordKey>(options?: CCRecordOptions<K>): void {
    if (options === undefined) return;
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('[CCRecord] The third argument must be an options object.');
    }
    const unsupported = Object.keys(options).filter(name => name !== 'keyField');
    if (unsupported.length) {
        throw new Error('[CCRecord] Unsupported option(s): ' + unsupported.join(', '));
    }
}

/**
 * Cocos can clear class name/id lookup tables during an Editor script refresh
 * while the JS module and our local factory registry remain cached. Check
 * BOTH tables whenever a CCRecord constructor is requested. Never hijack a
 * different registered class: that could corrupt scene/prefab data.
 */
function ensureRegistered(name: string, ctor: Function): void {
    const byName = js.getClassByName(name);
    const byId = js.getClassById(name);
    if ((byName && byName !== ctor) || (byId && byId !== ctor)) {
        throw new Error(`[CCRecord] Class registry collision at "${name}". ` +
            'Use distinct @ccclass names or CCRecordEnumId for distinct enum schemas; do not save the affected scene.');
    }
    if (byName !== ctor || byId !== ctor) {
        // setClassAlias() safely registers BOTH name and id without replacing
        // the ctor's serialized class identity. It fails on collisions.
        js.setClassAlias(ctor as any, name);
    }
    if (js.getClassByName(name) !== ctor || js.getClassById(name) !== ctor) {
        throw new Error(`[CCRecord] Unable to register serialized class "${name}".`);
    }
}

/** Call inside a running Scene script to diagnose missing generated classes. */
export function checkCCRecordClasses(): Array<{ name: string; registered: boolean }> {
    const result: Array<{ name: string; registered: boolean }> = [];
    for (const [id, entry] of registry) {
        for (const [name, ctor] of [
            [`CVHRecordEntry_${id}`, entry.entryCtor],
            [`CVHRecord_${id}`, entry.ctor],
        ] as const) {
            result.push({ name, registered: js.getClassById(name) === ctor && js.getClassByName(name) === ctor });
        }
    }
    return result;
}


// Numeric Cocos Enums are plain JS objects. TypeScript numeric enum objects can
// contain reverse mappings ('0': 'Idle'); only named numeric values are keys.
function enumItems(type: RecordTypeToken): Array<{ name: string; value: number }> {
    if (!type || typeof type !== 'object') return [];
    return Object.keys(type)
        .filter((name) => !/^-?\d+$/.test(name) && typeof type[name] === 'number'
            && Number.isFinite(type[name]))
        .map((name) => ({ name, value: type[name] }));
}

function isEnumKeyType(type: RecordTypeToken): boolean {
    if (type === CCString || type === CCInteger || type === CCFloat || type === CCBoolean) return false;
    // Enum.isEnum is available in the Cocos engine; the item fallback also
    // supports numeric TS enum objects in simplified test environments.
    return (typeof (Enum as any).isEnum === 'function' && (Enum as any).isEnum(type))
        || enumItems(type).length > 0;
}

// Optional stable identity for a numeric Enum. Unlike enumAutoName(),
// this remains the same when members are added, removed or renamed.
// Call at module initialization BEFORE CCRecord(EnumType, ValueType).
// This changes how new class IDs are generated. Keep the name stable once data is saved.
const ENUM_ID_SYMBOL = Symbol.for('cvh.ccrecord.enumStableId');
export function CCRecordEnumId<T extends object>(enumType: T, stableName: string): T {
    if (!isEnumKeyType(enumType)) throw new Error('[CCRecord] CCRecordEnumId expects a numeric enum.');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(stableName)) {
        throw new Error('[CCRecord] Stable enum name must be a short ASCII identifier.');
    }
    Object.defineProperty(enumType, ENUM_ID_SYMBOL, {
        value: stableName, configurable: true, enumerable: false,
    });
    return enumType;
}

// TypeScript numeric enums do not carry a stable declaration name at runtime.
// Never fingerprint their member list into a persisted CCClass ID: adding an
// enum member would change the class name and cause missing classes on reload.
// Two-argument mode groups enum stores by key CATEGORY + value type. This is
// intentionally independent of member names/order/values. Distinct enums with
// the SAME value type must not be used as independent schemas in this mode.
function enumAutoName(_type: RecordTypeToken): string {
    return 'Enum';
}

// Treat a new Enum object as a refresh of the same enum only when at least
// one named member retains its numeric value. This is the common edit cycle:
// append/rename some members in source, then Editor recompiles that script.
// Without a stable name supplied by TS there is no reliable way to distinguish
// two entirely different enums with the same VALUE type.
function enumHasStableOverlap(before: RecordTypeToken, after: RecordTypeToken): boolean {
    const existing = new Map(enumItems(before).map(x => [x.name, x.value]));
    return enumItems(after).some(x => existing.has(x.name) && existing.get(x.name) === x.value);
}

function updateEnumInPlace(before: RecordTypeToken, after: RecordTypeToken): void {
    if (before === after) return;
    const oldList = typeof (Enum as any).getList === 'function'
        ? (Enum as any).getList(before) : before.__enums__;
    for (const property of Object.keys(before)) {
        if (typeof before[property] === 'number' || /^-?\d+$/.test(property)) delete before[property];
    }
    for (const property of Object.keys(after)) {
        if (typeof after[property] === 'number' || /^-?\d+$/.test(property)) before[property] = after[property];
    }
    const fresh = enumItems(after).sort((a, b) => a.value - b.value);
    // Preserve any array reference captured by Cocos property metadata.
    if (Array.isArray(oldList)) {
        oldList.splice(0, oldList.length, ...fresh);
        if (before.__enums__ !== oldList) {
            try { before.__enums__ = oldList; } catch (_err) {}
        }
    } else if (typeof (Enum as any).getList === 'function') {
        try { before.__enums__ = null; (Enum as any).getList(before); } catch (_err) {}
    }
}

function stableTypeName(type: RecordTypeToken): string {
    if (type === CCString) return 'String';
    if (type === CCInteger) return 'Integer';
    if (type === CCFloat) return 'Float';
    if (type === CCBoolean) return 'Boolean';
    if (isEnumKeyType(type)) {
        const named = type[ENUM_ID_SYMBOL];
        return named ? 'Enum_' + named : enumAutoName(type);
    }
    // For custom classes, @ccclass names supply the stable serialized identity.
    const engineName = typeof type === 'function' ? js.getClassName(type) : '';
    const name = String(engineName || type?.name || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!name || name === '_') {
        throw new Error('[CCRecord] The type must have a stable @ccclass name.');
    }
    return name;
}


function initialValue(type: RecordTypeToken): any {
    if (type === CCString) return '';
    if (type === CCInteger || type === CCFloat) return 0;
    if (type === CCBoolean) return false;
    if (isEnumKeyType(type)) {
        const first = enumItems(type)[0];
        if (!first) throw new Error('[CCRecord] The enum has no numeric keys.');
        return first.value;
    }
    // Plain @ccclass value objects should have editable nested fields from the
    // start. Cocos scene references (Node / Asset / Component) must stay null.
    if (typeof type === 'function') {
        if (type === Node || type === Asset || type === Component ||
            type.prototype instanceof Node || type.prototype instanceof Asset ||
            type.prototype instanceof Component) return null;
        if (typeof (js as any).getClassId === 'function' && (js as any).getClassId(type)) {
            return new type();
        }
    }
    return null;
}

/**
 * Index-access Record constructor. In TWO-ARGUMENT mode the generated name
 * is based on Enum category + Value type, never on the Enum's member list.
 *
 * @example
 *   const Store = CCIndexRecord<Slot, Node | null>(Slot, Node);
 *   // @property(Store) nodes = new Store();
 *
 * Distinct enum schemas sharing a value type should call
 * CCRecordEnumId(enum, 'StableEnumName') before constructing the record.
 */
export function CCIndexRecord<K extends PrimitiveRecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    options?: CCRecordOptions<K>,
): new () => Record<K, V> {
    if (arguments.length > 3) throw new Error('[CCRecord] Expected at most three arguments.');
    return CCRecordClass<K, V>(keyType, valueType, options) as unknown as new () => Record<K, V>;
}

/**
 * Property metadata for `@property(CCRecord(KeyType, ValueType))`.
 *
 * In Creator 3.8.8, a `default` factory on a property-options object
 * initializes a new serialized wrapper instance for each owning CCClass.
 * `Record<K,V>` is a compile-time view: runtime data remains a Store Proxy
 * whose `entries` are serializable @ccclass objects.
 *
 * IMPORTANT: Do not combine an omitted initializer with
 * `useDefineForClassFields: true`: emitted JS field definitions may overwrite
 * the CCClass-created default with `undefined`.
 *
 * Serialized class names are generated from key and value types.
 * Keep their @ccclass names (or Enum IDs) stable after saving data.
 */
export interface CCRecordPropertyOptions<K extends RecordKey, V> {
    type: CCRecordConstructor<K, V>;
    default: () => ICCRecord<K, V>;
}

export function CCRecord<K extends RecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    options?: CCRecordOptions<K>,
): CCRecordPropertyOptions<K, V> {
    if (arguments.length > 3) throw new Error('[CCRecord] Expected at most three arguments.');
    const RecordClass = CCRecordClass<K, V>(keyType, valueType, options);
    // `constructor === Object` lets Cocos property() treat this as full options.
    // Every owner gets a distinct Store instance; no shared entries array.
    return { type: RecordClass, default: () => new RecordClass() };
}

/**
 * Construct a serializable Cocos class for Record<K,V>.
 *
 * API: CCRecordClass<Key, Value>(KeyType, ValueType, { keyField: 'id' })
 * The third options object is optional; serialized class names are generated
 * from stable @ccclass names or CCRecordEnumId annotations.
 * For numeric enums, call Enum(YourEnum) to populate the Inspector dropdown.
 * The same schema returns the same constructor.
 */
export function CCRecordClass<K extends RecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    options?: CCRecordOptions<K>,
): CCRecordConstructor<K, V> {
    if (arguments.length > 3) throw new Error('[CCRecord] Expected at most three arguments.');
    validateOptions(options);
    const id = stableTypeName(keyType) + '_' + stableTypeName(valueType);
    if (!isValidId(id)) {
        throw new Error('[CCRecord] Generated class name is invalid; use shorter stable @ccclass / enum names: ' + id);
    }
    const keyIsClass = typeof keyType === 'function' && keyType !== CCString && keyType !== CCInteger;
    const keyField = keyIsClass ? options?.keyField as string | undefined : undefined;
    if (keyType !== CCString && keyType !== CCInteger && !isEnumKeyType(keyType) && !keyIsClass) {
        throw new Error('[CCRecord] Keys must be CCString, CCInteger, a numeric Enum, or a serializable custom class.');
    }
    if (keyIsClass) {
        // A keyField is optional. Without one, use object reference identity,
        // the same behavior as a JS Map (no cross-deserialization lookup by value).
        if (keyField !== undefined && !/^[A-Za-z_$][\w$]*$/.test(keyField)) {
            throw new Error('[CCRecord] keyField must be a valid property name.');
        }
        if (typeof (js as any).getClassId === 'function' && !(js as any).getClassId(keyType)) {
            throw new Error('[CCRecord] Custom class keys must use @ccclass.');
        }
    }
    if (isEnumKeyType(keyType) && enumItems(keyType).length === 0) {
        throw new Error('[CCRecord] Enum has no numeric members.');
    }
    const prev = registry.get(id);
    if (prev) {
        const enumRefresh = prev.keyType !== keyType &&
            isEnumKeyType(prev.keyType) && isEnumKeyType(keyType) &&
            prev.valueType === valueType && prev.keyField === keyField;
        if (prev.valueType !== valueType || prev.keyField !== keyField ||
            (prev.keyType !== keyType && !enumRefresh)) {
            throw new Error('[CCRecord] Serialized type collision at ' + id +
                '. Two different schemas are using the same class name.');
        }
        if (enumRefresh) {
            if (!enumHasStableOverlap(prev.keyType, keyType)) {
                throw new Error('[CCRecord] Ambiguous Enum schema at ' + id +
                    '. These Enum objects have no shared name/value pairs. ' +
                    'Use CCRecordEnumId to distinguish different enums; do not save while this is unresolved.');
            }
            // Hot-reloading a script may recreate the Enum object while
            // preserving the imported CCRecord module cache. Keep the old
            // object used by the Entry metadata, but refresh its options.
            updateEnumInPlace(prev.keyType, keyType);
        }
        ensureRegistered('CVHRecordEntry_' + id, prev.entryCtor);
        ensureRegistered('CVHRecord_' + id, prev.ctor);
        return prev.ctor as CCRecordConstructor<K, V>;
    }

    @ccclass('CVHRecordEntry_' + id)
    class Entry implements CCRecordEntry<K, V> {
        @property({ type: keyType })
        key: K = (keyIsClass ? new keyType() : initialValue(keyType)) as K;

        @property({ type: valueType })
        value: V = initialValue(valueType) as V;
    }

    @ccclass('CVHRecord_' + id)
    class Store implements ICCRecord<K, V> {
        // The Proxy remains an actual Store/CCClass instance (instanceof Store).
        // It only maps arbitrary index keys to the serializable entries array.
        // Expose record keys for Object.keys/Object.entries/for..in while keeping
        // the real serialized `entries` property reachable through metadata.
        // Cocos CCClass serializes declared @property fields, not Object.keys().
        // This is still an EXPERIMENTAL proxy: validate scene/prefab round-trips.
        constructor() {
            const reserved = new Set(['entries', 'get', 'set', 'remove', 'has',
                'toRecord', 'toMap', 'constructor', '__proto__', 'prototype', 'toString',
                'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable']);
            const propertyKey = (name: PropertyKey): K | undefined => {
                if (keyIsClass || typeof name !== 'string' || reserved.has(name) || name.startsWith('_')) return undefined;
                if (keyType === CCInteger || isEnumKeyType(keyType)) {
                    // JS converts numeric index property names to strings.
                    if (!/^-?(0|[1-9]\d*)$/.test(name)) return undefined;
                    return Number(name) as K;
                }
                return name as K;
            };
            // Enumerable virtual keys reflect the LAST value of duplicate entries,
            // matching the existing get() semantics. Avoid exposing internal API
            // names (entries/get/set/etc.) as indexed properties.
            const recordKeys = (target: Store): string[] => {
                const unique = new Set<string>();
                for (const entry of Array.isArray(target.entries) ? target.entries : []) {
                    const name = typeof entry?.key === 'number' || typeof entry?.key === 'string'
                        ? String(entry.key) : '';
                    if (propertyKey(name) !== undefined) unique.add(name);
                }
                // Match normal JS object's numeric-index enumeration ordering.
                const keys = Array.from(unique);
                const arrayIndex = (key: string): number | null => {
                    if (!/^(0|[1-9]\d*)$/.test(key)) return null;
                    const num = Number(key);
                    return num >= 0 && num < 4294967295 && String(num) === key ? num : null;
                };
                return keys.sort((a, b) => {
                    const ai = arrayIndex(a), bi = arrayIndex(b);
                    if (ai !== null && bi !== null) return ai - bi;
                    if (ai !== null) return -1;
                    if (bi !== null) return 1;
                    return 0;
                });
            };
            return new Proxy(this, {
                ownKeys(target) {
                    const real = Reflect.ownKeys(target);
                    // ES Proxy invariant: non-extensible targets cannot report
                    // virtual properties. This does not affect normal CCClasses.
                    if (!Object.isExtensible(target)) return real;
                    const names = new Set<PropertyKey>(real);
                    for (const key of recordKeys(target)) names.add(key);
                    return Array.from(names) as Array<string | symbol>;
                },
                getOwnPropertyDescriptor(target, name) {
                    const actual = Reflect.getOwnPropertyDescriptor(target, name);
                    if (actual) {
                        // Hide only the internal array from Object.keys(), NOT
                        // from Cocos's @property metadata nor normal access.
                        if (name === 'entries' && actual.configurable && Object.isExtensible(target)) {
                            return { ...actual, enumerable: false };
                        }
                        return actual;
                    }
                    if (Object.isExtensible(target)) {
                        const key = propertyKey(name);
                        if (key !== undefined && target.has(key)) {
                            return {
                                configurable: true,
                                enumerable: true,
                                writable: true,
                                value: target.get(key),
                            };
                        }
                    }
                    return undefined;
                },
                get(target, name, receiver) {
                    const key = propertyKey(name);
                    if (key !== undefined && target.has(key)) return target.get(key);
                    return Reflect.get(target, name, receiver);
                },
                set(target, name, value, receiver) {
                    const key = propertyKey(name);
                    if (key !== undefined) { target.set(key, value); return true; }
                    return Reflect.set(target, name, value, receiver);
                },
                has(target, name) {
                    const key = propertyKey(name);
                    return (key !== undefined && target.has(key)) || Reflect.has(target, name);
                },
                deleteProperty(target, name) {
                    const key = propertyKey(name);
                    return key !== undefined ? (target.remove(key), true) : Reflect.deleteProperty(target, name);
                },
            }) as Store;
        }

        @property({ type: [Entry] })
        entries: Entry[] = [];

        private sameKey(a: K, b: K): boolean {
            if (!keyIsClass || !keyField) return a === b;
            if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
            const left = (a as any)[keyField!];
            const right = (b as any)[keyField!];
            return (typeof left === 'string' || typeof left === 'number')
                && left !== '' && left === right;
        }

        get(key: K): V | undefined {
            // Last matching key wins, including keys with the same stable id.
            for (let index = this.entries.length - 1; index >= 0; index--) {
                if (this.sameKey(this.entries[index].key, key)) return this.entries[index].value;
            }
            return undefined;
        }

        has(key: K): boolean {
            return this.entries.some((candidate) => this.sameKey(candidate.key, key));
        }

        set(key: K, value: V): this {
            if (keyIsClass && keyField) {
                const id = (key as any)?.[keyField];
                if ((typeof id !== 'string' && typeof id !== 'number') || id === '') {
                    throw new Error('[CCRecord] Custom key requires a non-empty primitive ' + keyField);
                }
            }
            const existing = this.entries.slice().reverse().find((candidate) => this.sameKey(candidate.key, key));
            if (existing) {
                existing.value = value;
            } else {
                const entry = new Entry();
                entry.key = key;
                entry.value = value;
                this.entries.push(entry);
            }
            return this;
        }

        remove(key: K): boolean {
            let removed = false;
            for (let index = this.entries.length - 1; index >= 0; index--) {
                if (this.sameKey(this.entries[index].key, key)) {
                    this.entries.splice(index, 1);
                    removed = true;
                }
            }
            return removed;
        }

        toMap(): Map<K, V> {
            return new Map(this.entries.map((entry) => [entry.key, entry.value] as [K, V]));
        }

        toRecord(): [K] extends [PrimitiveRecordKey] ? Record<Extract<K, PrimitiveRecordKey>, V> : never {
            if (keyIsClass) throw new Error('[CCRecord] Custom class keys cannot be converted to JS Record. Use get/set/remove/toMap.');
            // null prototype safely handles keys like "__proto__" and "constructor".
            const result = Object.create(null) as Record<string | number, V>;
            for (const entry of this.entries) {
                if (typeof entry.key === 'string' && !entry.key.trim()) continue;
                // Last duplicate key wins, as in Object.fromEntries().
                result[entry.key as string | number] = entry.value;
            }
            return result as any;
        }
    }

    ensureRegistered('CVHRecordEntry_' + id, Entry);
    ensureRegistered('CVHRecord_' + id, Store);
    registry.set(id, { keyType, valueType, keyField, ctor: Store, entryCtor: Entry });
    return Store;
}
