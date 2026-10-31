# Alertify

Alertify is being rebuilt with React Native and Expo so it can be developed on Windows and tested on an iPhone without a Mac.

## Test on an iPhone with Expo Go

This Expo Go version is a development preview. It uses sample calendar events and schedules real local notifications; it does not read the iPhone's calendars.

1. Install the current [Node.js LTS release](https://nodejs.org/en/download) on the computer.
2. Install **Expo Go** from the App Store on the iPhone.
3. Connect the computer and iPhone to the same Wi-Fi network.
4. In the project folder, double-click `Expo-Giris-ve-Baslat.cmd`. A browser opens for Expo account sign-in. Sign in with your Expo account; after login, the script starts the development server and displays a QR code. Keep its window open.

5. Scan the terminal QR code with the iPhone camera, then open it in Expo Go. You can also scan it from Expo Go.
6. In Alertify, use **Ayarlar → 5 saniyelik deneme bildirimi** to test notifications, or enable the sample event reminders from the **Takvim** tab.

Sign in to the same Expo account in the Expo Go app on the iPhone. The CLI login opens in your browser; enter your credentials there, not in this chat. Allow VS Code/Node.js through Windows Firewall on a private network if prompted. If the local network blocks device discovery, the server can also be started with `npm.cmd run start:tunnel`. A VPN, guest Wi-Fi, or router client isolation can prevent a local connection.

The project uses Expo SDK 58 to match the current Expo Go version on the iPhone. Local notifications are supported in Expo Go. The `expo-calendar` native module is not available in Expo Go, so calendar access is intentionally not included in this preview. A later version that reads real iPhone calendars will need an Expo development build; it can be built in the cloud, without owning a Mac, though installing a development build on an iPhone may require an Apple Developer account.

## Existing SwiftUI version

The earlier native iOS implementation remains in `Sources/` and `alertify.xcodeproj/` as a reference. Building that version requires Xcode on a Mac.

It reads local and synced Apple calendars and schedules notifications (or AlarmKit alarms on supported iOS versions). It scans up to 30 days ahead and limits each scheduling pass to 64 alarms. The `demo/` folder remains a browser-only mockup and can still be previewed with Live Server.
