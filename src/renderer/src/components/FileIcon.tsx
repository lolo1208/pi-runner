import { Archive, Box, Braces, Database, File, FileCode2, FileImage, FileJson, FileKey, FileSpreadsheet, FileText, FileType, FlaskConical, GitBranch, Globe, Image, Layers, LockKeyhole, Map as MapIcon, Music, Package, Presentation, Settings, SquareTerminal, Video, type LucideIcon } from 'lucide-react'

/** 相同类型在文件树和改动列表中使用同一图标；文件名匹配优先于扩展名。 */
const fileNames: Record<string, LucideIcon> = {
  '.gitignore': GitBranch, '.gitattributes': GitBranch, '.gitmodules': GitBranch, '.gitconfig': GitBranch,
  'dockerfile': Box, 'containerfile': Box, 'makefile': SquareTerminal, 'justfile': SquareTerminal,
  'license': FileText, 'licence': FileText, 'readme': FileText, 'changelog': FileText,
  '.env': Settings, '.editorconfig': Settings, '.npmrc': Settings, '.nvmrc': Settings, '.prettierrc': Settings, '.eslintrc': Settings,
  'package-lock.json': LockKeyhole, 'npm-shrinkwrap.json': LockKeyhole, 'pnpm-lock.yaml': LockKeyhole, 'yarn.lock': LockKeyhole, 'bun.lock': LockKeyhole, 'bun.lockb': LockKeyhole,
  'cargo.lock': LockKeyhole, 'gemfile.lock': LockKeyhole, 'composer.lock': LockKeyhole, 'poetry.lock': LockKeyhole, 'pdm.lock': LockKeyhole, 'uv.lock': LockKeyhole, 'pipfile.lock': LockKeyhole, 'go.sum': LockKeyhole,
  'package.json': Package, 'pyproject.toml': Package, 'cargo.toml': Package, 'composer.json': Package, 'gemfile': Package, 'go.mod': Package, 'requirements.txt': Package, 'pipfile': Package, 'cmakelists.txt': Settings,
  '.dockerignore': Box, '.containerignore': Box, '.eslintignore': Settings, '.prettierignore': Settings, '.browserslistrc': Settings, '.babelrc': Settings, '.stylelintrc': Settings, '.yarnrc': Settings, '.yarnrc.yml': Settings,
  'vagrantfile': Box, 'procfile': SquareTerminal, 'rakefile': SquareTerminal, 'gradlew': SquareTerminal, 'mvnw': SquareTerminal, 'jenkinsfile': SquareTerminal,
  'authors': FileText, 'contributors': FileText, 'copying': FileText, 'notice': FileText, 'security.md': FileText, 'codeowners': FileText,
}
const groups: [LucideIcon, string[]][] = [
  [Image, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'heic', 'heif', 'tif', 'tiff', 'apng', 'jfif']],
  [FileImage, ['psd', 'psb', 'ai', 'sketch', 'fig', 'xcf', 'indd', 'eps', 'ase', 'aseprite', 'kra', 'ora', 'clip', 'procreate', 'afdesign', 'afphoto', 'afpub']],
  [Layers, ['blend', 'fbx', 'obj', 'gltf', 'glb', 'stl', 'dae', '3ds', 'usd', 'usdz', 'mtl', 'prefab', 'scene', 'unity', 'unitypackage', 'uasset', 'umap', 'anim', 'atlas']],
  [MapIcon, ['geojson', 'kml', 'kmz', 'gpx', 'shp', 'mbtiles']],
  [Music, ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'aiff', 'opus', 'mid', 'midi', 'wma']],
  [Video, ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpeg', 'mpg', 'wmv', 'flv']],
  [Archive, ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'br', 'jar', 'war', 'ear', 'iso', 'cab', 'dmg', 'img', 'lz', 'lz4', 'lzma', 'txz', 'tbz2', 'ar', 'cpio']],
  [Package, ['deb', 'rpm', 'apk', 'aab', 'ipa', 'msi', 'msix', 'appx', 'nupkg', 'whl', 'gem', 'vsix', 'crx', 'xpi']],
  [FileSpreadsheet, ['csv', 'tsv', 'xls', 'xlsx', 'xlsm', 'ods', 'parquet']],
  [Presentation, ['ppt', 'pptx', 'odp', 'key']],
  [Database, ['db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'db3', 'dump']],
  [FileKey, ['pem', 'key', 'crt', 'cer', 'p12', 'pfx', 'pub', 'asc', 'gpg']],
  [FileType, ['ttf', 'otf', 'woff', 'woff2', 'eot']],
  [FileJson, ['json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'xml', 'plist', 'jsonld', 'geojsonl', 'ipynb', 'har', 'webmanifest', 'sarif', 'tfstate', 'meta']],
  [Settings, ['ini', 'cfg', 'conf', 'config', 'properties', 'env']],
  [Braces, ['css', 'scss', 'sass', 'less', 'styl', 'graphql', 'gql']],
  [FileCode2, ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro', 'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'fs', 'fsx', 'php', 'lua', 'sql', 'dart', 'scala', 'sc', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'hs', 'r', 'jl', 'zig', 'asm', 's', 'proto', 'sol', 'html', 'htm', 'xhtml', 'wasm', 'm', 'mm', 'hh', 'hxx', 'ixx', 'ino', 'cu', 'cuh', 'gd', 'gdshader', 'shader', 'hlsl', 'glsl', 'vert', 'frag', 'wgsl', 'coffee', 'elm', 'nim', 'v', 'sv', 'vhd', 'vhdl', 'pl', 'pm', 'tcl', 'groovy', 'gradle', 'purs', 'ml', 'mli', 're', 'rei', 'vb', 'vbs', 'pas', 'pp', 'cob', 'f', 'f90', 'f95', 'tf', 'hcl', 'nix', 'vuex', 'ejs', 'hbs', 'handlebars', 'liquid', 'twig', 'pug']],
  [FlaskConical, ['feature', 'snap']],
  [Globe, ['url', 'webloc', 'sitemap', 'ics', 'vcf']],
  [SquareTerminal, ['sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'exe', 'dll', 'so', 'dylib', 'bin', 'appimage']],
  [FileText, ['md', 'mdx', 'txt', 'log', 'rst', 'adoc', 'rtf', 'pdf', 'doc', 'docx', 'odt', 'tex', 'bib', 'org', 'text', 'markdown', 'asciidoc', 'pages', 'epub', 'mobi', 'srt', 'vtt', 'patch', 'diff']],
]
const extensionIcons = new Map(groups.flatMap(([icon, extensions]) => extensions.map(extension => [extension, icon] as const)))

export function fileIcon(path: string): React.JSX.Element {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1) : ''
  const Icon = fileNames[name]
    ?? (/^(dockerfile|containerfile)\./.test(name) ? Box : undefined)
    ?? (/^\.(env|eslintrc|prettierrc|stylelintrc|babelrc)(\.|$)/.test(name) ? Settings : undefined)
    ?? (/\.(test|spec)\.[^.]+$/.test(name) ? FlaskConical : undefined)
    ?? extensionIcons.get(extension) ?? File
  return <Icon size={15} aria-hidden="true" />
}
