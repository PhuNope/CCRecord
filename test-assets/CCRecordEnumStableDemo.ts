/** Stable Enum -> Node record across code edits (Creator 3.8.8). */
import { _decorator, Component, Enum, Node } from 'cc';
import { CCRecord, CCRecordEnumId } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

// Always assign numeric values explicitly and NEVER reuse old numbers.
export enum StableSlot {
    Primary = 10,
    Secondary = 20,
    // Safe to add members without changing class ID or old keys:
    Additional = 30,
}
Enum(StableSlot);
// This name, not the enum's member list, determines the generated CCClass ID.
CCRecordEnumId(StableSlot, 'StableSlotV1');

@ccclass('CCRecordEnumStableDemo')
export class CCRecordEnumStableDemo extends Component {
    // No third ID on each property; multiple fields use the same type metadata
    // but must have independent serialized Store instances.
    @property(CCRecord<StableSlot, Node | null>(StableSlot, Node))
    public first!: Record<StableSlot, Node | null>;

    @property(CCRecord<StableSlot, Node | null>(StableSlot, Node))
    public second!: Record<StableSlot, Node | null>;
}
