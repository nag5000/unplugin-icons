import createDebugger from 'debug'
import { isPackageExists } from 'local-pkg'
import { installPackage } from '@antfu/install-pkg'
import { sleep } from '@antfu/utils'
import { ResolvedOptions } from '../types'
import { searchForLegacyIcon } from './legacy'
import { loadCollection, ResolvedIconPath, searchForIcon } from './modern'
import { compilers } from './compilers'
import { warnOnce } from './utils'
import { getCustomIcon } from './custom'

export const debug = createDebugger('unplugin-icons:load')

const URL_PREFIXES = ['/~icons/', '~icons/', 'virtual:icons/', 'virtual/icons/']
const iconPathRE = new RegExp(`${URL_PREFIXES.map(v => `^${v}`).join('|')}`)

export function isIconPath(path: string) {
  return iconPathRE.test(path)
}

export function normalizeIconPath(path: string) {
  return path.replace(iconPathRE, URL_PREFIXES[0])
}

export function resolveIconsPath(path: string): ResolvedIconPath | null {
  if (!isIconPath(path))
    return null

  path = path.replace(iconPathRE, '')

  const query: ResolvedIconPath['query'] = {}
  const queryIndex = path.indexOf('?')
  if (queryIndex !== -1) {
    const queryRaw = path.slice(queryIndex + 1)
    path = path.slice(0, queryIndex)
    new URLSearchParams(queryRaw).forEach((value, key) => {
      query[value] = key
    })
  }

  // remove extension
  path = path.replace(/\.\w+$/, '')

  const [collection, icon] = path.split('/')

  return {
    collection,
    icon,
    query,
  }
}

export async function getIcon(collection: string, icon: string, options: ResolvedOptions) {
  const custom = options.customCollections[collection]

  if (custom) {
    const result = await getCustomIcon(custom, collection, icon, options)
    if (result)
      return result
  }

  return await getBuiltinIcon(collection, icon, options)
}

let legacyExists = isPackageExists('@iconify/json')

export async function getBuiltinIcon(collection: string, icon: string, options?: ResolvedOptions, warn = true): Promise<string | null> {
  // possible icon names
  const ids = [
    icon,
    icon.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    icon.replace(/([a-z])(\d+)/g, '$1-$2'),
  ]

  if (options?.iconSource !== 'legacy') {
    let iconSet = await loadCollection(collection)

    if (!iconSet) {
      if (options?.autoInstall && !legacyExists) {
        await installPackage(`@iconify-json/${collection}`, { dev: true })
        await sleep(300)
        iconSet = await loadCollection(collection)
      }
    }

    if (!iconSet) {
      if (options?.iconSource === 'modern') {
        if (warn)
          warnOnce(`failed to load \`@iconify-json/${collection}\`, have you installed it?`)
        return null
      }
    }

    if (iconSet)
      return searchForIcon(iconSet, collection, ids, options)
  }

  if (options?.iconSource === 'legacy') {
    if (!legacyExists && options?.autoInstall) {
      await installPackage('@iconify/json', { dev: true })
      await sleep(300)
      legacyExists = true
    }
    return await searchForLegacyIcon(collection, ids, options)
  }

  if (warn)
    warnOnce(`failed to load \`@iconify-json/${collection}\`, have you installed it?`)

  return null
}

export async function generateComponent({ collection, icon }: ResolvedIconPath, options: ResolvedOptions) {
  let svg = await getIcon(collection, icon, options)
  if (!svg)
    throw new Error(`Icon \`${collection}:${icon}\` not found`)

  const { defaultStyle, defaultClass } = options

  if (defaultClass)
    svg = svg.replace('<svg ', `<svg class="${defaultClass}" `)
  if (defaultStyle)
    svg = svg.replace('<svg ', `<svg style="${defaultStyle}" `)

  const compiler = compilers[options.compiler]
  if (!compiler)
    throw new Error(`Unknown compiler: ${options.compiler}`)

  return compiler(svg, collection, icon, options)
}

export async function generateComponentFromPath(path: string, options: ResolvedOptions) {
  const resolved = resolveIconsPath(path)
  if (!resolved)
    return null
  return generateComponent(resolved, options)
}
