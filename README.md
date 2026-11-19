# CCRecord Inspector — Preview 0.1.0

An experimental, importable Cocos Creator **Editor extension** that displays serialized typed Record entries as Key / Value pairs in the native Inspector. Initial implementation adapted from the supplied `hierarchy-visual-hook` 0.8.8 example (CCRecord implementation and Inspector test harness); unrelated Hierarchy overrides have been removed.

**Editor target:** Cocos Creator **3.8.2+**. The provided editor reference is 3.8.8. The mock regression suite passes on Node 22, but **real Editor/Prefab integration and versions other than 3.8.8 have not yet been verified**. Private `ui-prop` and Inspector DOM behavior could change in later versions. This is a development preview, not a stable release.

## Quick start (test project, backed up scene)

1. In Cocos Creator select **Extension → Extension Manager → Project → Import Extension** and choose `CCRecord-preview-0.1.0.zip`. ZIP root contains `package.json` directly; there is no nested ZIP or prerequisite extraction.
2. Enable the extension. Via the **Extension** menu, select **CCRecord: Install/Update Runtime (backup existing)**. This places only `assets/CCRecord/CCRecord.ts` in the current project and backs up existing differing files under `.ccrecord-backups/`. The plugin does not silently modify project scripts on load.
3. Create a demo component and import `CCRecord` from `assets/CCRecord/CCRecord` using an appropriate relative import:

   ```ts
   import { _decorator, Component, Node, Enum } from 'cc';
   import { CCIndexRecord } from './CCRecord'; // adjust relative path
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

4. Add the component to a Scene node and edit `nodes` in Inspector (SIZE, `+`, delete, Enum key, Node value). Save, reopen, and test Undo/Redo in a **disposable** scene. Record data persists as a `@ccclass` wrapper with an `entries` array, **not** as a plain JavaScript object.

Alternative `@property(CCRecord(KeyType, ValueType, 'StableSchemaName'))` syntax is available with a property-options default factory, but carries Creator field-initializer compatibility caveats. Prefer the explicit `CCIndexRecord` initializer above for baseline tests.

## Implementation boundaries

- Supports string/integer/Enum/custom `@ccclass` keys (custom key classes require `keyField`); values include primitives, `@ccclass` objects, `Node` and engine types via Cocos' serializer.
- Inspector edits target exactly **one selected Scene/Prefab node**. Nested serializable classes are discovered by walking Scene dumps. Ambiguous component/property paths **fail closed** to prevent editing the wrong record.
- Key/Value edits use `scene:set-property` at the leaf path. Delete uses `scene:remove-array-element`. Append/size growth uses a scoped `scene:set-property` and re-queries the Scene for value preservation. The hook reports errors instead of silently writing potentially corrupted data.
- Runtime `CCRecord.ts` creates `CVHRecord_...` and `CVHRecordEntry_...` serialized type names for compatibility with the supplied reference. **Keep schema IDs and existing Enum numeric values stable.** Always back up `.scene`/`.prefab`; never save after an Editor *missing class* warning.
- The Inspector uses a reversible private runtime hook, not a patch of Editor files. It does not modify `tools.zip`, `app.asar`, or the user's Editor installation.
- Multi-selection, asset-only Inspector, and uncertain Scene commit paths are intentionally unsupported. Confirm actual behavior on each Editor version before production use.

## Architecture

`runtime/` contains engine-side typed Record serialization, independent of Editor code. `src/main/` provides transport (`WindowHookHost`) and explicit project asset installation (`RuntimeInstaller`) behind injected adapters. `src/inspector/` is divided by responsibility: detection/bootstrap, Scene path resolution, Scene command orchestration, key identity, presentation, and Editor DOM integration. A dependency-free build concatenates the ordered Inspector fragments into a single renderer-compatible closure; this avoids unsupported ESM imports in the Editor renderer. All reversible patching and external I/O live in the Editor adapter boundary.

## Development

```sh
npm run build
npm test
npm run pack
```

`npm run pack` writes **one** `CCRecord-preview-0.1.0.zip` with just the extension's manifest, built JS, and runtime `CCRecord.ts` at the ZIP root. Tests, fixtures, and documentation stay in the source repository, not in the ZIP. No tag or GitHub Release is created for previews.

## Testing and diagnosis

Tests cover TypeScript runtime mock serialization, `Object.keys`/`Object.entries`, Inspector detection, Enum/Node leaf edits, nested paths, SIZE/delete, dirty fallback, and ambiguity rejection. The extension menu has a **CCRecord: Inspector Diagnostics** command; the main Editor renderer also exposes `window.__CCRECORD_INSPECTOR_HOOK__?.stats()` in DevTools.

For Editor issues, share Creator version, reproduction steps and the diagnostics output. Treat this preview as unverified until a live Editor round-trip is confirmed.
