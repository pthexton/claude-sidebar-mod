import { expect, test } from 'claude-code/testing'

import { isOwnedBy } from '../hooks/owner'

test("a row is the plugin's by its bare name or with any source after an @", async () => {
  expect(isOwnedBy('sidebar', 'sidebar')).toBe(true)
  expect(isOwnedBy('sidebar@inline', 'sidebar')).toBe(true)
  expect(isOwnedBy('sidebar@pt-mods', 'sidebar')).toBe(true)
})

test("another plugin's row isn't, even one whose name starts the same", async () => {
  expect(isOwnedBy('sidebar-extras', 'sidebar')).toBe(false)
  expect(isOwnedBy('sidebar-extras@pt-mods', 'sidebar')).toBe(false)
  expect(isOwnedBy('engine', 'sidebar')).toBe(false)
})
