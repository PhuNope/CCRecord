/** CCRecord unified API examples: all fields use @property(CCRecord(...)). */
import { _decorator, Component, CCString, CCInteger, Enum, Node } from 'cc';
import { CCRecord, ICCRecord } from 'db://ccrecord/CCRecord';
import { ItemStats } from './CCRecordValueDemo';
import { ItemKey } from './CCRecordObjectKeyDemo';
const { ccclass, property } = _decorator;

export enum AttachmentSlot { Primary = 0, Secondary = 1 }
Enum(AttachmentSlot);

// Custom class NOT extending Component.
@ccclass('CVHRecordAutoConfigV1')
export class RecordAutoConfig {
    @property(CCRecord<AttachmentSlot, Node | null>(AttachmentSlot, Node, { enumId: 'AttachmentSlot' }))
    public attachments!: Record<AttachmentSlot, Node | null>;
}


@ccclass('CCRecordAutoDemo')
export class CCRecordAutoDemo extends Component {
    // 1. Direct requested syntax. Initializes automatically if compiled
    // with useDefineForClassFields:false (Cocos legacy-decorator pattern).
    @property(CCRecord<string, ItemStats>(CCString, ItemStats))
    public items!: Record<string, ItemStats>;

    // 2. Same schema, independent per-component storage, with no constructor to manage.
    @property(CCRecord<string, ItemStats>(CCString, ItemStats))
    public itemsExplicit!: Record<string, ItemStats>;

    // 3. Another primitive schema.
    @property(CCRecord<number, string>(CCInteger, CCString))
    public labels!: Record<number, string>;

    // 4. Custom object key is not a TypeScript Record. Use ICCRecord methods
    // and an explicitly serialized stable field, not object identity.
    @property(CCRecord<ItemKey, Node | null>(ItemKey, Node, { keyField: 'id' }))
    public itemNodes!: ICCRecord<ItemKey, Node | null>;

    // 5. Plain nested @ccclass (no Component inheritance necessary).
    @property({ type: RecordAutoConfig })
    public config = new RecordAutoConfig();

    onLoad(): void {
        const a = this.items['sword'];
        if (a) console.log('Item damage:', a.damage);
        this.items['bow'] = new ItemStats();
        this.labels[7] = 'lucky';
        const key = new ItemKey(); key.id = 'main';
        this.itemNodes.set(key, null);
        console.log('Attachment:', this.config.attachments[AttachmentSlot.Primary]);
    }
}
