import Foundation

struct GhostOscParsedMessage {
    let address: String
    let args: [[String: Any]]
}

enum GhostOscParser {
    static func parse(_ data: Data) -> [GhostOscParsedMessage] {
        let bytes = [UInt8](data)
        var out: [GhostOscParsedMessage] = []
        parsePacket(bytes, start: 0, end: bytes.count, into: &out, depth: 0)
        return out
    }

    private static func parsePacket(_ bytes: [UInt8], start: Int, end: Int, into out: inout [GhostOscParsedMessage], depth: Int) {
        if depth > 4 || start >= end { return }
        guard let first = readString(bytes, index: start, end: end, base: start) else { return }

        if first.value == "#bundle" {
            var index = first.next + 8
            while index + 4 <= end {
                let size = readInt(bytes, index: index)
                index += 4
                if size <= 0 || index + size > end { return }
                parsePacket(bytes, start: index, end: index + size, into: &out, depth: depth + 1)
                index += size
            }
            return
        }

        if !first.value.hasPrefix("/") { return }
        guard let tags = readString(bytes, index: first.next, end: end, base: start), tags.value.hasPrefix(",") else {
            out.append(GhostOscParsedMessage(address: first.value, args: []))
            return
        }

        var index = tags.next
        var args: [[String: Any]] = []
        tagLoop: for tag in tags.value.dropFirst() {
            switch tag {
            case "i":
                if index + 4 > end { break tagLoop }
                args.append(["type": "i", "value": readInt(bytes, index: index)])
                index += 4
            case "f":
                if index + 4 > end { break tagLoop }
                args.append(["type": "f", "value": readFloat(bytes, index: index)])
                index += 4
            case "s":
                guard let str = readString(bytes, index: index, end: end, base: start) else { break tagLoop }
                args.append(["type": "s", "value": str.value])
                index = str.next
            case "T":
                args.append(["type": "T", "value": true])
            case "F":
                args.append(["type": "F", "value": false])
            default:
                continue
            }
        }

        out.append(GhostOscParsedMessage(address: first.value, args: args))
    }

    private static func readString(_ bytes: [UInt8], index: Int, end: Int, base: Int) -> (value: String, next: Int)? {
        if index >= end { return nil }
        var cursor = index
        while cursor < end && bytes[cursor] != 0 {
            cursor += 1
        }
        if cursor >= end { return nil }
        guard let value = String(bytes: bytes[index..<cursor], encoding: .utf8) else { return nil }
        var next = cursor + 1
        let consumed = next - base
        let padded = base + ((consumed + 3) / 4) * 4
        next = padded
        if next > end { return nil }
        return (value, next)
    }

    private static func readInt(_ bytes: [UInt8], index: Int) -> Int {
        if index + 4 > bytes.count { return 0 }
        let value = UInt32(bytes[index]) << 24
            | UInt32(bytes[index + 1]) << 16
            | UInt32(bytes[index + 2]) << 8
            | UInt32(bytes[index + 3])
        return Int(Int32(bitPattern: value))
    }

    private static func readFloat(_ bytes: [UInt8], index: Int) -> Float {
        if index + 4 > bytes.count { return 0 }
        let value = UInt32(bytes[index]) << 24
            | UInt32(bytes[index + 1]) << 16
            | UInt32(bytes[index + 2]) << 8
            | UInt32(bytes[index + 3])
        return Float(bitPattern: value)
    }
}
