// swift-tools-version: 5.9

// CRGT Host: CRGT Sample Workstation as an iPad app, with the iPad's MIDI (IDAM MIDI Host from a Mac by cable,
// USB and Bluetooth devices, Wi-Fi MIDI, other iPad apps). Opens in Swift Playground on the iPad, and in Xcode on a Mac.
// Setup: https://tazzinaz.github.io/crgt/host/

import PackageDescription

let package = Package(
    name: "CRGTHost",
    platforms: [
        .iOS("16.0")
    ],
    products: [],
    targets: [
        .executableTarget(
            name: "CRGTHost",
            path: "Sources/CRGTHost",
            resources: [
                .copy("Resources"),
                .process("Assets.xcassets")
            ]
        )
    ]
)

#if canImport(AppleProductTypes)
import AppleProductTypes

package.products += [
    .iOSApplication(
        name: "CRGT Host",
        targets: ["CRGTHost"],
        bundleIdentifier: "io.github.tazzinaz.crgthost",
        displayVersion: "1.0",
        bundleVersion: "1",
        appIcon: .asset("AppIcon"),
        accentColor: .presetColor(.orange),
        supportedDeviceFamilies: [
            .pad,
            .phone
        ],
        supportedInterfaceOrientations: [
            .portrait,
            .landscapeRight,
            .landscapeLeft,
            .portraitUpsideDown(.when(deviceFamilies: [.pad]))
        ],
        capabilities: [
            .bluetoothAlways(purposeString: "CRGT Host connects to Bluetooth MIDI keyboards and controllers, and lets a Mac connect to this iPad over Bluetooth MIDI."),
            .localNetwork(purposeString: "CRGT Host receives MIDI over Wi-Fi from a Mac's network MIDI session (Audio MIDI Setup).", bonjourServiceTypes: ["_apple-midi._udp"]),
            .outgoingNetworkConnections()
        ],
        appCategory: .music,
        additionalInfoPlistContentFilePath: "Info.plist"
    )
]
#endif
