import { _decorator, Component, CCString, CCInteger, CCFloat, CCBoolean, Node } from 'cc';
import { CCRecord, CCIndexRecord } from './CCRecord';

const { ccclass, property } = _decorator;

// A normal serializable class. It does not extend Component.
@ccclass('CVHItemStatsV1')
export class ItemStats {
    @property(CCString) public description = '';
    @property(CCInteger) public damage = 10;
    @property(CCFloat) public cooldown = 0.5;
    @property(CCBoolean) public enabled = true;
    @property(Node) public owner: Node | null = null;
}

// Stable id: changing it would break existing serialized instances.
const Record = CCIndexRecord<string, ItemStats>(
    CCString, ItemStats, 'String_ItemStats_v1');

@ccclass('CCRecordValueDemo')
export class CCRecordValueDemo extends Component {
    @property(CCString) public title = 'Weapon configuration';
    @property(CCInteger) public version = 7;

    // Requested v0.8 syntax: no initializer. CCRecord returns full property
    // options with a per-instance default store factory.
    // TypeScript project must use useDefineForClassFields: false.
    @property(CCRecord<string, ItemStats>(CCString, ItemStats, 'String_ItemStats_v1'))
    public items!: Record<string, ItemStats>;

    // Supported alternative: `@property(Record)` with `= new Record()`.
    // Do not assign the SAME serialization id to a different type.
    // @property(Record) public another!: Record<string, ItemStats>;

    @property(CCBoolean) public debugEnabled = true;

    start(): void {
        // ItemStats is a custom @ccclass VALUE, not a Component.
        const sword = this.items['sword'];
        if (sword) console.log('[CCRecordValueDemo]', sword.damage, sword.cooldown, sword.owner);
    }
}
