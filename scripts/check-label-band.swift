// Is anything drawn in the band where Finder writes its own icon labels?
//
// The installer background cannot move Finder's label: it is drawn by the
// Finder, over the artwork, under each icon. Anything the artwork puts in that
// band ends up smeared under the filename.
//
// This looks at pixels rather than at recognised text, which the OCR-based
// checks in check-dmg-background.sh cannot do reliably — the wordmark in the
// header reads as "CRGGR.sh" too, so matching on the string flagged artwork
// that was perfectly fine. What actually matters is whether the *band* is
// clear, and that is a question about pixels.
//
// Prints the fraction of non-background pixels found in each label box, and
// exits 1 if either is above the threshold.

import AppKit
import Foundation

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(
        "usage: check-label-band <background.png> [scale]\n".data(using: .utf8)!)
    exit(2)
}

let scale = args.count > 2 ? (Int(args[2]) ?? 1) : 1

guard let img = NSImage(contentsOfFile: args[1]),
      let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff) else {
    FileHandle.standardError.write("could not read \(args[1])\n".data(using: .utf8)!)
    exit(1)
}

// Icon geometry, matching bundle.macOS.dmg in tauri.conf.json. Finder centres a
// 128px icon on these points and writes its label immediately below the box.
let iconCentres = [(x: 160, y: 196), (x: 480, y: 196)]
let iconSize = 128
let labelTop = 196 + iconSize / 2          // 260 — bottom of the icon box
let labelBottom = labelTop + 30            // ~290 at text size 16
let labelHalfWidth = 90                    // wide enough for a long filename

// The field is #060809; anything meaningfully lighter is drawn content.
func isDrawn(_ x: Int, _ y: Int) -> Bool {
    guard let c = rep.colorAt(x: x, y: y) else { return false }
    return c.brightnessComponent > 0.12
}

var failed = false

for (index, centre) in iconCentres.enumerated() {
    var drawn = 0, total = 0
    for y in (labelTop * scale)..<(labelBottom * scale) {
        for x in ((centre.x - labelHalfWidth) * scale)..<((centre.x + labelHalfWidth) * scale) {
            guard x >= 0, y >= 0, x < rep.pixelsWide, y < rep.pixelsHigh else { continue }
            total += 1
            if isDrawn(x, y) { drawn += 1 }
        }
    }

    let fraction = total > 0 ? Double(drawn) / Double(total) : 0
    let zone = index == 0 ? "app" : "applications"
    let pct = String(format: "%.1f%%", fraction * 100)

    // A little content is fine — a notch arm may clip the top of the band. A
    // label or a filled plate is not: both cover a large share of it.
    if fraction > 0.04 {
        FileHandle.standardError.write(
            "  \(zone) label band (y \(labelTop)-\(labelBottom)) is \(pct) covered\n"
                .data(using: .utf8)!)
        failed = true
    } else {
        print("  \(zone) label band clear (\(pct))")
    }
}

exit(failed ? 1 : 0)
