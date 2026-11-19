/** CCRecord v0.8: examples for a no-initializer property. */
import { _decorator, Component, CCString, CCInteger, Enum, Node } from 'cc';
import { CCRecord, CCRecordClass, CCIndexRecord, ICCRecord } from './CCRecord';
import { ItemStats } from './CCRecordValueDemo';
import { ItemKey } from './CCRecordObjectKeyDemo';
const { ccclass, property } = _decorator;

export enum AttachmentSlot { Primary = 0, Secondary = 1 }
Enum(AttachmentSlot);

// Custom class NOT extending Component.
@ccclass('CVHRecordAutoConfigV1')
export class RecordAutoConfig {
    @property(CCRecord<AttachmentSlot, Node | null>(AttachmentSlot, Node, 'AutoSlot_Node_v1'))
    public attachments!: Record<AttachmentSlot, Node | null>;
}

// Constructor-style alternatives, with persistent and independent class IDs.
const StatsCtor = CCIndexRecord<string, ItemStats>(CCString, ItemStats, 'AutoItem_Stats_v1');
const TagsCtor = CCRecordClass<number, string>(CCInteger, CCString, 'AutoInteger_Tag_v1');

@ccclass('CCRecordAutoDemo')
export class CCRecordAutoDemo extends Component {
    // 1. Direct requested syntax. Initializes automatically if compiled
    // with useDefineForClassFields:false (Cocos legacy-decorator pattern).
    @property(CCRecord<string, ItemStats>(CCString, ItemStats, 'AutoItem_Stats_v1'))
    public items!: Record<string, ItemStats>;

    // 2. Explicit constructor, same storage and serialization as before.
    // This separate example intentionally uses a different ID to avoid sharing
    // a field's sample data.
    @property(StatsCtor)
    public itemsExplicit: Record<string, ItemStats> = new StatsCtor();

    // 3. Non-Record class API: get/set/remove, same as previous releases.
    @property(TagsCtor)
    public labels = new TagsCtor();

    // 4. Custom object key is not a TypeScript Record. Use ICCRecord methods
    // and an explicitly serialized stable field, not object identity.
    @property(CCRecord<ItemKey, Node | null>(ItemKey, Node, 'AutoItemKey_Node_v1', { keyField: 'id' }))
    public itemNodes!: ICCRecord<ItemKey, Node | null>;

    // 5. Plain nested @ccclass (no Component inheritance necessary).
    @property({ type: RecordAutoConfig })
    public config = new RecordAutoConfig();

    onLoad(): void {
        const a = this.items['sword'];
        if (a) console.log('Item damage:', a.damage);
        this.items['bow'] = new ItemStats();
        this.labels.set(7, 'lucky');
        const key = new ItemKey(); key.id = 'main';
        this.itemNodes.set(key, null);
        console.log('Attachment:', this.config.attachments[AttachmentSlot.Primary]);
    }
}
