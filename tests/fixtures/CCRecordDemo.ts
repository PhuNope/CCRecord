import { _decorator, Component, CCString, CCFloat, CCInteger, Node, Enum } from 'cc';
import { CCRecord, CCRecordClass, createRecord } from './CCRecord';
const { ccclass, property } = _decorator;

// Generated serialization identifiers depend on the stable Cocos runtime type names.
const NumberRecord = CCRecordClass<string, number>(CCString, CCFloat);
const IntegerString = CCRecordClass<number, string>(CCInteger, CCString, 'IntegerString_v1');
const NodeRecord = CCRecordClass<string, Node | null>(CCString, Node);

// Cocos supports a numeric enum as a property type after Enum(...) registration.
export enum NodeSlot {
    Camera = 0,
    Target = 1,
    Weapon = 2,
}
Enum(NodeSlot);
// Explicit stable ID is essential to preserve serialization when enum grows.
const EnumNodeRecord = CCRecordClass<NodeSlot, Node | null>(NodeSlot, Node, 'NodeSlot_Node_v1');

@ccclass('CCRecordDemo')
export class CCRecordDemo extends Component {
    // Regression sentinels: these must not change when editing enumNodeRecord.
    @property(CCString) public keepMe = 'KEEP_ME';
    @property(CCInteger) public keepCount = 12345;
    // Direct-index API: a[42] = 'Hello'; console.log(a[42])
    // This is typed as a Record but initialized as a SERIALIZABLE CCClass Proxy,
    // never as a bare `{}` (which would lose Cocos metadata).
    @property(IntegerString)
    public a: Record<number, string> = createRecord(IntegerString);

    // The requested @property(CCRecord(...)) syntax is accepted, but the
    // INSTANCE is a typed serializable wrapper, not a bare JavaScript Record.
    @property(CCRecord(CCString, CCFloat))
    private numberRecord = new NumberRecord();

    @property(CCRecord(CCString, Node))
    private nodeRecord = new NodeRecord();

    @property(CCRecord(NodeSlot, Node, 'NodeSlot_Node_v1'))
    private enumNodeRecord = new EnumNodeRecord();

    get enumNodes(): Record<NodeSlot, Node | null> {
        return this.enumNodeRecord.toRecord();
    }

    getEnumNode(slot: NodeSlot): Node | null {
        return this.enumNodeRecord.get(slot) ?? null;
    }

    setEnumNode(slot: NodeSlot, node: Node | null): void {
        this.enumNodeRecord.set(slot, node);
        // Runtime set() doesn't mark Editor scene data dirty.
    }

    get numbers(): Record<string, number> {
        return this.numberRecord.toRecord(); // snapshot
    }

    get nodes(): Record<string, Node | null> {
        return this.nodeRecord.toRecord(); // snapshot
    }

    getNumber(key: string): number | undefined {
        return this.numberRecord.get(key);
    }

    setNumber(key: string, value: number): void {
        this.numberRecord.set(key, value);
        // Runtime changes do not automatically persist to the Editor scene.
    }

    onLoad(): void {
        // In Preview: modify the Inspector's record entries and inspect output.
        console.log('[CCRecordDemo] a[7]:', this.a[7]);
        console.log('[CCRecordDemo] number entries:', this.numberRecord.entries.length);
        console.log('[CCRecordDemo] Number Record:', this.numbers);
        console.log('[CCRecordDemo] Node Record:', this.nodes);
        console.log('[CCRecordDemo] Enum -> Node Record:', this.enumNodes);
    }
}
