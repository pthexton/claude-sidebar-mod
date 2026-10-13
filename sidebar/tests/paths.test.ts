import { expect, test } from 'claude-code/testing'
import { baseName, homeDir } from '../hooks/paths'

test('the home folder is HOME, or USERPROFILE where there is none, as on Windows', () => {
  expect(homeDir('/Users/tester', undefined)).toBe('/Users/tester')
  expect(homeDir('/Users/tester', 'C:\\Users\\tester')).toBe('/Users/tester')
  expect(homeDir(undefined, 'C:\\Users\\tester')).toBe('C:\\Users\\tester')
  expect(homeDir('', 'C:\\Users\\tester')).toBe('C:\\Users\\tester')
  expect(homeDir(undefined, undefined)).toBeUndefined()
})

test('a repo name comes from a Windows root as well as a POSIX one', () => {
  expect(baseName('/Users/tester/src/my-repo')).toBe('my-repo')
  expect(baseName('C:\\Dev\\my-repo')).toBe('my-repo')
  expect(baseName('C:/Dev/my-repo')).toBe('my-repo')
})
