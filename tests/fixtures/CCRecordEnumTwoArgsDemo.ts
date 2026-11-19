import { _decorator, Component, Enum, Node, CCString } from 'cc';
import { CCIndexRecord, CCRecord } from './CCRecord';
const { ccclass, property } = _decorator;

// Add D=3, E=4 later. DO NOT renumber existing members.
export enum TwoArgSlot { A = 0, B = 1, C = 2 }
Enum(TwoArgSlot);

// Exactly two arguments. ID never depends on members A/B/C/... .
const SlotNodes = CCIndexRecord<TwoArgSlot, Node | null>(TwoArgSlot, Node);

@ccclass('CCRecordEnumTwoArgsDemo')
export class CCRecordEnumTwoArgsDemo extends Component {
    @property(SlotNodes)
    public first: Record<TwoArgSlot, Node | null> = new SlotNodes();

    @property(SlotNodes)
    public second: Record<TwoArgSlot, Node | null> = new SlotNodes();

    // Direct @property(CCRecord(KEY, VALUE)) also uses the same stable class.
    @property(CCRecord(TwoArgSlot, Node))
    public third!: Record<TwoArgSlot, Node | null>;

    @property(CCString)
    public shouldStay = 'KEEP_THIS';

    /** Example: enumerate logical Enum -> Node pairs (rather than internal entries). */
    public printRecord(): void {
        for (const key of Object.keys(this.first)) {
            const slot = Number(key) as TwoArgSlot;
            console.log('Key:', slot, 'Node:', this.first[slot]);
        }
        console.log('All pairs:', Object.entries(this.first));
    }
}
