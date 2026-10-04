import type {
    GraphsResponse_ReviewCountsAndTimes,
    GraphsResponse_ReviewCountsAndTimes_Reviews,
} from "./proto/anki/stats_pb"
import { today } from "./revlogGraphs"

function countOrTimeSum(countOrTime: GraphsResponse_ReviewCountsAndTimes_Reviews) {
    return (
        countOrTime.filtered +
        countOrTime.learn +
        countOrTime.mature +
        countOrTime.relearn +
        countOrTime.young
    )
}

export function calcTimePerReview(data: GraphsResponse_ReviewCountsAndTimes) {
    let days: number[] = []
    for (const i in data.count) {
        const count = countOrTimeSum(data.count[i])
        if (count > 0) {
            days[+i + today] = countOrTimeSum(data.time[i]) / (count * 1000)
        }
    }
    return days
}
