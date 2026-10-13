// Windows has no HOME by default; USERPROFILE is its home folder.
export const homeDir = (home: string | undefined, userProfile: string | undefined) => home || userProfile

// The last part of a path, split on either separator: Windows paths use `\`.
export const baseName = (path: string) => path.split(/[\\/]/).at(-1)
