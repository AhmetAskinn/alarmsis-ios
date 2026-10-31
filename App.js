import { useMemo, useState } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";

const COLORS = {
  background: "#f6f7f4",
  surface: "#ffffff",
  ink: "#1d2925",
  muted: "#84918a",
  green: "#277b5d",
  greenDark: "#1e624a",
  greenSoft: "#e8f2ed",
  line: "#edf0ed",
};

const PRESETS = [5, 10, 15, 30, 60];
const EVENT_TEMPLATES = {
  0: [
    { hour: 9, minute: 30, title: "Lizbon'a uçuş", location: "İstanbul Havalimanı", color: "#e9975a" },
    { hour: 13, minute: 0, title: "Otel giriş saati", location: "Memmo Alfama · Lizbon", color: "#647dcc" },
    { hour: 16, minute: 15, title: "Müşteri toplantısı", location: "LX Factory · Lizbon", color: "#bc76ad" },
  ],
  1: [
    { hour: 10, minute: 0, title: "Londra'ya uçuş", location: "Lizbon Havalimanı", color: "#e9975a" },
    { hour: 11, minute: 45, title: "Şehir turu", location: "South Bank · Londra", color: "#5b9e82" },
  ],
  2: [
    { hour: 8, minute: 30, title: "Dönüş uçuşu", location: "Heathrow Havalimanı · Londra", color: "#e9975a" },
    { hour: 14, minute: 0, title: "Yaratıcı ekip görüşmesi", location: "Soho House · New York", color: "#bc76ad" },
  ],
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function formatTime(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function dateForOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  date.setHours(0, 0, 0, 0);
  return date;
}

function eventsForDay(offset, leadTimeMinutes) {
  const date = dateForOffset(offset);
  const now = new Date();

  return (EVENT_TEMPLATES[offset] ?? [])
    .map((template, index) => {
      const startDate = new Date(date);
      startDate.setHours(template.hour, template.minute, 0, 0);

      return {
        ...template,
        id: `${date.toISOString().slice(0, 10)}-${index}`,
        startDate,
        alarmDate: new Date(startDate.getTime() - leadTimeMinutes * 60_000),
      };
    })
    .filter((event) => event.startDate > now);
}

function ActionButton({ label, onPress, disabled, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text style={[styles.actionButtonText, secondary && styles.secondaryButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EventCard({ event, alarmEnabled, compact = false }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTime}>
        <Text style={styles.eventTimeText}>
          {compact ? formatTime(event.alarmDate) : formatTime(event.startDate)}
        </Text>
        <Text style={styles.eventTimeCaption}>{compact ? "alarm" : "yerel saat"}</Text>
      </View>
      <View style={[styles.eventDivider, { backgroundColor: event.color }]} />
      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          {alarmEnabled ? (
            <Text style={styles.alarmChip}>
              {compact ? `Etkinlik ${formatTime(event.startDate)}` : formatTime(event.alarmDate)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.eventLocation}>
          {compact ? event.location : `${event.location} · örnek etkinlik`}
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  const [selectedTab, setSelectedTab] = useState("calendar");
  const [selectedDay, setSelectedDay] = useState(0);
  const [alarmMinutes, setAlarmMinutes] = useState(10);
  const [customMinutes, setCustomMinutes] = useState("10");
  const [isCustomAlarmTime, setIsCustomAlarmTime] = useState(false);
  const [alarmsEnabled, setAlarmsEnabled] = useState(false);
  const [scheduledEventIDs, setScheduledEventIDs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Geliştirme önizlemesi: takvimde örnek etkinlikler gösteriliyor.",
  );

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, offset) => dateForOffset(offset)),
    [],
  );
  const selectedEvents = useMemo(
    () => eventsForDay(selectedDay, alarmMinutes),
    [selectedDay, alarmMinutes],
  );
  const upcomingEvents = useMemo(
    () =>
      Array.from({ length: 5 }, (_, offset) => eventsForDay(offset, alarmMinutes))
        .flat()
        .sort((first, second) => first.startDate - second.startDate),
    [alarmMinutes],
  );
  const nextEvent = upcomingEvents[0];
  const scheduledEvents = upcomingEvents.filter((event) =>
    scheduledEventIDs.includes(event.id),
  );
  const selectedPreset =
    !isCustomAlarmTime && PRESETS.includes(alarmMinutes) ? alarmMinutes : null;

  async function ensureNotificationPermission() {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Etkinlik alarmları",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") {
      return true;
    }

    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === "granted";
  }

  async function clearSampleNotifications() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const sampleNotifications = scheduled.filter(
      (notification) => notification.content.data?.alertifySample === true,
    );
    await Promise.all(
      sampleNotifications.map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
    );
  }

  async function scheduleAlarms(minutes = alarmMinutes) {
    setIsLoading(true);
    try {
      const permissionGranted = await ensureNotificationPermission();
      if (!permissionGranted) {
        setStatusMessage("Bildirim izni verilmedi. iPhone Ayarları'ndan bildirimleri açabilirsiniz.");
        return false;
      }

      await clearSampleNotifications();
      const now = Date.now();
      const eligibleEvents = upcomingEvents.filter(
        (event) => event.startDate.getTime() - now >= minutes * 60_000,
      );
      const eventsToSchedule = eligibleEvents.slice(0, 64);

      for (const event of eventsToSchedule) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `${minutes} dakika sonra: ${event.title}`,
            body: `${formatTime(event.startDate)} etkinliği için örnek hatırlatma.`,
            sound: "default",
            data: { alertifySample: true, eventId: event.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(event.startDate.getTime() - minutes * 60_000),
          },
        });
      }

      setAlarmsEnabled(true);
      setScheduledEventIDs(eventsToSchedule.map((event) => event.id));
      const skippedCount = upcomingEvents.length - eligibleEvents.length;
      setStatusMessage(
        `${eventsToSchedule.length} örnek etkinlik için yerel bildirim planlandı.${skippedCount > 0 ? ` Alarm zamanı geçmiş veya ${minutes} dakikadan yakın ${skippedCount} etkinlik atlandı.` : ""} Gerçek takvim kullanılmıyor.`,
      );
      return true;
    } catch (error) {
      setAlarmsEnabled(false);
      setScheduledEventIDs([]);
      setStatusMessage(
        `Bildirimler planlanamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function scheduleTestNotification() {
    setIsLoading(true);
    try {
      const permissionGranted = await ensureNotificationPermission();
      if (!permissionGranted) {
        setStatusMessage("Deneme bildirimi için bildirim izni gerekli.");
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Alertify deneme bildirimi",
          body: "Expo Go üzerinden yerel bildirim başarıyla çalışıyor.",
          sound: "default",
          data: { alertifySample: true, test: true },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
        },
      });
      setStatusMessage("Deneme bildirimi 5 saniye sonrasına kuruldu.");
    } catch (error) {
      setStatusMessage(
        `Deneme bildirimi kurulamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function saveAlarmTime() {
    Keyboard.dismiss();
    const value = Number(customMinutes);
    if (!Number.isInteger(value) || value < 1 || value > 1_440) {
      setStatusMessage("Özel süre 1 ile 1440 dakika arasında olmalı.");
      return;
    }

    setAlarmMinutes(value);
    if (alarmsEnabled) {
      await scheduleAlarms(value);
    } else {
      setStatusMessage(`Alarm süresi etkinlikten ${value} dakika öncesine ayarlandı.`);
    }
  }

  function choosePreset(value) {
    setIsCustomAlarmTime(false);
    setAlarmMinutes(value);
    setCustomMinutes(String(value));
  }

  function renderCalendar() {
    return (
      <>
        <View style={styles.greeting}>
          <View style={styles.greetingCopy}>
            <Text style={styles.eyebrow}>{formatLongDate(new Date()).toLocaleUpperCase("tr-TR")}</Text>
            <Text style={styles.heading}>Günün hazır.</Text>
            <Text style={styles.mutedText}>Sen planlarına odaklan. Alarmları biz hatırlatırız.</Text>
          </View>
          <View style={styles.syncPill}>
            <View style={styles.syncDot} />
            <Text style={styles.syncText}>Örnek</Text>
          </View>
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Takvimin</Text>
          <Pressable onPress={() => setSelectedDay(0)}>
            <Text style={styles.textButton}>Bugüne dön</Text>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStrip}
        >
          {days.map((date, offset) => {
            const selected = offset === selectedDay;
            const dayText =
              offset === 0
                ? "Bugün"
                : offset === 1
                  ? "Yarın"
                  : new Intl.DateTimeFormat("tr-TR", { weekday: "short" })
                      .format(date)
                      .replace(".", "");
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={date.toISOString()}
                onPress={() => setSelectedDay(offset)}
                style={[styles.dateButton, selected && styles.selectedDateButton]}
              >
                <Text style={[styles.dateDay, selected && styles.selectedDateText]}>{dayText}</Text>
                <Text style={[styles.dateNumber, selected && styles.selectedDateText]}>
                  {date.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {nextEvent ? (
          <View style={styles.nextAlarmCard}>
            <View style={styles.nextAlarmIcon}>
              <Text style={styles.nextAlarmIconText}>◷</Text>
            </View>
            <View style={styles.nextAlarmCopy}>
              <Text style={styles.nextAlarmLabel}>SIRADAKİ ÖRNEK ALARM</Text>
              <Text style={styles.nextAlarmTime}>{formatTime(nextEvent.alarmDate)}</Text>
              <Text style={styles.nextAlarmTitle}>{nextEvent.title} için</Text>
            </View>
            <Text style={styles.countdown}>{alarmMinutes} dk önce</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Yaklaşan etkinlikler</Text>
            <Text style={styles.sectionCaption}>
              {selectedDay === 0 ? "Bugün için planların" : formatLongDate(days[selectedDay])}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Takvimi yenile"
            onPress={() => setStatusMessage("Örnek takvim yenilendi.")}
            style={styles.refreshButton}
          >
            <Text style={styles.refreshButtonText}>↻</Text>
          </Pressable>
        </View>

        {selectedEvents.length > 0 ? (
          selectedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              alarmEnabled={alarmsEnabled && scheduledEventIDs.includes(event.id)}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Yaklaşan etkinlik yok</Text>
            <Text style={styles.mutedText}>Bu gün için örnek etkinlik eklenmemiş.</Text>
          </View>
        )}

        <View style={styles.demoNotice}>
          <Text style={styles.demoNoticeIcon}>i</Text>
          <Text style={styles.demoNoticeText}>
            Expo Go önizlemesi · Gerçek takvim yerine örnek etkinlikler
          </Text>
        </View>
        <ActionButton
          disabled={isLoading}
          label={isLoading ? "Bildirimler hazırlanıyor..." : "Örnek alarmları etkinleştir"}
          onPress={() => scheduleAlarms()}
        />
      </>
    );
  }

  function renderAlarms() {
    return (
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.heading}>Kurulu alarmlar</Text>
          <Text style={styles.mutedText}>Seçtiğin süreye göre otomatik</Text>
        </View>
        {scheduledEvents.length > 0 ? (
          scheduledEvents.map((event, index) => (
            <View key={event.id}>
              {index === 0 ||
              scheduledEvents[index - 1].startDate.toDateString() !== event.startDate.toDateString() ? (
                <Text style={styles.alarmDateHeading}>{formatLongDate(event.startDate)}</Text>
              ) : null}
              <EventCard event={event} alarmEnabled compact />
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Yaklaşan alarm yok</Text>
            <Text style={styles.mutedText}>Takvim sekmesinden örnek alarmları etkinleştir.</Text>
          </View>
        )}
        <Text style={styles.smallNote}>
          {alarmsEnabled
            ? "Örnek etkinlikler için yerel bildirimler planlandı."
            : "Bildirimleri planlamak için Takvim sekmesinden örnek alarmları etkinleştir."}
        </Text>
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.heading}>Ayarlar</Text>
          <Text style={styles.mutedText}>Alertify geliştirme önizlemesi</Text>
        </View>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Otomatik alarm zamanı</Text>
          <Text style={styles.mutedText}>Etkinlik başlamadan ne kadar önce hatırlatsın?</Text>
          <Text style={styles.inputLabel}>Etkinlikten önce</Text>
          <View style={styles.presetList}>
            {PRESETS.map((value) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selectedPreset === value }}
                key={value}
                onPress={() => choosePreset(value)}
                style={[styles.presetButton, selectedPreset === value && styles.selectedPreset]}
              >
                <Text
                  style={[
                    styles.presetText,
                    selectedPreset === value && styles.selectedPresetText,
                  ]}
                >
                  {value === 60 ? "1 saat" : `${value} dk`}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selectedPreset === null }}
              onPress={() => setIsCustomAlarmTime(true)}
              style={[styles.presetButton, selectedPreset === null && styles.selectedPreset]}
            >
              <Text style={[styles.presetText, selectedPreset === null && styles.selectedPresetText]}>
                Özel
              </Text>
            </Pressable>
          </View>
          {selectedPreset === null ? (
            <View style={styles.customInputRow}>
              <TextInput
                accessibilityLabel="Özel alarm süresi, dakika"
                keyboardType="number-pad"
                maxLength={4}
                onChangeText={setCustomMinutes}
                value={customMinutes}
                style={styles.customInput}
              />
              <Text style={styles.mutedText}>dakika önce (1–1440)</Text>
            </View>
          ) : null}
          <ActionButton label="Alarm süresini kaydet" onPress={saveAlarmTime} />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Bildirimleri dene</Text>
          <Text style={styles.mutedText}>
            iPhone’da bildirim iznini isteyip 5 saniye sonra bir test bildirimi gösterir.
          </Text>
          <ActionButton
            disabled={isLoading}
            label={isLoading ? "Hazırlanıyor..." : "5 saniyelik deneme bildirimi"}
            onPress={scheduleTestNotification}
            secondary
          />
        </View>

        <View style={styles.demoNotice}>
          <Text style={styles.demoNoticeIcon}>i</Text>
          <Text style={styles.demoNoticeText}>
            Bu sürüm örnek takvim kullanır. Gerçek iPhone takvimi erişimi Expo Go’da desteklenmez.
          </Text>
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      <View style={styles.app}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>◷</Text>
            </View>
            <Text style={styles.brandText}>alertify</Text>
          </View>
          <Text style={styles.previewBadge}>ÖNİZLEME</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === "calendar" ? renderCalendar() : null}
          {selectedTab === "alarms" ? renderAlarms() : null}
          {selectedTab === "settings" ? renderSettings() : null}
          {statusMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.statusMessage}>
              {statusMessage}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.tabBar}>
          {[
            { id: "calendar", label: "Takvim", icon: "▦" },
            { id: "alarms", label: "Alarmlar", icon: "◷" },
            { id: "settings", label: "Ayarlar", icon: "⚙" },
          ].map((tab) => {
            const selected = selectedTab === tab.id;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={tab.id}
                onPress={() => setSelectedTab(tab.id)}
                style={styles.tabItem}
              >
                <Text style={[styles.tabIcon, selected && styles.activeTabText]}>{tab.icon}</Text>
                <Text style={[styles.tabLabel, selected && styles.activeTabText]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  app: {
    flex: 1,
  },
  pageContent: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 26,
  },
  topBar: {
    minHeight: 54,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 35,
    height: 35,
    borderRadius: 12,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: {
    color: COLORS.surface,
    fontSize: 24,
    lineHeight: 27,
  },
  brandText: {
    color: COLORS.greenDark,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -1,
  },
  previewBadge: {
    color: COLORS.greenDark,
    backgroundColor: COLORS.greenSoft,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  greeting: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 20,
    marginBottom: 30,
  },
  greetingCopy: {
    flex: 1,
  },
  eyebrow: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  heading: {
    color: COLORS.ink,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.8,
    marginTop: 5,
  },
  mutedText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginBottom: 4,
  },
  syncDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#54ad78",
  },
  syncText: {
    color: COLORS.greenDark,
    fontSize: 10,
    fontWeight: "700",
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  sectionCaption: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 3,
  },
  textButton: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "700",
  },
  dateStrip: {
    gap: 9,
    paddingBottom: 19,
  },
  dateButton: {
    width: 61,
    height: 68,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  selectedDateButton: {
    backgroundColor: COLORS.green,
  },
  dateDay: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  dateNumber: {
    color: COLORS.ink,
    fontSize: 19,
    fontWeight: "800",
    marginTop: 3,
  },
  selectedDateText: {
    color: COLORS.surface,
  },
  nextAlarmCard: {
    minHeight: 112,
    backgroundColor: COLORS.greenDark,
    borderRadius: 23,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
    overflow: "hidden",
  },
  nextAlarmIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  nextAlarmIconText: {
    color: COLORS.surface,
    fontSize: 26,
  },
  nextAlarmCopy: {
    flex: 1,
  },
  nextAlarmLabel: {
    color: "#c5e1d3",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  nextAlarmTime: {
    color: COLORS.surface,
    fontSize: 27,
    fontWeight: "800",
    marginTop: 3,
  },
  nextAlarmTitle: {
    color: "#d8e9df",
    fontSize: 11,
    marginTop: 1,
  },
  countdown: {
    color: COLORS.surface,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: "700",
    overflow: "hidden",
  },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  refreshButtonText: {
    color: COLORS.green,
    fontSize: 25,
  },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 86,
    backgroundColor: COLORS.surface,
    borderRadius: 19,
    padding: 13,
    marginBottom: 10,
    shadowColor: "#223e30",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  eventTime: {
    width: 59,
    alignItems: "flex-start",
  },
  eventTimeText: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  eventTimeCaption: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 3,
  },
  eventDivider: {
    width: 3,
    height: 47,
    borderRadius: 2,
    marginRight: 12,
  },
  eventInfo: {
    flex: 1,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
  },
  eventTitle: {
    color: COLORS.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  alarmChip: {
    color: COLORS.greenDark,
    backgroundColor: COLORS.greenSoft,
    borderRadius: 11,
    paddingHorizontal: 7,
    paddingVertical: 4,
    fontSize: 9,
    fontWeight: "700",
    overflow: "hidden",
  },
  eventLocation: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 6,
  },
  demoNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
    marginBottom: 15,
  },
  demoNoticeIcon: {
    color: COLORS.green,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.greenSoft,
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  demoNoticeText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  actionButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: COLORS.green,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  actionButtonText: {
    color: COLORS.surface,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButton: {
    backgroundColor: COLORS.greenSoft,
  },
  secondaryButtonText: {
    color: COLORS.greenDark,
  },
  disabledButton: {
    opacity: 0.55,
  },
  pressedButton: {
    opacity: 0.8,
  },
  emptyCard: {
    borderRadius: 19,
    padding: 20,
    backgroundColor: COLORS.surface,
    marginTop: 4,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  pageHeading: {
    marginTop: 22,
    marginBottom: 22,
  },
  alarmDateHeading: {
    color: COLORS.greenDark,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 8,
    textTransform: "capitalize",
  },
  smallNote: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
  },
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 17,
    marginBottom: 15,
  },
  settingsTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 3,
  },
  inputLabel: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 9,
  },
  presetList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetButton: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  selectedPreset: {
    borderColor: COLORS.green,
    backgroundColor: COLORS.greenSoft,
  },
  presetText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  selectedPresetText: {
    color: COLORS.greenDark,
  },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  customInput: {
    width: 80,
    height: 43,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: COLORS.ink,
    fontSize: 15,
  },
  statusMessage: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 14,
    paddingHorizontal: 5,
  },
  tabBar: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
  },
  tabItem: {
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 7,
  },
  tabIcon: {
    color: COLORS.muted,
    fontSize: 19,
    height: 23,
  },
  tabLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "600",
  },
  activeTabText: {
    color: COLORS.green,
    fontWeight: "800",
  },
});
