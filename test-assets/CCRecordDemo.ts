import { _decorator, Component, CCString, CCFloat, CCInteger, Node, Enum } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';
const { ccclass, property } = _decorator;

// Cocos supports a numeric enum as a property type after Enum(...) registration.
export enum NodeSlot {
    Camera = 0,
    Target = 1,
    Weapon = 2,
}
Enum(NodeSlot);
@ccclass('CCRecordDemo')
export class CCRecordDemo extends Component {
    // Regression sentinels: these must not change when editing enumNodeRecord.
    @property(CCString) public keepMe = 'KEEP_ME';
    @property(CCInteger) public keepCount = 12345;
    @property(CCRecord<number, string>(CCInteger, CCString))
    public a!: Record<number, string>;

    @property(CCRecord<string, number>(CCString, CCFloat))
    private numberRecord!: Record<string, number>;

    @property(CCRecord<string, Node | null>(CCString, Node))
    private nodeRecord!: Record<string, Node | null>;

    @property(CCRecord<NodeSlot, Node | null>(NodeSlot, Node, { enumId: 'NodeSlot' }))
    private enumNodeRecord!: Record<NodeSlot, Node | null>;

    get enumNodes(): Record<NodeSlot, Node | null> {
        return this.enumNodeRecord;
    }

    getEnumNode(slot: NodeSlot): Node | null {
        return this.enumNodeRecord[slot] ?? null;
    }

    setEnumNode(slot: NodeSlot, node: Node | null): void {
        this.enumNodeRecord[slot] = node;
        // Runtime set() doesn't mark Editor scene data dirty.
    }

    get numbers(): Record<string, number> {
        return this.numberRecord;
    }

    get nodes(): Record<string, Node | null> {
        return this.nodeRecord;
    }

    getNumber(key: string): number | undefined {
        return this.numberRecord[key];
    }

    setNumber(key: string, value: number): void {
        this.numberRecord[key] = value;
        // Runtime changes do not automatically persist to the Editor scene.
    }

    onLoad(): void {
        // In Preview: modify the Inspector's record entries and inspect output.
        console.log('[CCRecordDemo] a[7]:', this.a[7]);
        console.log('[CCRecordDemo] number entries:', Object.keys(this.numberRecord).length);
        console.log('[CCRecordDemo] Number Record:', this.numbers);
        console.log('[CCRecordDemo] Node Record:', this.nodes);
        console.log('[CCRecordDemo] Enum -> Node Record:', this.enumNodes);
    }
}
