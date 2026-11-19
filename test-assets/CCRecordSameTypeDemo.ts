import { _decorator, Component, CCString, CCInteger } from 'cc';
import { CCRecord } from 'db://ccrecord/CCRecord';

const { ccclass, property } = _decorator;

// Every property gets an independent Record despite sharing a CCClass schema.

@ccclass('CCRecordSameTypeDemo')
export class CCRecordSameTypeDemo extends Component {
    @property(CCString)
    public keepText = 'DO_NOT_RESET';

    @property(CCInteger)
    public keepNumber = 98765;

    @property(CCRecord<string, number>(CCString, CCInteger))
    public first!: Record<string, number>;

    @property(CCRecord<string, number>(CCString, CCInteger))
    public second!: Record<string, number>;

    @property(CCRecord<string, number>(CCString, CCInteger))
    public third!: Record<string, number>;

    @property(CCRecord<string, number>(CCString, CCInteger))
    public auto!: Record<string, number>;

    onLoad(): void {
        console.log('[SameType] independent stores:',
            this.first !== this.second,
            this.second !== this.third,
            'sentinels:', this.keepText, this.keepNumber);
    }
}
