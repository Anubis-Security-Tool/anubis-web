export function dependencyPath (id) {
  return id.replace(/\\/g, '/').match(/(?:^|\/)(node_modules\/(?:@[^/?]+\/)?[^/?]+(?:\/node_modules\/(?:@[^/?]+\/)?[^/?]+)*)(?:\/|$)/)?.[1]
}

export function browserDependencies () {
  return {
    name: 'anubis-browser-dependency-evidence',
    apply: 'build',
    generateBundle () {
      const packages = new Set()
      for (const id of this.getModuleIds()) {
        const path = dependencyPath(id)
        if (path && !this.getModuleInfo(id).isExternal) packages.add(path)
      }
      this.emitFile({
        type: 'asset',
        fileName: 'browser-dependencies.json',
        source: JSON.stringify({ format: 1, packages: [...packages].sort() }, null, 2) + '\n'
      })
    }
  }
}
