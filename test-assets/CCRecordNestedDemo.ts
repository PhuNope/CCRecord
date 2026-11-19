/**
 * Demo: CCRecord inside a custom @ccclass that does NOT extend Component.
 * CharacterBoneConfig is serialized because a component's @property references it.
 */
import { _decorator, Component, Enum, Node } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

export enum BoneSlot {
    Head = 0,
    LeftHand = 1,
    RightHand = 2,
}
Enum(BoneSlot);



// Plain serializable CCClass; not a Component!
@ccclass('CharacterBoneConfig')
export class CharacterBoneConfig {
    @property(CCRecord<BoneSlot, Node | null>(BoneSlot, Node, { enumId: 'BoneSlot' }))
    public bones!: Record<BoneSlot, Node | null>;

    public getBone(slot: BoneSlot): Node | null {
        return this.bones[slot] ?? null;
    }

    public setBone(slot: BoneSlot, value: Node | null): void {
        this.bones[slot] = value;
    }
}

// Only the owner extends Component to make the config editable on a scene node.
@ccclass('CCRecordNestedHost')
export class CCRecordNestedHost extends Component {
    @property({ type: CharacterBoneConfig })
    public config = new CharacterBoneConfig();

    onLoad(): void {
        console.log('[CCRecordNestedHost] head:', this.config.getBone(BoneSlot.Head));
    }
}
