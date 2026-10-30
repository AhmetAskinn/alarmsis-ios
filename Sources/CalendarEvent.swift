import EventKit
import Foundation

struct CalendarEvent: Identifiable {
    let id: String
    let title: String
    let calendarTitle: String
    let startDate: Date
    let timeZoneIdentifier: String?

    init(event: EKEvent) {
        id = event.eventIdentifier ?? UUID().uuidString
        title = event.title ?? "Başlıksız etkinlik"
        calendarTitle = event.calendar.title
        startDate = event.startDate
        timeZoneIdentifier = event.timeZone?.identifier
    }

    var formattedStartDate: String {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.timeZone = timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) ?? .autoupdatingCurrent
        return formatter.string(from: startDate)
    }
}
