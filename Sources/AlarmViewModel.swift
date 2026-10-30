import Combine
import EventKit
import Foundation

@MainActor
final class AlarmViewModel: ObservableObject {
    @Published private(set) var events: [CalendarEvent] = []
    @Published private(set) var scheduledEventIDs: Set<String> = []
    @Published private(set) var statusMessage: String?
    @Published private(set) var isLoading = false
    @Published private(set) var requiresSettings = false
    @Published private(set) var hasEnabledAutomaticAlarms = false
    @Published private(set) var alarmLeadTimeMinutes: Int

    private let alarmService = CalendarAlarmService()
    private var eventStoreChanges: AnyCancellable?
    private var refreshRequestedWhileLoading = false

    init() {
        let savedMinutes = UserDefaults.standard.object(
            forKey: CalendarAlarmService.alarmLeadTimeMinutesKey
        ) as? Int ?? 10
        alarmLeadTimeMinutes = min(max(savedMinutes, 1), 1_440)

        eventStoreChanges = NotificationCenter.default
            .publisher(for: .EKEventStoreChanged)
            .debounce(for: .milliseconds(500), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in
                    await self?.refreshIfAuthorized()
                }
            }
    }

    func enableAutomaticAlarms() async {
        isLoading = true
        requiresSettings = false
        defer { finishLoading() }

        do {
            try await alarmService.requestCalendarAccess()
            try await alarmService.requestAlarmAccess()
            try await updateEventsAndAlarms()
        } catch {
            statusMessage = "İşlem tamamlanamadı: \(error.localizedDescription)"
            requiresSettings = true
        }
    }

    func refreshIfAuthorized() async {
        if isLoading {
            refreshRequestedWhileLoading = true
            return
        }
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess,
              await alarmService.hasAlarmAccess() else {
            return
        }
        hasEnabledAutomaticAlarms = true

        isLoading = true
        defer { finishLoading() }

        do {
            try await updateEventsAndAlarms()
        } catch {
            statusMessage = "Takvim alarmları güncellenemedi: \(error.localizedDescription)"
        }
    }

    func updateAlarmLeadTime(_ minutes: Int) async {
        let validMinutes = min(max(minutes, 1), 1_440)
        guard validMinutes != alarmLeadTimeMinutes else { return }

        UserDefaults.standard.set(
            validMinutes,
            forKey: CalendarAlarmService.alarmLeadTimeMinutesKey
        )
        alarmLeadTimeMinutes = validMinutes
        await refreshIfAuthorized()
    }

    private func updateEventsAndAlarms() async throws {
        let upcomingEvents = alarmService.upcomingEvents()
        let summary = try await alarmService.scheduleAlarms(for: upcomingEvents)
        events = upcomingEvents
        scheduledEventIDs = summary.scheduledEventIDs

        var message = "\(summary.scheduledEventIDs.count) etkinliğe otomatik alarm kuruldu."
        if summary.skippedBecauseTooSoon > 0 {
            message += " Alarm zamanı geçmiş veya \(alarmLeadTimeMinutes) dakikadan yakın olan \(summary.skippedBecauseTooSoon) etkinlik atlandı."
        }
        if summary.skippedBecauseLimit > 0 {
            message += " Sistem alarm sınırı nedeniyle \(summary.skippedBecauseLimit) etkinliğe alarm kurulamadı."
        }
        statusMessage = message
    }

    private func finishLoading() {
        isLoading = false
        guard refreshRequestedWhileLoading else { return }

        refreshRequestedWhileLoading = false
        Task { @MainActor [weak self] in
            await self?.refreshIfAuthorized()
        }
    }
}
