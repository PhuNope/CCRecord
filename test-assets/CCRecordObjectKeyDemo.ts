/** CCRecord custom class key PoC: id-based lookup survives scene deserialization. */
import { _decorator, Component, Node, CCString, CCInteger } from 'cc';
import { CCRecord, ICCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

/** Plain serializable key class; does not extend Component. */
@ccclass('CVHItemKeyV1')
export class ItemKey {
    @property(CCString) id = '';
    @property(CCInteger) order = 0;
}

@ccclass('CCRecordObjectKeyDemo')
export class CCRecordObjectKeyDemo extends Component {
    @property(CCRecord<ItemKey, Node | null>(ItemKey, Node, { keyField: 'id' }))
    public targets!: ICCRecord<ItemKey, Node | null>;

    // Node is a reference key: identical Node references are equal.
    // TypeScript's built-in Record<Node, string> is invalid; use ICCRecord.
    @property(CCRecord<Node, string>(Node, CCString))
    public nodeStringRecord!: ICCRecord<Node, string>;

    public findById(id: string): Node | null {
        // This separate instance still matches the serialized key by id.
        const key = new ItemKey();
        key.id = id;
        return this.targets.get(key) ?? null;
    }

    start() {
        console.log('[CCRecord Object Key] targets:', this.targets.entries.length);
        console.log('[CCRecord Object Key] lookup "hand":', this.findById('hand'));
    }
}
