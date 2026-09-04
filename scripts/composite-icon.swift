// Flatten the Icon Composer layers into a single 1024px PNG that
// `tauri icon` can expand into the platform icon set.
//
// The .icon bundle is the source of truth and stays in the repo; this only
// produces the raster Tauri needs, since Tauri cannot read .icon bundles.
//
// Layers are passed BOTTOM-FIRST and composited in that order, which is the
// reverse of how icon.json lists them — that file is top-first, the way a
// layers panel reads. The CRGGR.sh bundle has three (field, mark, accent)
// where the old one had two, so this takes a variable number rather than a
// fixed pair.

import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write(
        "usage: composite <layer-bottom.png> [<layer.png> …] <out.png>\n".data(using: .utf8)!)
    exit(2)
}

func load(_ path: String) -> NSImage {
    guard let image = NSImage(contentsOfFile: path) else {
        FileHandle.standardError.write("could not read \(path)\n".data(using: .utf8)!)
        exit(1)
    }
    return image
}

let layerPaths = Array(args.dropFirst().dropLast())
let outPath = args[args.count - 1]

let side = 1024
let size = NSSize(width: side, height: side)
let rect = NSRect(origin: .zero, size: size)

// An explicit bitmap rep rather than NSImage.lockFocus(), which adopts the
// main display's backing scale and silently produces a 2048px file on a Retina
// Mac. `tauri icon` would downsample it correctly, so the bug is invisible in
// the output — but the size would depend on which machine ran the script, and
// a 1024 contract that only holds on some hardware is not a contract.
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: side, pixelsHigh: side,
    bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
) else {
    FileHandle.standardError.write("could not allocate bitmap\n".data(using: .utf8)!)
    exit(1)
}
rep.size = size

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

for (index, path) in layerPaths.enumerated() {
    // The first layer is the opaque field, so it is copied rather than blended:
    // it establishes the tile. Everything above it composites over.
    load(path).draw(in: rect, from: .zero,
                    operation: index == 0 ? .copy : .sourceOver, fraction: 1.0)
}

NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode png\n".data(using: .utf8)!)
    exit(1)
}

try png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) from \(layerPaths.count) layers")
