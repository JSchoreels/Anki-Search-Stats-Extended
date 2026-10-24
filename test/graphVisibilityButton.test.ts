/** @jest-environment jsdom */

jest.mock("../src/ts/stores", () => {
    const { writable } = require("svelte/store")
    return { hiddenGraphs: { ids: writable([]) }, showHiddenGraphs: writable(false) }
})
jest.mock("../src/ts/i18n", () => ({
    i18n: (key: string, args: { count: number }) => `${key} (${args.count})`,
}))

import { get } from "svelte/store"
import { connectGraphVisibilityButton } from "../src/ts/graphVisibilityButton"
import { hiddenGraphs, showHiddenGraphs } from "../src/ts/stores"

test("native button receives localized counts and reveal state; clicks only toggle the current view", () => {
    window.bridgeCommand = jest.fn()
    hiddenGraphs.ids.set([])
    showHiddenGraphs.set(false)
    const stop = connectGraphVisibilityButton()
    const latest = () => {
        const message = (window.bridgeCommand as jest.Mock).mock.calls.at(-1)![0]
        return JSON.parse(message.slice(message.indexOf(":") + 1))
    }
    expect(latest()).toEqual({ count: 0, shown: false, label: "show-hidden-graphs (0)" })
    hiddenGraphs.ids.set(["fsrs:daily-logLoss"])
    expect(latest()).toEqual({ count: 1, shown: false, label: "show-hidden-graphs (1)" })
    window.toggleSseHiddenGraphs!()
    expect(latest()).toEqual({ count: 1, shown: true, label: "hide-hidden-graphs (1)" })
    expect(get(hiddenGraphs.ids)).toEqual(["fsrs:daily-logLoss"])
    window.toggleSseHiddenGraphs!()
    expect(get(showHiddenGraphs)).toBe(false)
    stop()
    expect(window.toggleSseHiddenGraphs).toBeUndefined()
    const calls = (window.bridgeCommand as jest.Mock).mock.calls.length
    hiddenGraphs.ids.set([])
    expect((window.bridgeCommand as jest.Mock).mock.calls).toHaveLength(calls)
})
