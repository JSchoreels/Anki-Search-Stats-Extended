import type { Revlog } from "./cardData"

// Transfer numeric columns instead of cloning millions of JS objects. IDs need
// Float64 precision; all eight fields are numeric in Anki's review-history API.
export function packRevlogs(reviews: Revlog[]): Float64Array {
    const values = new Float64Array(reviews.length * 8)
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i]
        const offset = i * 8
        values[offset] = review.id
        values[offset + 1] = review.cid
        values[offset + 2] = review.ease
        values[offset + 3] = review.ivl
        values[offset + 4] = review.lastIvl
        values[offset + 5] = review.time
        values[offset + 6] = review.factor
        values[offset + 7] = review.type
    }
    return values
}

export function unpackRevlogs(values: Float64Array): Revlog[] {
    const reviews = new Array<Revlog>(values.length / 8)
    for (let i = 0; i < reviews.length; i++) {
        const offset = i * 8
        reviews[i] = {
            id: values[offset],
            cid: values[offset + 1],
            ease: values[offset + 2] as Revlog["ease"],
            ivl: values[offset + 3],
            lastIvl: values[offset + 4],
            time: values[offset + 5],
            factor: values[offset + 6],
            type: values[offset + 7],
        }
    }
    return reviews
}
