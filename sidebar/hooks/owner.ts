// Whether a /config row's owner (`provider.plugin`) is this plugin. The owner
// carries where the plugin came from: `sidebar@pt-mods` installed from a
// marketplace, `sidebar@inline` under `claude --plugin-dir`; tests use the
// bare name.
export const isOwnedBy = (owner: string, plugin: string) => owner === plugin || owner.startsWith(`${plugin}@`)
