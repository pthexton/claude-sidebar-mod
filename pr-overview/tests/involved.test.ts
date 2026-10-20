import { expect, test } from 'claude-code/testing'

import { isSameLogin } from '../hooks/involved'

test('logins match whatever their case', async () => {
  expect(isSameLogin('Ann', 'ann')).toBe(true)
  expect(isSameLogin('bob', 'ann')).toBe(false)
  expect(isSameLogin(undefined, 'ann')).toBe(false)
})
