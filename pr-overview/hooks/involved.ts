// GitHub logins aren't case-sensitive.
export const isSameLogin = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase()
