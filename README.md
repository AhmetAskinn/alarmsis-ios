# Alertify iOS

Alertify runs on the iPhone, reads its local calendars, and automatically schedules an alarm before each timed event. Choose 5, 10, 15, 30, or 60 minutes, or a custom lead time from 1 minute to 24 hours in Alarm Settings. The preference is stored on the device and changing it updates existing scheduled alarms. It does not need a server or cloud service.

## Open and run

Open `alertify.xcodeproj` in Xcode, select an iPhone simulator or device, and run the `alarmsis` target. The deployment target is iOS 17.

## View the interface demo on an iPhone

The `demo` folder contains a responsive, interactive preview with sample calendar events. It does not read a real calendar or sound alarms. Live Server is only needed to preview this web demo on another device; the iOS app itself runs locally on the iPhone.

### VS Code Mobile Preview

Start a local web server from the `alarmsis-ios` project folder:

```powershell
python -m http.server 5500 --bind 0.0.0.0
```

In the VS Code Mobile Preview panel, open `http://127.0.0.1:5500/demo/`. Choose a 402 × 874 viewport (iPhone 16 Pro logical points) to inspect the responsive layout. Keep the terminal task running while previewing.

The local server only serves the demo files; it does not connect to a real calendar or schedule alarms.

1. Open the `alarmsis-ios` folder in VS Code.
2. Install the recommended **Live Server** extension (`ritwickdey.liveserver`) if prompted.
3. Open `demo/index.html` and select **Go Live** in the status bar. The project configures Live Server to listen on port `5500` on the local network.
4. Connect the iPhone and computer to the same Wi-Fi network. On the iPhone, open Safari and go to `http://<computer-local-IP>:5500/demo/`. Find the computer's IPv4 address with `ipconfig` in PowerShell.

If Windows Firewall asks, allow VS Code/Live Server on your private network. Guest Wi-Fi or network client isolation can prevent the iPhone from reaching the computer. Do not expose this development server to the public internet.

## Calendar access

The app reads all calendars available through Apple's EventKit. This includes iCloud calendars and Google calendars that have been added to the iPhone and enabled for Calendar sync. It does not sign in to Google directly.

After you grant calendar and alarm access once, the app automatically schedules alarms for timed events using your selected lead time; you do not need to create alarms yourself. On iOS 26 and later, it uses Apple's AlarmKit to play a prominent, app-owned alarm. This alarm is managed by Alertify, not added to Apple's Clock app. On earlier iOS versions, the app falls back to local notifications.

The app refreshes when opened or brought back to the foreground and listens for calendar changes while running. It scans the next 30 days and schedules up to 64 alarms/notifications. Events whose selected alarm time has already passed and events beyond that limit are not scheduled in the current pass.

iOS does not guarantee that an app will run immediately when its calendar changes while it is suspended or closed. Reopen the app or bring it to the foreground to sync changes made while it was not running. Already scheduled notifications can still fire while the app is closed.

On iOS 26, AlarmKit alarms can alert through Silent mode and Focus when the user has authorized alarms. The older notification fallback follows iOS notification and device settings.

Event times are scheduled as absolute instants from EventKit. Events with an explicit time zone therefore keep their intended instant when traveling; floating-time events can follow the calendar's own behavior.
