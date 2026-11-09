// Builds an icons.ts module from a folder of .svg files. The canonical copy lives in
// beast-ui/scripts/build-icons.ts; other apps copy it unchanged. See docs/icons.md.
// Needs Bun and svgo (`bun add -d svgo`).
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { optimize, type CustomPlugin, type XastElement } from 'svgo'

// Every icon is redrawn on this grid, so stroke widths and padding compare directly
// and <Icon> can use one viewBox for all of them.
const GRID = 24
// New icons should be lowercase words joined by dashes. Digits, dots and underscores
// are allowed too, so apps keep the names they already use, such as `re-up.ph`.
const iconName = /^[a-z0-9][a-z0-9._-]*$/
const identifier = /^[a-z_$][a-z0-9_$]*$/i
// Files in this subfolder of --svg keep their colors: brand logos, multi-color art.
const COLOR_FOLDER = 'color'
const shapes = new Set(['path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect'])
// Root attributes that describe the file rather than how the art is painted.
const documentAttribute = /^(xmlns(:.*)?|viewBox|width|height|x|y|version|baseProfile|preserveAspectRatio|role|focusable|aria-.*|data-.*)$/
// Any painted color, but not none, an existing currentColor or a url(#gradient) reference.
const paintedColor = /^(?!none$|currentColor$|transparent$|inherit$|url\()/i
// Folders --unused never reads.
const skippedFolders = new Set(['node_modules', 'dist', 'build', 'out', 'coverage'])
const sourceFile = /\.(tsx?|jsx?|mjs|cjs|btsx|tsrx|vue|svelte|astro|mdx?|json)$/

export interface IconFile {
  name: string
  file: string
  keepColors: boolean
}

// Scales the art onto the grid and moves paint attributes off the root <svg>, whose
// attributes are dropped when the body is inlined into <Icon>. The root then gets the
// fill <Icon> renders with, so the other plugins drop fills that only repeat it.
function normalize(name: string): CustomPlugin {
  let normalized = false
  return {
    name: 'normalizeIcon',
    fn: () => ({
      element: {
        enter(node, parent) {
          if (node.name === 'svg' && parent.type === 'root') {
            // multipass runs every plugin again on the already normalized tree.
            if (normalized) return
            normalized = true
            const viewBox = (node.attributes.viewBox ?? '').trim().split(/[\s,]+/).map(Number)
            if (viewBox.length !== 4 || viewBox.some(Number.isNaN) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error(`${name}.svg needs a viewBox`)
            const [x, y, width, height] = viewBox
            const paint: Record<string, string> = {}
            for (const [key, value] of Object.entries(node.attributes)) {
              if (!documentAttribute.test(key)) paint[key] = value
              delete node.attributes[key]
            }
            node.attributes.viewBox = `0 0 ${GRID} ${GRID}`
            node.attributes.fill = 'currentColor'
            // A wide or tall icon is centered in a square, as a browser draws it in a square <svg>.
            const side = Math.max(width, height)
            const scale = GRID / side
            const dx = (side - width) / 2 - x
            const dy = (side - height) / 2 - y
            const transform = [scale !== 1 && `scale(${scale})`, (dx !== 0 || dy !== 0) && `translate(${dx} ${dy})`].filter(Boolean).join(' ')
            // Keep normalization outside the original transform (and any CSS transform).
            if (transform) {
              const children = Object.keys(paint).length
                ? [{ type: 'element' as const, name: 'g', attributes: paint, children: node.children }]
                : node.children
              node.children = [{ type: 'element', name: 'g', attributes: { transform }, children }]
              return
            }
            if (Object.keys(paint).length) {
              const group: XastElement = { type: 'element', name: 'g', attributes: paint, children: node.children }
              node.children = [group]
            }
            return
          }
          const origin = node.attributes['transform-origin']
          if (origin !== undefined) {
            if (!/^0(px)? 0(px)?$/.test(origin.trim())) throw new Error(`${name}.svg uses transform-origin="${origin}". Bake the transform into the path instead.`)
            delete node.attributes['transform-origin']
          }
          // Leftover from design tools: font-size does nothing on a shape.
          if (shapes.has(node.name)) delete node.attributes['font-size']
        },
      },
    }),
  }
}

// SVGO's prefixIds misreads timing values such as begin="0;spin.end+0.2s", so this prefixes
// the ids they reference first. prefixIds leaves an already prefixed reference alone.
function prefixTimings(name: string): CustomPlugin {
  const prefix = `${name}-`
  return {
    name: 'prefixTimings',
    fn: (root) => {
      const ids = new Set<string>()
      const collect = (node: XastElement) => {
        if (node.attributes.id) ids.add(node.attributes.id)
        for (const child of node.children) if (child.type === 'element') collect(child)
      }
      for (const child of root.children) if (child.type === 'element') collect(child)
      const timingIds = [...ids].sort((a, b) => b.length - a.length)
      return {
        element: {
          enter(node) {
            for (const attribute of ['aria-labelledby', 'aria-describedby']) {
              if (node.attributes[attribute]) node.attributes[attribute] = node.attributes[attribute].split(/\s+/).map(id => ids.has(id) && !id.startsWith(prefix) ? prefix + id : id).join(' ')
            }
            for (const attribute of ['begin', 'end']) {
              const value = node.attributes[attribute]
              if (!value) continue
              node.attributes[attribute] = value.split(/\s*;\s*/).map((part) => {
                const id = timingIds.find(id => part.startsWith(id + '.'))
                return id && !id.startsWith(prefix) ? prefix + part : part
              }).join('; ')
            }
          },
        },
      }
    },
  }
}

/** Optimizes one icon and returns the markup that goes inside <Icon>'s <svg>. */
export function buildIcon(name: string, source: string, { keepColors = false } = {}): string {
  if (!iconName.test(name)) throw new Error(`"${name}" is not a valid icon name. Use lowercase letters, digits and dashes.`)
  const colors = keepColors ? [] : [{ name: 'convertColors', params: { currentColor: paintedColor } } as const]
  // An animation can target a transform, a radius or a path, so animated icons only get
  // clean-ups that leave shapes and structure alone. Their grid transform stays on a <g>.
  const animated = /<(animate\w*|set)\b/.test(source)
  const optimizations = animated
    ? (['removeComments', 'removeMetadata', 'removeEditorsNSData', 'cleanupAttrs', 'removeEmptyAttrs', ...colors] as const)
    : ([{ name: 'preset-default', params: { overrides: keepColors ? {} : { convertColors: { currentColor: paintedColor } } } }] as const)
  let data: string
  try {
    ;({ data } = optimize(source, {
      multipass: true,
      plugins: [
        'convertStyleToAttrs',
        normalize(name),
        ...optimizations,
        // Namespace different icons; Icon also scopes IDs to each rendered instance.
        prefixTimings(name),
        { name: 'prefixIds', params: { prefix: name, delim: '-' } },
      ],
    }))
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'SvgoParserError') throw error
    const { reason, line, column } = error as Error & { reason: string; line: number; column: number }
    throw new Error(`${name}.svg is not well-formed SVG: ${reason} at line ${line}, column ${column}. Browsers let this pass, but look for an unclosed tag or an attribute without a value.`)
  }
  const body = data.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/)
  if (!body || !body[1]) throw new Error(`${name}.svg has nothing to draw`)
  return body[1]
}

/** The icons in a folder: its .svg files, and those in its color/ subfolder. */
export async function listIcons(directory: string): Promise<IconFile[]> {
  const read = async (folder: string, keepColors: boolean) =>
    (await readdir(folder)).filter((file) => file.endsWith('.svg')).map((file) => ({ name: file.slice(0, -4), file: path.join(folder, file), keepColors }))
  let icons: IconFile[]
  try {
    icons = await read(directory, false)
  } catch {
    throw new Error(`${directory} does not exist. Pass the folder that holds your .svg files with --svg.`)
  }
  icons.push(...(await read(path.join(directory, COLOR_FOLDER), true).catch(() => [])))
  const seen = new Set<string>()
  for (const icon of icons) {
    if (seen.has(icon.name)) throw new Error(`${icon.name}.svg is in both the svg folder and its ${COLOR_FOLDER}/ subfolder. Keep one.`)
    seen.add(icon.name)
  }
  return icons.sort((a, b) => (a.name < b.name ? -1 : 1))
}

const markupSource = [
  "/** Scope SVG definitions and their references to one framework useId() value. */",
  "export function iconMarkup(name: IconName, instanceId: string): string {",
  "  const body = icons[name]",
  "  const ids = new Map([...body.matchAll(/\\sid=\"([^\"]+)\"/g)].map(([, id]) => [id, `icon-${Array.from(instanceId, c => c.codePointAt(0)!.toString(16)).join('-')}-${id}`]))",
  "  if (!ids.size) return body",
  "  const scoped = (id: string) => ids.get(id) ?? id",
  "  let markup = body.replace(/ (id|href|xlink:href|aria-labelledby|aria-describedby|begin|end)=\"([^\"]*)\"/g, (attribute, key: string, value: string) => {",
  "    if (key === 'id') return ` id=\"${scoped(value)}\"`",
  "    if (key === 'href' || key === 'xlink:href') return ` ${key}=\"${value.startsWith('#') ? '#' + scoped(value.slice(1)) : value}\"`",
  "    if (key.startsWith('aria-')) return ` ${key}=\"${value.split(/\\s+/).map(scoped).join(' ')}\"`",
  "    return ` ${key}=\"${value.split(';').map(part => {",
  "      const leading = part.match(/^\\s*/)?.[0] ?? ''",
  "      const timing = part.trimStart()",
  "      // Longest first: IDs may contain dots, as may animation event names.",
  "      const id = [...ids.keys()].sort((a, b) => b.length - a.length).find(id => timing.startsWith(id + '.'))",
  "      return id ? leading + scoped(id) + timing.slice(id.length) : part",
  "    }).join(';')}\"`",
  "  })",
  "  markup = markup.replace(/url\\(\\s*(['\"]?)#([^\\s)'\"]+)\\1\\s*\\)/g, (_, quote: string, id: string) => `url(${quote}#${scoped(id)}${quote})`)",
  "  // SVGO prefixes stylesheet selectors at build time; scope them at render time too.",
  "  return markup.replace(/<style([^>]*)>([\\s\\S]*?)<\\/style>/g, (_, attributes: string, css: string) =>",
  "    `<style${attributes}>${css.replace(/#((?:\\\\.|[a-zA-Z0-9_-])+)/g, (match, selector: string) => {",
  "      const id = selector.replace(/\\\\(.)/g, '$1')",
  "      return ids.has(id) ? '#' + scoped(id).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&') : match",
  "    })}</style>`)",
  "}",
  '',
].join('\n')

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/** Builds the source of the icons.ts module at `output` from the .svg files in `directory`. */
export async function buildIcons(directory: string, output: string): Promise<string> {
  const lines = []
  for (const icon of await listIcons(directory)) {
    const body = buildIcon(icon.name, await readFile(icon.file, 'utf8'), { keepColors: icon.keepColors })
    lines.push(`  ${identifier.test(icon.name) ? icon.name : quote(icon.name)}: ${quote(body)},`)
  }
  const from = path.relative(path.dirname(output), directory).split(path.sep).join('/')
  return [
    `// Generated by build-icons.ts from ${from}. Do not edit it by hand:`,
    '// add or change an .svg file there, then run `bun run icons:build`.',
    '',
    `export const ICON_VIEWBOX = '0 0 ${GRID} ${GRID}'`,
    '',
    'export const icons = {',
    ...lines,
    '}',
    '',
    'export type IconName = keyof typeof icons',
    '',
    markupSource,
  ].join('\n')
}

/**
 * Names that never appear as a quoted string in the source files under `directory`. A name
 * built at runtime, such as `${kind}-outline`, is not found, so check before deleting.
 */
export async function findUnused(names: string[], directory: string, ignore: string[] = []): Promise<string[]> {
  const quoted = new Set<string>()
  const ignored = new Set(ignore.map((file) => path.resolve(file)))
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (ignored.has(file) || entry.name.startsWith('.')) continue
      if (entry.isDirectory()) {
        if (!skippedFolders.has(entry.name)) await walk(file)
      } else if (sourceFile.test(entry.name)) {
        for (const [, , value] of (await readFile(file, 'utf8')).matchAll(/(['"`])([a-z0-9][a-z0-9._-]*)\1/g)) quoted.add(value)
      }
    }
  }
  await walk(path.resolve(directory))
  return names.filter((name) => !quoted.has(name))
}

const usage = `Builds an icons.ts module from a folder of .svg files. See docs/icons.md in beast-ui.

  bun scripts/build-icons.ts --svg <folder> --out <file> [--check] [--unused <folder>]

  --svg <folder>     the .svg files. Files in its ${COLOR_FOLDER}/ subfolder keep their colors.
  --out <file>       the icons.ts module to write
  --check            fail instead of writing when <file> is out of date
  --unused <folder>  also list icons whose name never appears in quotes under <folder>`

if (import.meta.main) {
  const { values } = parseArgs({
    options: { svg: { type: 'string' }, out: { type: 'string' }, check: { type: 'boolean' }, unused: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  })
  if (values.help || !values.svg || !values.out) {
    console.log(usage)
    process.exit(values.help ? 0 : 1)
  }
  const directory = path.resolve(values.svg)
  const output = path.resolve(values.out)
  const shown = path.relative(process.cwd(), output)
  try {
    const source = await buildIcons(directory, output)
    const names = (await listIcons(directory)).map((icon) => icon.name)
    if (values.check) {
      if ((await readFile(output, 'utf8').catch(() => '')) !== source) {
        console.error(`${shown} is out of date. Run \`bun run icons:build\`.`)
        process.exit(1)
      }
      console.log(`${shown} is up to date`)
    } else {
      await writeFile(output, source)
      console.log(`Built ${names.length} icons → ${shown}`)
    }
    if (values.unused) {
      const unused = await findUnused(names, values.unused, [output, directory])
      console.log(unused.length ? `Not found in ${values.unused} (${unused.length}): ${unused.join(', ')}` : `Every icon is used in ${values.unused}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
