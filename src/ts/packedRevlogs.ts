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

// Native history uses Anki's exact integer widths; IDs retain Float64 precision.
export function allocateRevlogColumns(length: number) {
    return {
        id: new Float64Array(length),
        cid: new Float64Array(length),
        ease: new Uint8Array(length),
        ivl: new Int32Array(length),
        lastIvl: new Int32Array(length),
        time: new Uint32Array(length),
        factor: new Uint32Array(length),
        type: new Uint8Array(length),
    }
}
export type RevlogColumns = ReturnType<typeof allocateRevlogColumns>
export type RevlogValues = Float64Array | RevlogColumns
type NumberColumns = { [K in keyof RevlogColumns]: RevlogColumns[K] | Float64Array }
export const REVLOG_FIELDS = [
    "id",
    "cid",
    "ease",
    "ivl",
    "lastIvl",
    "time",
    "factor",
    "type",
] as const

function isLegacyValues(values: RevlogValues): values is Float64Array {
    return ArrayBuffer.isView(values)
}

export function copyRevlogValues(values: RevlogValues): RevlogValues {
    if (isLegacyValues(values)) return values.slice()
    return {
        id: values.id.slice(),
        cid: values.cid.slice(),
        ease: values.ease.slice(),
        ivl: values.ivl.slice(),
        lastIvl: values.lastIvl.slice(),
        time: values.time.slice(),
        factor: values.factor.slice(),
        type: values.type.slice(),
    }
}

// Rows are borrowed views: copy their numeric fields before retaining one.
export class RevlogCursor implements Revlog {
    constructor(
        private columns: NumberColumns,
        private stride: number,
        public index = 0
    ) {}
    get id() {
        return this.columns.id[this.index * this.stride]
    }
    get cid() {
        return this.columns.cid[this.index * this.stride]
    }
    get ease() {
        return this.columns.ease[this.index * this.stride] as Revlog["ease"]
    }
    get ivl() {
        return this.columns.ivl[this.index * this.stride]
    }
    get lastIvl() {
        return this.columns.lastIvl[this.index * this.stride]
    }
    get time() {
        return this.columns.time[this.index * this.stride]
    }
    get factor() {
        return this.columns.factor[this.index * this.stride]
    }
    get type() {
        return this.columns.type[this.index * this.stride]
    }
}

export class RevlogHistory implements Iterable<Revlog> {
    private readonly columns: NumberColumns
    private readonly stride: number
    constructor(public readonly values: RevlogValues) {
        this.stride = isLegacyValues(values) ? 8 : 1
        // Legacy Float64 rows remain accepted by local calculation callers.
        // Each view shares the original buffer and getters apply the row stride.
        this.columns = isLegacyValues(values)
            ? {
                  id: values,
                  cid: values.subarray(1),
                  ease: values.subarray(2),
                  ivl: values.subarray(3),
                  lastIvl: values.subarray(4),
                  time: values.subarray(5),
                  factor: values.subarray(6),
                  type: values.subarray(7),
              }
            : values
    }
    get length() {
        return isLegacyValues(this.values) ? this.values.length / 8 : this.values.id.length
    }
    get byteLength() {
        return isLegacyValues(this.values)
            ? this.values.byteLength
            : REVLOG_FIELDS.reduce((sum, field) => sum + this.columns[field].byteLength, 0)
    }
    id(index: number) {
        return this.columns.id[index * this.stride]
    }
    cid(index: number) {
        return this.columns.cid[index * this.stride]
    }
    cursor(index = 0) {
        return new RevlogCursor(this.columns, this.stride, index)
    }
    *[Symbol.iterator]() {
        const row = this.cursor()
        for (row.index = 0; row.index < this.length; row.index++) yield row
    }
}

// Object arrays and legacy Float64 rows remain supported by local callers.
export type RevlogInput = RevlogHistory | Revlog[] | RevlogValues
export function asRevlogHistory(reviews: RevlogInput): RevlogHistory {
    if (reviews instanceof RevlogHistory) return reviews
    return new RevlogHistory(Array.isArray(reviews) ? packRevlogs(reviews) : reviews)
}
