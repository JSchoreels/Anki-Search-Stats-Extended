import { asRevlogHistory, type RevlogInput } from "./packedRevlogs"

export function lastForgetByCard(input: RevlogInput): number[] {
    const revlogs = asRevlogHistory(input)
    const result: number[] = []
    for (const revlog of revlogs) {
        if (revlog.factor == 0 && revlog.type == 4) result[revlog.cid] = revlog.id
    }
    return result
}
