// Read the text in an image, using the OS's own Vision framework.
//
// Exists for `check-dmg-background.sh`, which has to know whether a version
// number is baked into the installer artwork. The background is a flat PNG, so
// the only way to check its claims against the build is to read it back.
//
// Prints one recognised string per line and exits 0 even when it finds
// nothing — the caller treats silence as "no text", not as a failure.

import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: read-image-text <image.png>\n".data(using: .utf8)!)
    exit(2)
}

guard let data = FileManager.default.contents(atPath: args[1]) else {
    FileHandle.standardError.write("could not read \(args[1])\n".data(using: .utf8)!)
    exit(1)
}

let request = VNRecognizeTextRequest()
// Accurate rather than fast: the text here is 11px mono on a near-black field,
// which is close to the worst case for the fast path.
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

do {
    try VNImageRequestHandler(data: data, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}

for observation in request.results ?? [] {
    if let candidate = observation.topCandidates(1).first {
        print(candidate.string)
    }
}
