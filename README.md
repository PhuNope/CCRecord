# CCRecord Inspector — Preview 0.2.5

Serializable typed Key/Value Record for the native Cocos Creator Inspector, adapted from the supplied `hierarchy-visual-hook` v0.8.8 reference with Hierarchy-only code removed.

- **Target:** Cocos Creator **3.8.2 and later** (development preview; Editor integration/round trips on real 3.8.2–3.8.8 instances still need manual testing).
- **Runtime:** mounted **read-only** through Cocos Creator's AssetDB extension registration (`contributions['asset-db'].mount`). You can import `CCRecord` from **`db://ccrecord/CCRecord`** in your project code; the plugin does **not** install runtime scripts into your project's `assets` directory.
- **Optional test scripts:** imported into the project **only on user request** using the CCRecord panel. These editable scripts live under `db://assets/CCRecordTests/` and are **not part of the read-only extension AssetDB mount**.
- **Menu:** **Extension → CCRecord** submenu collects the test panel, reload/enable/disable Inspector hook, and diagnostics. No separate top-level CCRecord menu.

## Install and test

1. From Cocos Creator's **Extension → Extension Manager → Import Extension**, select `CCRecord-preview-0.2.5.zip` directly. This archive has `package.json` at ZIP root, with no nested ZIP. Enable or refresh the extension.
2. In the Assets panel, confirm the read-only `ccrecord` package contains `CCRecord.ts`. For your own scripts, use:

   ```ts
   import { CCIndexRecord } from 'db://ccrecord/CCRecord';
   import { _decorator, Component, Node, Enum } from 'cc';
   const {ccclass, property} = _decorator;
   enum Slot { Primary = 0, Secondary = 1 }
   Enum(Slot);
   const SlotNodes = CCIndexRecord<Slot, Node | null>(Slot, Node);
   @ccclass('CCRecordTest')
   export class CCRecordTest extends Component {
     @property(SlotNodes)
     public nodes: Record<Slot, Node | null> = new SlotNodes();
   }
   ```

3. For sample scripts, choose **Extension → CCRecord → Import / Update Test Files...**. The CCRecord panel lets you select individual files or all files. Click **Import / Update selected**. The panel returns installed/updated/unchanged status and the backup location, when applicable. A selected demo's local script dependencies are included automatically.
4. Add a demo component to a Scene node, edit a Record in Inspector (`SIZE`, add/delete entries, Enum key, Node value, nested classes), then save and reopen a **disposable** scene. Check Undo/Redo. Use **Extension → CCRecord → Inspector Diagnostics** if anything fails.

### CCRecordClass API: options-only

For **new** serializable Record declarations, pass only the Cocos key and value types. An optional third argument configures object-key lookup:

```ts
import { CCRecordClass } from 'db://ccrecord/CCRecord';
import { _decorator, CCString, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('MyItemKey')
class ItemKey {
  @property(CCString) id = '';
}

// The third argument is an optional options object. String IDs are not supported.
const ItemNodes = CCRecordClass<ItemKey, Node | null>(
  ItemKey, Node, { keyField: 'id' }
);

// Other options are optional, including keyField.
// Without keyField, object keys use reference identity (as in Map),
// NOT lookup by creating another ItemKey with identical field values.
const ByObjectReference = CCRecordClass<ItemKey, string>(ItemKey, CCString);
```

`CCRecord()` and `CCIndexRecord()` also accept an options object in the third argument. For an object key, `{keyField:'id'}` lets `.get(new ItemKey())` match persisted keys **by ID** provided the new key's `id` equals the saved one. Without it, use the same object instance from `.entries` for lookup. Primitive keys need no `keyField`.

**Breaking change in v0.2.5:** `legacyIds`, `CCRecordLegacyAlias` and the positional string ID overload have been removed from `CCRecordClass`, `CCRecord`, and `CCIndexRecord`. Generated Cocos class IDs are derived only from type names. The only current option is `keyField`; omit it when object keys should use reference identity. Old scenes/prefabs serialized with custom/previous IDs are **not migrated** and may show missing classes. Back up existing scenes and prefabs before upgrading, and do not save a scene that reports missing serialized classes. There is no legacy alias fallback.

**Enum identity:** when different Enums use the same Value type, call `CCRecordEnumId(MyEnum, 'UniqueEnumName')` after `Enum(MyEnum)` and before constructing records. This avoids class-name collisions without passing custom IDs to the record factories. Keep that Enum name and its numeric values stable once saved.

### Safety when upgrading an older preview

Preview 0.1.x copied a separate `assets/CCRecord/CCRecord.ts` runtime into the project. **Do not keep both this older copy and the newly mounted `db://ccrecord/CCRecord` runtime**: they can register the same serialized class names twice. The test importer will refuse to run if it detects the legacy runtime. Back up your project/scenes/prefabs first, update imports to `db://ccrecord/CCRecord`, and remove the old runtime copy after inspecting your project for serialized-class conflicts. Do **not** save scenes after missing-class warnings. No automatic deletion/migration is performed.

### Asset installation safety

- The read-only runtime is provided by Creator's AssetDB mount, not copied or refreshed into `db://assets` on extension load.
- Test script import is manual and scoped to `assets/CCRecordTests`. Changes to an existing test script are first copied into a timestamp-unique folder inside `<project>/.ccrecord-backups/` (outside the AssetDB project assets folder). Unchanged files are skipped. The installer never overwrites `.meta` files.
- Import rejects invalid/duplicate filenames, missing dependencies, missing AssetDB API, and a conflicting older runtime copy.
- After writing, it requests AssetDB refresh (`db://assets`, `db://assets/CCRecordTests`); a failure is returned as `refresh-failed` with warnings, **not** reported as a successful import. The files remain written, and you may retry the Editor Assets refresh.
- Importing a single demo may import other demo files it needs. If you select an existing edited demo, the source version replaces it **after backup**.

## Preview 0.2.5: options-only API, no legacy aliases

- `CCRecordClass`, `CCRecord` and `CCIndexRecord` now accept only `(KeyType, ValueType, options?)`; `keyField` is the only supported option.
- Removed registration of historical class aliases and all demo uses of positional string IDs. No migration path is included.
- Multiple enum examples use `CCRecordEnumId` to avoid generated-class name collisions; duplicate Key/Value pairs share one constructor but keep separate instance data.
- Test harness compiles the actual shipped runtime and demo sources, with TypeScript negative checks for removed API forms. All 12 mock test groups pass locally.

## Preview 0.2.4: uninterrupted typing in nested Value fields

- **Fix for Creator 3.8.8:** editing `CCRecordAutoDemo → itemsExplicit → Value → Description` repeatedly no longer treats lagging Scene reads of the extension's **own accepted writes** as external edits. Each leaf retains a bounded history of confirmed values; only known prior local values are tolerated as stale Scene echoes. Truly foreign edits to the same leaf still fail closed.
- **Shadow DOM focus:** resolve the actual focused input through nested shadow roots, and use composed parent/host traversal. Do not re-render a field still being typed into (including when Scene updates asynchronously), or a field with an in-flight edit.
- **Scene refresh protection:** native Inspector re-renders that briefly echo a previous local edit may not rewind that cell's baseline or overwrite its visible input.
- **Updated parent dump:** when Cocos replaces the native Inspector owner dump during an async IPC write, accept the replacement if the selected Scene node is unchanged, and update the most recent matching row's baseline after the successful write.
- **Ctrl+S:** the existing save barrier still waits for all queued writes before invoking `scene:save-scene`; the new typing regression verifies the final string survives this path.
- **Regression:** an additional mock test exercises six rapid Description changes, lagging query-node, an in-flight native rerender, focus within Shadow DOM, a seventh change, Ctrl+S, and a genuine competing Scene edit. All 12 test groups passed locally. These are not end-to-end Creator Editor tests.

## Preview 0.2.3: Scene dirty and save reliability

- **Nested values:** all Scene writes (`Value`, `Key`, SIZE, delete) run in one undo transaction using Creator's documented `begin-recording` / `end-recording` pair. For unsupported editor contexts, the previous Scene write remains available with a `snapshot` fallback if `query-dirty` is still false.
- **No synthetic native change:** the hook never dispatches a fake `change-dump` from its hidden original `ui-prop`. That event could replay a stale dump over the nested `ItemStats` value after a successful Scene write.
- **Ctrl+S safety:** when an input inside CCRecord is focused (or CCRecord edits are pending), the hook first blurs it, waits for queued Scene requests to finish, flushes any last Value/Key dump changes not emitted by the native control, and then calls `scene:save-scene`. Ctrl+S outside CCRecord, with no pending edits, is handled normally by Cocos.
- **Inspector message cleanup:** removes the orange inline error text. Failures remain available via the extension Diagnostics and Editor console. Duplicate-key highlighting/warnings remain in English.
- Regression tests mock the Scene saving order, dirty state, undo recording and `ItemStats.description` changes in `itemsExplicit`, including both blur-with-event and blur-without-event scenarios. These are **mock tests** and do not prove Editor integration on every supported Creator version.

## Preview 0.2.1 regression fixes

- The importer panel now uses the correct high-contrast Cocos UI text colors: test filenames, button labels and descriptions remain readable in dark editor themes.
- Nested `@ccclass` values (for example `ItemStats.description` in `CCRecordAutoDemo.items`) use a committed snapshot and diff the edited leaf, not the complete potentially mutated Inspector dump. A concurrent change to another nested field is preserved; a concurrent change to the **same** field is rejected rather than overwritten.
- Add/remove/SIZE operations verify `scene:query-dirty`. If the Scene service remains clean, the hook requests an undo snapshot; unlike previous previews, it does not attempt to fake native `change-dump` events.
- Removed the premature post-add query-node verification that could show a false “Scene returned Record…” error because Scene's dump cache may lag a successful set-property.
- Supports older 3.8.x builds where `scene:remove-array-element` returns `void` instead of `true`.

## Preview 0.2.2 regression fixes

- Accept `CCRecordClass<Key, Value>(KeyType, ValueType, {keyField:'id'})` without an explicit serialization ID; `keyField` is optional for class keys. The API no longer accepts positional IDs or legacy aliases (as of v0.2.5).
- After adding entries, read back the exact changed Record from `scene:query-node` and initialize Key/Value editors from Scene-normalized dumps rather than stale `elementTypeData`. Retry transient lagging queries up to three times.
- Queue rapid native Inspector edits; Key and Value changes can be performed back-to-back without racing an in-flight Scene command.
- Rebase row snapshots when the native Inspector renders a refreshed Scene dump. Retain genuine same-field external conflict protection rather than silently overwriting it.
- All duplicate-key warnings/tooltips are in English: `Duplicate keys: ...` and `Duplicate key: ...`.
- New mock regression includes add → Scene hydration → edit custom `ItemStats` value → rapid Key/Value edits → duplicate warning → native refresh → genuine external conflict.

## Implementation boundaries

`assets/CCRecord.ts` is the single authoritative runtime source shipped in the extension. The Editor-side code in `src/main/` controls the `WindowHookHost` lifecycle and `ProjectAssetInstaller`. The test panel `src/panels/default/` is a thin UI adapter; it does not write files. `src/inspector/` splits detection/bootstrap, Scene paths, Scene commands, key identity, presentation and DOM integration into separate modules. A simple dependency-free build concatenates these six ordered modules into a renderer script.

Serialization stores a CCClass wrapper with an `entries` array rather than a plain JavaScript object. `CVHRecord_...` and `CVHRecordEntry_...` IDs are derived from the current types, not previous preview IDs. Keep @ccclass names, `CCRecordEnumId` names and numeric Enum values stable after saving. Scene edits target exactly one selected node; ambiguous Scene property paths fail closed. Multi-selection and asset-only Inspector are not supported in this preview. Inspector injection uses private Editor DOM APIs (no app.asar or Cocos tool modifications), so verify behavior against each Editor version before production use.

## Build and tests

```bash
npm run build
npm test
npm run pack
```

`npm run pack` writes `CCRecord-preview-0.2.5.zip`, containing only `package.json`, the compiled Editor JS, the mounted runtime `assets/CCRecord.ts`, and the optional importable test script sources. There is no nested archive. Source-only tests and test fixtures are not shipped. No Git tag or GitHub Release is created without the user's explicit approval.
