// CRGT Host: CRGT Sample Workstation as an iPad app, so it gets the iPad's MIDI (which Safari keeps from web pages):
// IDAM MIDI Host from a Mac by cable, USB and Bluetooth MIDI devices, Wi-Fi MIDI from a Mac, and other iPad apps.

import SwiftUI

@main
struct CRGTHostApp: App {
    init() {
        AudioSetup.activate()
    }

    var body: some Scene {
        WindowGroup {
            HostView()
                .ignoresSafeArea()
                .background(Color(red: 0x27 / 255.0, green: 0x27 / 255.0, blue: 0x2A / 255.0))
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)   // playing near the edges does not pull in Control Center
        }
    }
}

struct HostView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> HostController { HostController() }
    func updateUIViewController(_ controller: HostController, context: Context) {}
}
