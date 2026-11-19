# CCRecord — Cocos Creator Inspector (Preview 0.2.7)

Typed, serializable Key/Value collections in the native Inspector. Cocos Creator **3.8.2+** is the target; real-editor compatibility still needs manual verification.

## One factory: `CCRecord`

Every field is declared with `@property(CCRecord(KeyType, ValueType, options?))`. **Do not** construct a generated class yourself. The decorator metadata provides a separate serializable store for each component instance. The backing `entries` array is persisted as native CCClass data rather than a plain JavaScript object.

### Primitive keys: TypeScript `Record<K, V>`

```ts
import { _decorator, Component, Node, CCString, CCInteger } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

@ccclass('RecordExample')
export class RecordExample extends Component {
    @property(CCRecord<string, Node | null>(CCString, Node))
    public nodes!: Record<string, Node | null>;

    @property(CCRecord<number, string>(CCInteger, CCString))
    public labels!: Record<number, string>;

    start(): void {
        this.nodes['player'] = this.node;
        this.labels[7] = 'lucky';
        console.log(this.nodes['player'], this.labels[7]);
    }
}
```

Use ordinary `record[key]` syntax, `Object.keys(record)`, `Object.values(record)` and `Object.entries(record)` for primitive-key stores. The runtime object is still an engine-serializable CCClass proxy.

### Object keys: `ICCRecord<K, V>`

JavaScript property indexing coerces object keys to strings, so **do not** use `record[node]` or TypeScript `Record<Node, V>`.

```ts
import { _decorator, Component, Node, CCString, CCInteger } from 'cc';
import { CCRecord, ICCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

@ccclass('ItemKey')
class ItemKey {
    @property(CCString) id = '';
    @property(CCInteger) order = 0;
}

@ccclass('ObjectKeyExample')
export class ObjectKeyExample extends Component {
    @property(CCRecord<ItemKey, Node | null>(ItemKey, Node, { keyField: 'id' }))
    public targets!: ICCRecord<ItemKey, Node | null>;

    @property(CCRecord<Node, Node>(Node, Node))
    public nodePairs!: ICCRecord<Node, Node>;

    findById(id: string): Node | null {
        const key = new ItemKey(); key.id = id;
        return this.targets.get(key) ?? null;
    }

    start(): void {
        for (const { key, value } of this.nodePairs.entries) {
            console.log(key?.name, value?.name);
        }
        console.log(this.nodePairs.get(this.node));
    }
}
```

With a custom object key, `{ keyField: 'id' }` is optional. When provided, `get`, `set`, `has`, and `remove` compare that non-empty primitive field, including across deserialization. Without `keyField`, object keys compare by reference (Map-style). `Node` references likewise use identity; the Inspector compares Node UUIDs when displaying duplicate-key warnings. Reusing the same **Value** on different Keys is allowed.

### Numeric Enum keys

```ts
import { Enum, Node } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';

enum Slot { A = 0, B = 1 }
Enum(Slot);

@property(CCRecord<Slot, Node | null>(Slot, Node, { enumId: 'SlotV1' }))
public attachments!: Record<Slot, Node | null>;
```

`enumId` is an optional **CCRecord option**, not a separate helper or class factory. Set it to a stable unique name when multiple numeric Enums use the same Value type; keep it unchanged after saving a Scene. Without it, one schema per Enum/value-category combination may use the generic `Enum` identity; distinct Enum shapes with the same Value type can collide. A numeric Enum's member-list fingerprint is deliberately **not** used for its serialized class ID.

**Public API:** `CCRecord(...)` (factory), `ICCRecord<K,V>` (object-key type), plus supporting TypeScript types and diagnostics. Removed APIs: `CCRecordClass`, `CCIndexRecord`, `createRecord`, and `CCRecordEnumId`. No `legacyIds` or positional serialization IDs.

## Install and examples

1. In **Extension → Extension Manager**, import `CCRecord-preview-0.2.7.zip` directly. It has `package.json` at the root and no nested ZIP.
2. Enable the extension. `db://ccrecord/CCRecord` is a read-only AssetDB mount supplied by the extension; no runtime scripts are copied into the project.
3. Use **Extension → CCRecord → Import / Update Test Files...** to select optional demo scripts. Importer puts them in `db://assets/CCRecordTests`, includes local dependencies, backs up modified files, and refreshes AssetDB.
4. Add a demo component to a Scene node, edit keys/values in Inspector, save and reopen the Scene/Prefab to validate serialization.

The code examples deliberately declare fields without explicit initializers, relying on the CCClass decorator `default` factory. Use Cocos's legacy decorator/field initialization configuration (`useDefineForClassFields: false`): native class-field definitions which replace the default with `undefined` are not supported. Assigning a plain `{}` as default is **not** a substitute; it cannot serialize the Record's `entries` metadata. Runtime changes performed during a game do not automatically mark an editor Scene dirty.

## Editor integration

- The extension's Inspector hook displays editable Key/Value entries and detects duplicate keys.
- Scene changes and nested object fields are sent through Scene IPC with recording/Undo; the Inspector has a Ctrl+S write barrier to flush active edits.
- Commands live under **Extension → CCRecord**: Import / Update Test Files, Reload Inspector, Inspector Diagnostics, Enable/Disable Inspector Hook.
- Inspector errors are logged in Diagnostics/Console, not shown as an orange warning above the Record.
- The menu and AssetDB runtime are packaged inside the extension. No nested ZIP or unrelated build/source files are included in the installable ZIP.

## Breaking change and tests

**v0.2.7 removes the alternate factory APIs.** Existing Scenes that used the same generated `CVHRecord_*` class IDs remain structurally compatible, but any Cocos class IDs produced from old manual IDs are not automatically migrated. Back up Scenes/Prefabs before upgrading, then update the scripts importing removed helpers. For enum schemas previously named via `CCRecordEnumId(MyEnum,'X')`, supply `{ enumId: 'X' }` to each corresponding `CCRecord` call to keep the exact generated class ID.

Run `npm test` for automated checks and `npm run pack` to make the import-ready ZIP. Tests use a Cocos API mock; **real-editor behavior across 3.8.2–3.8.8 requires manual testing**. Do not create git tags or GitHub Releases until approved.
