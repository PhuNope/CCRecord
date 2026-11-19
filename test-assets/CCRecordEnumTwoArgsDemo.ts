import { _decorator, Component, Enum, Node, CCString } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

// Add D=3, E=4 later. DO NOT renumber existing members.
export enum TwoArgSlot { A = 0, B = 1, C = 2 }
Enum(TwoArgSlot);



@ccclass('CCRecordEnumTwoArgsDemo')
export class CCRecordEnumTwoArgsDemo extends Component {
    @property(CCRecord<TwoArgSlot, Node | null>(TwoArgSlot, Node, { enumId: 'TwoArgSlot' }))
    public first!: Record<TwoArgSlot, Node | null>;

    @property(CCRecord<TwoArgSlot, Node | null>(TwoArgSlot, Node, { enumId: 'TwoArgSlot' }))
    public second!: Record<TwoArgSlot, Node | null>;

    // All fields share the same generated serialized type, not the same instance.
    @property(CCRecord<TwoArgSlot, Node | null>(TwoArgSlot, Node, { enumId: 'TwoArgSlot' }))
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
