import { expect, test } from 'claude-code/testing'

import { isOwnedBy } from '../hooks/owner'

test("the refresh interval row is pr-overview's by its bare name or with any source after an @", async () => {
  expect(isOwnedBy('pr-overview', 'pr-overview')).toBe(true)
  expect(isOwnedBy('pr-overview@inline', 'pr-overview')).toBe(true)
  expect(isOwnedBy('pr-overview@pt-mods', 'pr-overview')).toBe(true)
  expect(isOwnedBy('pr-overview-lite@pt-mods', 'pr-overview')).toBe(false)
  expect(isOwnedBy('sidebar@pt-mods', 'pr-overview')).toBe(false)
})
