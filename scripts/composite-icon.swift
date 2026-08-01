// Flatten the two Icon Composer layers into a single 1024px PNG that
// `tauri icon` can expand into the platform icon set.
//
// The .icon bundle is the source of truth and stays in the repo; this only
// produces the raster Tauri needs, since Tauri cannot read .icon bundles.

import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count == 4 else {
    FileHandle.standardError.write("usage: composite <field.png> <mark.png> <out.png>\n".data(using: .utf8)!)
    exit(2)
}

func load(_ path: String) -> NSImage {
    guard let image = NSImage(contentsOfFile: path) else {
        FileHandle.standardError.write("could not read \(path)\n".data(using: .utf8)!)
        exit(1)
    }
    return image
}

let field = load(args[1])
let mark = load(args[2])
let side = 1024
let size = NSSize(width: side, height: side)

let output = NSImage(size: size)
output.lockFocus()

// Field first, then the mark composited over it — the layer order in icon.json
// lists the mark first (top) and the field second (bottom).
field.draw(in: NSRect(origin: .zero, size: size),
           from: .zero, operation: .copy, fraction: 1.0)
mark.draw(in: NSRect(origin: .zero, size: size),
          from: .zero, operation: .sourceOver, fraction: 1.0)

output.unlockFocus()

guard let tiff = output.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode png\n".data(using: .utf8)!)
    exit(1)
}

try png.write(to: URL(fileURLWithPath: args[3]))
print("wrote \(args[3])")
