#!/usr/bin/env node
// Copy runtime packages referenced by Next.js trace (.nft.json) files into a
// destination node_modules root. This complements Next's standalone tracing by
// ensuring any leaf packages required at runtime are present.

const fs = require('fs')
const path = require('path')

function usage() {
  console.error(
    'Usage: node trace_copy.js <trace-root-dir> <dest-node_modules-root> [--verbose]'
  )
}

function isScoped(pkgSegment) {
  return pkgSegment && pkgSegment.startsWith('@')
}

function unique(arr) {
  return Array.from(new Set(arr))
}

function findTraceFiles(root) {
  const files = []
  function walk(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (err && err.code === 'ENOENT') return
      throw err
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.nft.json')) files.push(p)
    }
  }
  walk(root)
  return files
}

function collectPackageRootsFromTrace(traceFile) {
  try {
    const json = JSON.parse(fs.readFileSync(traceFile, 'utf8'))
    const files = Array.isArray(json.files) ? json.files : []
    const baseDir = path.dirname(traceFile)
    const roots = []
    for (const rel of files) {
      // Resolve file paths relative to the trace file location when not absolute.
      const f = path.isAbsolute(rel) ? rel : path.resolve(baseDir, rel)
      const idx = f.lastIndexOf(`${path.sep}node_modules${path.sep}`)
      if (idx === -1) continue
      const after = f.slice(idx + (`${path.sep}node_modules${path.sep}`).length)
      const segs = after.split(path.sep).filter(Boolean)
      if (segs.length === 0) continue
      let root
      if (isScoped(segs[0]) && segs.length >= 2) {
        root = path.join(f.slice(0, idx), 'node_modules', segs[0], segs[1])
      } else {
        root = path.join(f.slice(0, idx), 'node_modules', segs[0])
      }
      roots.push(root)
    }
    return unique(roots)
  } catch (e) {
    return []
  }
}

function cpDirSync(src, dest, { dereference = true, verbose = false } = {}) {
  // Node 16+ provides fs.cpSync
  try {
    fs.cpSync(src, dest, { recursive: true, force: true, dereference })
    if (verbose) console.error(`copied ${src} -> ${dest}`)
  } catch (err) {
    // Leave errors for the post-copy validation to catch
    console.error(`warn: failed to copy ${src} -> ${dest}: ${err.message}`)
  }
}

function main() {
  const [traceRoot, destRoot, flag] = process.argv.slice(2)
  const verbose = flag === '--verbose'
  if (!traceRoot || !destRoot) {
    usage()
    process.exit(64)
  }
  const absTraceRoot = path.resolve(traceRoot)
  const absDestRoot = path.resolve(destRoot)

  if (!fs.existsSync(absTraceRoot)) {
    console.error(`Trace root not found: ${absTraceRoot}`)
    process.exit(0)
  }
  if (!fs.existsSync(absDestRoot)) {
    console.error(`Destination node_modules root not found: ${absDestRoot}`)
    process.exit(0)
  }

  const traces = findTraceFiles(absTraceRoot)
  const pkgRoots = unique(
    traces.flatMap((t) => collectPackageRootsFromTrace(t))
  )
  if (verbose) {
    console.error(`found ${traces.length} trace(s), ${pkgRoots.length} package root(s)`)
  }

  for (const srcPkgRoot of pkgRoots) {
    // Compute destination under destRoot keeping scoped layout
    const nmIdx = srcPkgRoot.lastIndexOf(`${path.sep}node_modules${path.sep}`)
    if (nmIdx === -1) continue
    const after = srcPkgRoot.slice(nmIdx + (`${path.sep}node_modules${path.sep}`).length)
    const destPath = path.join(absDestRoot, after)
    const destParent = path.dirname(destPath)
    try { fs.mkdirSync(destParent, { recursive: true }) } catch {}
    cpDirSync(srcPkgRoot, destPath, { dereference: true, verbose })
  }
}

main()
