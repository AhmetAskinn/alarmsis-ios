import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel = AlarmViewModel()
    @State private var showsAlarmSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.events.isEmpty {
                    emptyState
                } else {
                    eventList
                }
            }
            .navigationTitle("Alertify")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showsAlarmSettings = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("Alarm ayarları")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await viewModel.refreshIfAuthorized() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(viewModel.isLoading)
                    .accessibilityLabel("Takvimi yenile")
                }
            }
        }
        .sheet(isPresented: $showsAlarmSettings) {
            AlarmSettingsSheet(viewModel: viewModel)
        }
        .task {
            await viewModel.refreshIfAuthorized()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await viewModel.refreshIfAuthorized() }
        }
    }

    private struct AlarmSettingsSheet: View {
        @Environment(\.dismiss) private var dismiss
        @ObservedObject var viewModel: AlarmViewModel
        @State private var selectedPreset: Int
        @State private var customMinutes: Int

        init(viewModel: AlarmViewModel) {
            self.viewModel = viewModel
            let currentMinutes = viewModel.alarmLeadTimeMinutes
            _selectedPreset = State(
                initialValue: [5, 10, 15, 30, 60].contains(currentMinutes) ? currentMinutes : 0
            )
            _customMinutes = State(initialValue: currentMinutes)
        }

        var body: some View {
            NavigationStack {
                Form {
                    Section("Alarm zamanı") {
                        Picker("Etkinlikten önce", selection: $selectedPreset) {
                            Text("Özel süre").tag(0)
                            Text("5 dakika önce").tag(5)
                            Text("10 dakika önce").tag(10)
                            Text("15 dakika önce").tag(15)
                            Text("30 dakika önce").tag(30)
                            Text("1 saat önce").tag(60)
                        }
                        .onChange(of: selectedPreset) { _, minutes in
                            guard minutes > 0 else { return }
                            Task { await viewModel.updateAlarmLeadTime(minutes) }
                        }

                        if selectedPreset == 0 {
                            Stepper(value: $customMinutes, in: 1...1_440) {
                                LabeledContent("Özel süre", value: "\(customMinutes) dakika önce")
                            }

                            Button("Özel süreyi uygula") {
                                Task { await viewModel.updateAlarmLeadTime(customMinutes) }
                            }
                            .disabled(customMinutes == viewModel.alarmLeadTimeMinutes)
                        }
                    }

                    Section {
                        Label(
                            "Ayar bu iPhone'da saklanır ve sonraki otomatik alarmlara uygulanır.",
                            systemImage: "iphone"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }
                .navigationTitle("Alarm ayarları")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Bitti") {
                            dismiss()
                        }
                    }
                }
            }
        }
    }
    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "alarm")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text(viewModel.hasEnabledAutomaticAlarms ? "Yaklaşan toplantı yok" : "Takvim alarmların hazır olsun")
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)

            Text(viewModel.hasEnabledAutomaticAlarms
                 ? "Yeni bir toplantı eklendiğinde alarmı otomatik planlayacağız."
                 : "Bir kez takvim ve alarm izni ver. Sonraki toplantıların için alarmlar otomatik kurulsun; tek tek alarm kurmana gerek yok.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if !viewModel.hasEnabledAutomaticAlarms && !viewModel.requiresSettings {
                accessButton
            }

            Text("iOS 26 ve üzeri: Alertify alarmı olarak çalar, Saat uygulamasına eklenmez. Eski iOS sürümlerinde bildirim kullanılır.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.tertiary)

            if let statusMessage = viewModel.statusMessage {
                status(statusMessage)
            }

            if viewModel.requiresSettings {
                settingsButton
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var eventList: some View {
        List {
            if let statusMessage = viewModel.statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Yaklaşan etkinlikler") {
                ForEach(viewModel.events) { event in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: viewModel.scheduledEventIDs.contains(event.id)
                              ? "alarm.fill"
                              : "alarm")
                            .foregroundStyle(viewModel.scheduledEventIDs.contains(event.id) ? .tint : .secondary)
                            .padding(.top, 2)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.title)
                                .font(.body.weight(.medium))
                            Text(event.formattedStartDate)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(event.calendarTitle)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
            }
            Section {
                if viewModel.requiresSettings {
                    settingsButton
                }
            }
        }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var accessButton: some View {
        Button {
            Task { await viewModel.enableAutomaticAlarms() }
        } label: {
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else {
                Text("Otomatik alarmları etkinleştir")
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(viewModel.isLoading)
    }

    private var settingsButton: some View {
        Button("Ayarlar'ı aç") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
        .buttonStyle(.bordered)
    }

    private func status(_ message: String) -> some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
    }
}
