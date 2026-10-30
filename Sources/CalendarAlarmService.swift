import EventKit
import Foundation
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

enum CalendarAlarmError: LocalizedError {
    case calendarAccessDenied
    case notificationAccessDenied
    case alarmAccessDenied
    case timeZoneUnavailable

    var errorDescription: String? {
        switch self {
        case .calendarAccessDenied:
            return "Takvim erişimi verilmedi. iPhone Ayarlar uygulamasından izin verebilirsiniz."
        case .notificationAccessDenied:
            return "Bildirim izni verilmedi. iPhone Ayarlar uygulamasından bildirimleri açabilirsiniz."
        case .alarmAccessDenied:
            return "Alarm kurma izni verilmedi. iPhone Ayarlar uygulamasından izin verebilirsiniz."
        case .timeZoneUnavailable:
            return "Alarm zamanı için saat dilimi oluşturulamadı."
        }
    }
}

struct AlarmSchedulingSummary {
    let scheduledEventIDs: Set<String>
    let skippedBecauseTooSoon: Int
    let skippedBecauseLimit: Int
}

@MainActor
final class CalendarAlarmService {
    private let eventStore = EKEventStore()
    private let notificationCenter = UNUserNotificationCenter.current()
    private let notificationPrefix = "alarmsis.event."
    private let schedulingLimit = 64
    private let lookAhead: TimeInterval = 30 * 24 * 60 * 60
    private var leadTime: TimeInterval {
        let minutes = UserDefaults.standard.object(forKey: Self.alarmLeadTimeMinutesKey) as? Int ?? 10
        return TimeInterval(min(max(minutes, 1), 1_440) * 60)
    }

    static let alarmLeadTimeMinutesKey = "alarmsis.alarmLeadTimeMinutes"
    private let alarmIDsKey = "alarmsis.scheduledAlarmIDs"
    private let alarmFireDatesKey = "alarmsis.scheduledAlarmFireDates"

    func requestCalendarAccess() async throws {
        guard try await eventStore.requestFullAccessToEvents() else {
            throw CalendarAlarmError.calendarAccessDenied
        }
    }

    func requestAlarmAccess() async throws {
        if #available(iOS 26.0, *), canUseAlarmKit {
            let state = try await AlarmManager.shared.requestAuthorization()
            guard state == .authorized else {
                throw CalendarAlarmError.alarmAccessDenied
            }
        } else {
            let granted = try await notificationCenter.requestAuthorization(
                options: [.alert, .sound, .badge]
            )
            guard granted else {
                throw CalendarAlarmError.notificationAccessDenied
            }
        }
    }

    func hasAlarmAccess() async -> Bool {
        if #available(iOS 26.0, *), canUseAlarmKit {
            return AlarmManager.shared.authorizationState == .authorized
        } else {
            let settings = await notificationCenter.notificationSettings()
            return settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
                || settings.authorizationStatus == .ephemeral
        }
    }

    func upcomingEvents() -> [CalendarEvent] {
        let now = Date()
        let end = now.addingTimeInterval(lookAhead)
        let predicate = eventStore.predicateForEvents(
            withStart: now,
            end: end,
            calendars: nil
        )

        return eventStore.events(matching: predicate)
            .filter { !$0.isAllDay && $0.startDate > now }
            .map(CalendarEvent.init(event:))
            .sorted { $0.startDate < $1.startDate }
    }

    func scheduleAlarms(for events: [CalendarEvent]) async throws -> AlarmSchedulingSummary {
        let configuredLeadTime = leadTime
        if #available(iOS 26.0, *), canUseAlarmKit {
            return try await scheduleSystemAlarms(for: events, leadTime: configuredLeadTime)
        }

        return try await scheduleNotificationAlarms(for: events, leadTime: configuredLeadTime)
    }

    private var canUseAlarmKit: Bool {
        #if canImport(AlarmKit)
        true
        #else
        false
        #endif
    }

    private func scheduleNotificationAlarms(
        for events: [CalendarEvent],
        leadTime: TimeInterval
    ) async throws -> AlarmSchedulingSummary {
        let now = Date()
        let eligibleEvents = events.filter {
            $0.startDate.timeIntervalSince(now) >= leadTime
        }
        let selectedEvents = Array(eligibleEvents.prefix(schedulingLimit))
        let pendingRequests = await pendingNotificationRequests()
        let oldAlarmIDs = pendingRequests
            .map(\.identifier)
            .filter { $0.hasPrefix(notificationPrefix) }
        notificationCenter.removePendingNotificationRequests(withIdentifiers: oldAlarmIDs)

        for event in selectedEvents {
            try await addNotification(for: event, leadTime: leadTime)
        }

        return AlarmSchedulingSummary(
            scheduledEventIDs: Set(selectedEvents.map(\.id)),
            skippedBecauseTooSoon: events.count - events.filter {
                $0.startDate.timeIntervalSince(now) >= leadTime
            }.count,
            skippedBecauseLimit: max(0, eligibleEvents.count - selectedEvents.count)
        )
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private func scheduleSystemAlarms(
        for events: [CalendarEvent],
        leadTime: TimeInterval
    ) async throws -> AlarmSchedulingSummary {
        let manager = AlarmManager.shared
        guard manager.authorizationState == .authorized else {
            throw CalendarAlarmError.alarmAccessDenied
        }

        let now = Date()
        let eligibleEvents = events.filter {
            $0.startDate.timeIntervalSince(now) >= leadTime
        }
        let selectedEvents = Array(eligibleEvents.prefix(schedulingLimit))
        let selectedByID = Dictionary(
            selectedEvents.map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        let activeAlarmIDs = Set(try manager.alarms.map { $0.id.uuidString })
        var storedIDs = UserDefaults.standard.dictionary(forKey: alarmIDsKey) as? [String: String] ?? [:]
        var storedFireDates = UserDefaults.standard.dictionary(forKey: alarmFireDatesKey) as? [String: Double] ?? [:]
        var scheduledEventIDs = Set<String>()

        for (eventID, storedID) in Array(storedIDs) {
            let matchingEvent = selectedByID[eventID]
            let expectedFireDate = matchingEvent.map {
                $0.startDate.addingTimeInterval(-leadTime).timeIntervalSince1970
            }
            let isUnchanged = expectedFireDate.map {
                abs($0 - (storedFireDates[eventID] ?? 0)) < 1
            } ?? false

            if isUnchanged, activeAlarmIDs.contains(storedID) {
                scheduledEventIDs.insert(eventID)
                continue
            }

            if activeAlarmIDs.contains(storedID), let alarmID = UUID(uuidString: storedID) {
                try manager.cancel(id: alarmID)
            }
            storedIDs.removeValue(forKey: eventID)
            storedFireDates.removeValue(forKey: eventID)
        }

        for event in selectedEvents where !scheduledEventIDs.contains(event.id) {
            let fireDate = event.startDate.addingTimeInterval(-leadTime)
            let alarmID = UUID()
            let alert = AlarmPresentation.Alert(title: "\(event.title) için alarm")
            let attributes = AlarmAttributes<AlarmSisMetadata>(
                presentation: AlarmPresentation(alert: alert),
                metadata: AlarmSisMetadata(),
                tintColor: .green
            )
            let configuration = AlarmManager.AlarmConfiguration.alarm(
                schedule: .fixed(fireDate),
                attributes: attributes,
                sound: .default
            )

            do {
                try await manager.schedule(id: alarmID, configuration: configuration)
            } catch let error as AlarmManager.AlarmError where error == .maximumLimitReached {
                break
            }
            storedIDs[event.id] = alarmID.uuidString
            storedFireDates[event.id] = fireDate.timeIntervalSince1970
            scheduledEventIDs.insert(event.id)
            UserDefaults.standard.set(storedIDs, forKey: alarmIDsKey)
            UserDefaults.standard.set(storedFireDates, forKey: alarmFireDatesKey)
        }

        UserDefaults.standard.set(storedIDs, forKey: alarmIDsKey)
        UserDefaults.standard.set(storedFireDates, forKey: alarmFireDatesKey)

        return AlarmSchedulingSummary(
            scheduledEventIDs: scheduledEventIDs,
            skippedBecauseTooSoon: events.count - eligibleEvents.count,
            skippedBecauseLimit: max(0, eligibleEvents.count - scheduledEventIDs.count)
        )
    }

    @available(iOS 26.0, *)
    private struct AlarmSisMetadata: AlarmMetadata {}
    #endif

    private func addNotification(for event: CalendarEvent, leadTime: TimeInterval) async throws {
        let fireDate = event.startDate.addingTimeInterval(-leadTime)
        var utcCalendar = Calendar(identifier: .gregorian)
        guard let utcTimeZone = TimeZone(secondsFromGMT: 0) else {
            throw CalendarAlarmError.timeZoneUnavailable
        }
        utcCalendar.timeZone = utcTimeZone
        var components = utcCalendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: fireDate
        )
        components.calendar = utcCalendar
        components.timeZone = utcTimeZone

        let content = UNMutableNotificationContent()
        let minutes = Int(leadTime / 60)
        content.title = "Etkinliğe \(minutes) dakika kaldı"
        content.body = event.title
        content.sound = .default

        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(
            identifier: notificationPrefix + event.id,
            content: content,
            trigger: trigger
        )

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            notificationCenter.add(request) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private func pendingNotificationRequests() async -> [UNNotificationRequest] {
        await withCheckedContinuation { continuation in
            notificationCenter.getPendingNotificationRequests { requests in
                continuation.resume(returning: requests)
            }
        }
    }
}
