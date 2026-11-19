/**
 * CCRecord v0.2.2 — experimental typed key/value CCClass factory for Creator 3.8.
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
    /** Full legacy ID suffix(es), without CVHRecord_ or CVHRecordEntry_. */
    legacyIds?: string[];
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

/**
 * New API: (keyType, valueType, options?). Previous builds accepted a
 * positional serialization ID; continue supporting it to keep saved scenes
 * readable. Do not silently use an object as an ID.
 */
function resolveArguments<K extends RecordKey>(
    keyType: RecordTypeToken, valueType: RecordTypeToken,
    idOrOptions?: string | CCRecordOptions<K>, legacyOptions?: CCRecordOptions<K>,
): { id: string; options?: CCRecordOptions<K> } {
    if (idOrOptions !== undefined && typeof idOrOptions !== 'string' &&
        (!idOrOptions || typeof idOrOptions !== 'object' || Array.isArray(idOrOptions))) {
        throw new Error('[CCRecord] The third argument must be an options object (or a legacy serialization ID).');
    }
    if (typeof idOrOptions !== 'string' && idOrOptions !== undefined && legacyOptions !== undefined) {
        throw new Error('[CCRecord] Options must be passed only once.');
    }
    return {
        id: typeof idOrOptions === 'string' ? idOrOptions :
            stableTypeName(keyType) + '_' + stableTypeName(valueType),
        options: typeof idOrOptions === 'string' ? legacyOptions : idOrOptions ?? legacyOptions,
    };
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
            'Use a unique explicit third ID and restart the Editor; do not save the affected scene.');
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

/**
 * Optional migration alias: keep old scene/prefab IDs readable after moving to
 * an explicit stable ID. Must run at script module load BEFORE deserialization.
 * Never use this if the legacy ID was shared by different enum/key schemas.
 *
 * Example:
 *   const Stable = CCRecordClass(MyEnum, Node, 'TestRecord_MyEnumNode_v1');
 *   CCRecordLegacyAlias(Stable, 'Enum_A_B_142efc07_cc_Node');
 */
export function CCRecordLegacyAlias<K extends RecordKey, V>(
    storeConstructor: CCRecordConstructor<K, V>, oldId: string,
): void {
    if (!isValidId(oldId)) throw new Error('[CCRecord] Invalid legacy ID: ' + oldId);
    const record = [...registry.values()].find((r) => r.ctor === storeConstructor);
    if (!record) throw new Error('[CCRecord] Store not registered with this factory.');
    const aliases: Array<[string, Function]> = [
        ['CVHRecordEntry_' + oldId, record.entryCtor],
        ['CVHRecord_' + oldId, record.ctor],
    ];
    for (const [name, ctor] of aliases) {
        const byId = js.getClassById(name);
        const byName = js.getClassByName(name);
        if ((byId && byId !== ctor) || (byName && byName !== ctor)) {
            throw new Error('[CCRecord] Legacy class name belongs to another type: ' + name);
        }
        if (byId !== ctor || byName !== ctor) js.setClassAlias(ctor as any, name);
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
// This changes how new class IDs are generated. For old saved scenes, either
// keep the old ID as CCRecord's third argument or supply legacyIds.
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
    // For custom classes, a user-supplied id is safer across refactors/builds.
    const engineName = typeof type === 'function' ? js.getClassName(type) : '';
    const name = String(engineName || type?.name || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!name || name === '_') {
        throw new Error('[CCRecord] Pass an explicit stable third id for this value type.');
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
 * Returns the *same* serializable CVHRecord class as CCRecord(), but its
 * constructor is typed as a TS Record<K, V> for convenient index access.
 *
 * The result is still a CCClass-backed Proxy, NOT a plain JS object. It must
 * be instantiated (`new Record()`) to provide a concrete serialized value.
 * Use only for primitive keys; object keys require the CCRecord get/set API.
 *
 * Example:
 *   const Record = CCIndexRecord<string, ItemStats>(CCString, ItemStats, 'String_ItemStats_v1');
 *   @property(Record)
 *   public items: Record<string, ItemStats> = new Record();
 */
/**
 * Index-access Record constructor. In TWO-ARGUMENT mode the generated name
 * is based on Enum category + Value type, never on the Enum's member list.
 *
 * @example
 *   const Store = CCIndexRecord<Slot, Node | null>(Slot, Node);
 *   // @property(Store) nodes = new Store();
 *
 * Do not mix DIFFERENT enum definitions with the SAME value type in this
 * mode. A TypeScript Enum object has no persisted, stable identity. Explicit
 * IDs are still available for this advanced case.
 */
export function CCIndexRecord<K extends PrimitiveRecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    idOrOptions?: string | CCRecordOptions<K>,
    legacyOptions?: CCRecordOptions<K>,
): new () => Record<K, V> {
    return CCRecordClass<K, V>(keyType, valueType, idOrOptions, legacyOptions) as unknown as new () => Record<K, V>;
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
 * The id is persistent scene/prefab metadata. Keep stable after shipping.
 */
export interface CCRecordPropertyOptions<K extends RecordKey, V> {
    type: CCRecordConstructor<K, V>;
    default: () => ICCRecord<K, V>;
}

export function CCRecord<K extends RecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    idOrOptions?: string | CCRecordOptions<K>,
    legacyOptions?: CCRecordOptions<K>,
): CCRecordPropertyOptions<K, V> {
    const RecordClass = CCRecordClass<K, V>(keyType, valueType, idOrOptions, legacyOptions);
    // `constructor === Object` lets Cocos property() treat this as full options.
    // Every owner gets a distinct Store instance; no shared entries array.
    return { type: RecordClass, default: () => new RecordClass() };
}

/**
 * Construct the actual serializable CCClass constructor (legacy API).
 * Use with `new Store()` or with `@property(Store)`.
 * The generated class ids match older versions, so existing scene types
 * continue to resolve under the same `CVHRecord_*` names.
 */
/**
 * Construct a serializable Cocos class for Record<K,V>.
 *
 * The third argument is normally an OPTIONS object (e.g. {keyField:'id'}).
 * The old positional string ID is still accepted for backward compatibility.
 * Automatically generated class IDs are persisted in scenes/prefabs: keep
 * the @ccclass name stable. If migrating IDs, register legacyIds aliases.
 * The same id returns the same class constructor.
 *
 * For numeric enums, call Enum(YourEnum) first so Cocos Inspector knows
 * how to draw the dropdown. Two-arg mode is stable when members are edited.
 * Use an explicit id only if you need different Enum schemas with the SAME
 * Value type within one project (otherwise their auto IDs would collide).
 * The Record key is the numeric enum VALUE, not the member name.
 *
 * Example:
 *   const NumberRecord = CCRecordClass<string, number>(CCString, CCFloat);
 *   const ObjectKeyRecord = CCRecordClass<ItemKey, Node | null>(ItemKey, Node, {keyField:'id'});
 *   @property(NumberRecord)
 *   private numbers = new NumberRecord();
 */
export function CCRecordClass<K extends RecordKey, V>(
    keyType: RecordTypeToken,
    valueType: RecordTypeToken,
    idOrOptions?: string | CCRecordOptions<K>,
    legacyOptions?: CCRecordOptions<K>,
): CCRecordConstructor<K, V> {
    const {id, options} = resolveArguments(keyType, valueType, idOrOptions, legacyOptions);
    if (!isValidId(id)) {
        throw new Error('[CCRecord] id must be a stable ASCII identifier: ' + id);
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
                    'Use separate explicit IDs if they are DIFFERENT enums; do not save while this is unresolved.');
            }
            // Hot-reloading a script may recreate the Enum object while
            // preserving the imported CCRecord module cache. Keep the old
            // object used by the Entry metadata, but refresh its options.
            updateEnumInPlace(prev.keyType, keyType);
        }
        ensureRegistered('CVHRecordEntry_' + id, prev.entryCtor);
        ensureRegistered('CVHRecord_' + id, prev.ctor);
        for (const legacy of options?.legacyIds || []) CCRecordLegacyAlias(prev.ctor, legacy);
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
    // Register historical names immediately at script evaluation time, before
    // the Scene VM attempts to deserialize a prefab/scene. This does NOT
    // remap numeric enum keys; preserve their numeric IDs across code edits.
    for (const legacy of options?.legacyIds || []) CCRecordLegacyAlias(Store, legacy);
    return Store;
}
