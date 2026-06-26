import Foundation
import Network
import Capacitor

@objc(GhostOscPlugin)
public class GhostOscPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GhostOscPlugin"
    public let jsName = "GhostOsc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "live.ghostarcade.osc")
    private var listener: NWListener?
    private var connections: [NWConnection] = []
    private var listening = false
    private var currentPort = 0
    private var lastError: String?

    @objc func start(_ call: CAPPluginCall) {
        let port = call.getInt("port", 8000)
        guard port >= 1 && port <= 65535 else {
            call.reject("OSC port must be between 1 and 65535.")
            return
        }

        do {
            try startListener(port: port)
            call.resolve(statusObject())
        } catch {
            lastError = error.localizedDescription
            emitStatus()
            call.reject(lastError ?? "Could not start OSC listener.")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopListener(error: nil)
        call.resolve(statusObject())
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(statusObject())
    }

    deinit {
        stopListener(error: nil)
    }

    private func startListener(port: Int) throws {
        stopListener(error: nil)
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            throw GhostOscError.invalidPort
        }

        let params = NWParameters.udp
        params.allowLocalEndpointReuse = true
        let nextListener = try NWListener(using: params, on: nwPort)
        currentPort = port
        lastError = nil
        listening = true

        nextListener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.listening = true
                self.lastError = nil
                self.emitStatus()
            case .failed(let error):
                self.stopListener(error: error.localizedDescription)
            case .cancelled:
                self.listening = false
                self.emitStatus()
            default:
                break
            }
        }

        nextListener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }

        listener = nextListener
        nextListener.start(queue: queue)
        emitStatus()
    }

    private func stopListener(error: String?) {
        listener?.cancel()
        listener = nil
        connections.forEach { $0.cancel() }
        connections.removeAll()
        listening = false
        if let error {
            lastError = error
        }
        emitStatus()
    }

    private func accept(_ connection: NWConnection) {
        connections.append(connection)
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self, let connection else { return }
            if case .cancelled = state {
                self.connections.removeAll { $0 === connection }
            }
        }
        connection.start(queue: queue)
        receive(on: connection)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self, weak connection] data, _, _, error in
            guard let self, let connection else { return }
            if let data, !data.isEmpty {
                let from = String(describing: connection.endpoint)
                let receivedAt = Int(Date().timeIntervalSince1970 * 1000)
                for message in GhostOscParser.parse(data) {
                    self.emitMessage(message, from: from, receivedAt: receivedAt)
                }
            }
            if let error {
                self.lastError = error.localizedDescription
                self.emitStatus()
                connection.cancel()
                return
            }
            if self.listening {
                self.receive(on: connection)
            }
        }
    }

    private func statusObject() -> [String: Any] {
        var obj: [String: Any] = [
            "listening": listening,
            "port": currentPort
        ]
        if let lastError {
            obj["error"] = lastError
        }
        return obj
    }

    private func emitStatus() {
        let payload = statusObject()
        DispatchQueue.main.async {
            self.notifyListeners("status", data: payload)
        }
    }

    private func emitMessage(_ message: GhostOscParsedMessage, from: String, receivedAt: Int) {
        let payload: [String: Any] = [
            "address": message.address,
            "args": message.args,
            "from": from,
            "port": currentPort,
            "receivedAt": receivedAt
        ]
        DispatchQueue.main.async {
            self.notifyListeners("message", data: payload)
        }
    }
}

enum GhostOscError: Error {
    case invalidPort
}
