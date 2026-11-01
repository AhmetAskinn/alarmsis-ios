import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
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
import * as Calendar from "expo-calendar";
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
  orange: "#e9975a",
  red: "#d9534f",
};

const PRESETS = [5, 10, 15, 30, 60];

// Bildirim işleyicisi (uygulama açıkken de ses ve banner çalar)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function formatTime(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatLongDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
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

// Saat (Clock) uygulamasını açma yardımcısı
async function openAppleClockApp() {
  const clockUrls = ["clock-alarm://", "clock://"];
  for (const url of clockUrls) {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      // devam et
    }
  }
  // Alternatif olarak Saat'i açamazsa sistem bildirim uyarısı
  Alert.alert(
    "Saat Uygulaması",
    "iPhone Saat uygulamasını açmak için ana ekranınızdaki 'Saat' simgesine dokunun.",
  );
  return false;
}

function ActionButton({ label, onPress, disabled, secondary = false, icon = null }) {
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
      <View style={styles.actionButtonContent}>
        {icon ? <Text style={styles.actionButtonIcon}>{icon}</Text> : null}
        <Text style={[styles.actionButtonText, secondary && styles.secondaryButtonText]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function EventCard({ event, alarmEnabled, compact = false, onSetClockAlarm }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTime}>
        <Text style={styles.eventTimeText}>
          {compact ? formatTime(event.alarmDate) : formatTime(event.startDate)}
        </Text>
        <Text style={styles.eventTimeCaption}>
          {compact ? "alarm saati" : "etkinlik saati"}
        </Text>
      </View>
      <View
        style={[
          styles.eventDivider,
          { backgroundColor: event.color || COLORS.green },
        ]}
      />
      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {event.title}
          </Text>
          {alarmEnabled ? (
            <Text style={styles.alarmChip}>
              {compact ? `Etkinlik ${formatTime(event.startDate)}` : `⏰ ${formatTime(event.alarmDate)}`}
            </Text>
          ) : null}
        </View>
        <Text style={styles.eventLocation} numberOfLines={1}>
          {event.location ? `${event.location} · ` : ""}
          {event.calendarTitle || "iPhone Takvimi"}
        </Text>

        {onSetClockAlarm ? (
          <Pressable
            onPress={() => onSetClockAlarm(event)}
            style={({ pressed }) => [
              styles.clockButton,
              pressed && styles.pressedButton,
            ]}
          >
            <Text style={styles.clockButtonIcon}>⏰</Text>
            <Text style={styles.clockButtonText}>
              Saat Uygulamasında Kur ({formatTime(event.alarmDate)})
            </Text>
          </Pressable>
        ) : null}
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
  const [calendarPermission, setCalendarPermission] = useState("undetermined");
  const [realEvents, setRealEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Takvim kontrol ediliyor...");

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, offset) => dateForOffset(offset)),
    [],
  );

  // İzinleri ve takvim etkinliklerini yükleme
  const loadCalendarEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      setCalendarPermission(status);

      if (status !== "granted") {
        setStatusMessage(
          "⚠️ iPhone Takvim izni verilmedi. Ayarlar > Expo Go üzerinden Takvim iznini açabilirsiniz.",
        );
        setIsLoading(false);
        return;
      }

      // Kullanıcının takvimlerini al
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const calendarIds = calendars.map((cal) => cal.id);

      if (calendarIds.length === 0) {
        setRealEvents([]);
        setStatusMessage("iPhone'da takvim bulunamadı.");
        setIsLoading(false);
        return;
      }

      // Bugünden itibaren 7 günlük etkinlikleri çek
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 7);
      endDate.setHours(23, 59, 59, 999);

      const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);

      // Takvim adı ve renk eşleştirmesi
      const calMap = new Map();
      calendars.forEach((c) => calMap.set(c.id, { title: c.title, color: c.color }));

      const mappedEvents = events
        .map((evt) => {
          const calInfo = calMap.get(evt.calendarId) || {};
          const sDate = new Date(evt.startDate);
          const eDate = new Date(evt.endDate);
          return {
            id: evt.id,
            title: evt.title || "İsimsiz Etkinlik",
            location: evt.location || "",
            startDate: sDate,
            endDate: eDate,
            calendarTitle: calInfo.title || "Apple Takvim",
            color: calInfo.color || COLORS.green,
            alarmDate: new Date(sDate.getTime() - alarmMinutes * 60_000),
          };
        })
        .filter((evt) => evt.startDate > new Date())
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

      setRealEvents(mappedEvents);
      setStatusMessage(
        `✓ iPhone Takviminden ${mappedEvents.length} yaklaşan etkinlik yüklendi.`,
      );
    } catch (error) {
      console.warn("Takvim yükleme hatası:", error);
      setStatusMessage(
        `Takvim okunamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [alarmMinutes]);

  useEffect(() => {
    loadCalendarEvents();
  }, [loadCalendarEvents]);

  // Seçilen güne ait etkinlikler
  const selectedEvents = useMemo(() => {
    const targetDate = days[selectedDay];
    if (!targetDate) return [];
    return realEvents
      .filter((event) => {
        const eDate = event.startDate;
        return (
          eDate.getDate() === targetDate.getDate() &&
          eDate.getMonth() === targetDate.getMonth() &&
          eDate.getFullYear() === targetDate.getFullYear()
        );
      })
      .map((event) => ({
        ...event,
        alarmDate: new Date(event.startDate.getTime() - alarmMinutes * 60_000),
      }));
  }, [realEvents, selectedDay, days, alarmMinutes]);

  const upcomingEvents = useMemo(() => {
    return realEvents.map((event) => ({
      ...event,
      alarmDate: new Date(event.startDate.getTime() - alarmMinutes * 60_000),
    }));
  }, [realEvents, alarmMinutes]);

  const nextEvent = upcomingEvents[0];
  const scheduledEvents = upcomingEvents.filter((event) =>
    scheduledEventIDs.includes(event.id),
  );
  const selectedPreset =
    !isCustomAlarmTime && PRESETS.includes(alarmMinutes) ? alarmMinutes : null;

  async function ensureNotificationPermission() {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Etkinlik Alarmları",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 500, 250, 500],
      });
    }

    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") return true;

    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return requested.status === "granted";
  }

  // Tüm etkinlikler için alarm kur
  async function scheduleAlarms(minutes = alarmMinutes) {
    setIsLoading(true);
    try {
      const permissionGranted = await ensureNotificationPermission();
      if (!permissionGranted) {
        setStatusMessage(
          "Bildirim izni verilmedi. iPhone Ayarları'ndan izin verebilirsiniz.",
        );
        return false;
      }

      // Eski alarmları temizle
      await Notifications.cancelAllScheduledNotificationsAsync();

      const now = Date.now();
      const eligibleEvents = upcomingEvents.filter(
        (event) => event.startDate.getTime() - now >= minutes * 60_000,
      );
      const eventsToSchedule = eligibleEvents.slice(0, 64);

      for (const event of eventsToSchedule) {
        const triggerDate = new Date(event.startDate.getTime() - minutes * 60_000);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `⏰ ${minutes} dk sonra: ${event.title}`,
            body: `${formatTime(event.startDate)}'daki etkinliğiniz için alarm.`,
            sound: "default",
            data: { eventId: event.id, title: event.title },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
      }

      setAlarmsEnabled(true);
      setScheduledEventIDs(eventsToSchedule.map((event) => event.id));
      setStatusMessage(
        `✓ ${eventsToSchedule.length} etkinlik için ${minutes} dakika öncesine alarmlar kuruldu!`,
      );
      return true;
    } catch (error) {
      setAlarmsEnabled(false);
      setStatusMessage(
        `Alarmlar planlanamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  // Belirli bir etkinlik için Saat uygulamasında alarm kurma
  async function handleSetClockAlarm(event) {
    const alarmTime = new Date(event.startDate.getTime() - alarmMinutes * 60_000);
    const timeStr = formatTime(alarmTime);

    Alert.alert(
      "Saat Uygulamasında Alarm Kur",
      `"${event.title}" etkinliği için alarm saati:\n\n⏰ ${timeStr} (${alarmMinutes} dk önce)\n\nŞimdi Saat uygulaması açılacak.`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Saat Uygulamasını Aç",
          onPress: async () => {
            await openAppleClockApp();
          },
        },
      ],
    );
  }

  // Test bildirimi (5 saniye sonra)
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
          title: "⏰ Alarm Çalıyor: Test Etkinliği",
          body: `${alarmMinutes} dakika sonra etkinliğiniz başlayacak!`,
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
        },
      });
      setStatusMessage("✓ Test alarmı 5 saniye sonrasına kuruldu! Ekranı kilitleyip dinleyin.");
    } catch (error) {
      setStatusMessage(
        `Test alarmı kurulamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function saveAlarmTime() {
    Keyboard.dismiss();
    const value = Number(customMinutes);
    if (!Number.isInteger(value) || value < 1 || value > 1_440) {
      setStatusMessage("Özel süre 1 ile 1440 dakika arasında olmalıdır.");
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
            <Text style={styles.eyebrow}>
              {formatLongDate(new Date()).toLocaleUpperCase("tr-TR")}
            </Text>
            <Text style={styles.heading}>iPhone Takvimin</Text>
            <Text style={styles.mutedText}>
              Etkinliklerinden {alarmMinutes} dakika önce otomatik alarm çalar.
            </Text>
          </View>
          <View style={styles.syncPill}>
            <View
              style={[
                styles.syncDot,
                {
                  backgroundColor:
                    calendarPermission === "granted" ? "#54ad78" : COLORS.orange,
                },
              ]}
            />
            <Text style={styles.syncText}>
              {calendarPermission === "granted" ? "Bağlandı" : "İzin Bekleniyor"}
            </Text>
          </View>
        </View>

        {calendarPermission !== "granted" ? (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>📅 Takvim Erişimi Gerekli</Text>
            <Text style={styles.permissionText}>
              iPhone Takviminizdeki etkinlikleri okumak ve alarm kurabilmek için lütfen erişim izni verin.
            </Text>
            <ActionButton
              label="Takvim İzni Ver / Yenile"
              onPress={loadCalendarEvents}
            />
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Tarih Seçimi</Text>
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
                <Text style={[styles.dateDay, selected && styles.selectedDateText]}>
                  {dayText}
                </Text>
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
              <Text style={styles.nextAlarmIconText}>⏰</Text>
            </View>
            <View style={styles.nextAlarmCopy}>
              <Text style={styles.nextAlarmLabel}>SIRADAKİ ALARM SAATİ</Text>
              <Text style={styles.nextAlarmTime}>
                {formatTime(nextEvent.alarmDate)}
              </Text>
              <Text style={styles.nextAlarmTitle} numberOfLines={1}>
                "{nextEvent.title}" için ({alarmMinutes} dk önce)
              </Text>
            </View>
            <Pressable
              onPress={() => handleSetClockAlarm(nextEvent)}
              style={styles.countdownButton}
            >
              <Text style={styles.countdown}>Saat'te Kur ›</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>
              {selectedDay === 0 ? "Bugünkü Etkinlikler" : formatLongDate(days[selectedDay])}
            </Text>
            <Text style={styles.sectionCaption}>
              {selectedEvents.length} etkinlik bulundu
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Takvimi yenile"
            onPress={loadCalendarEvents}
            style={styles.refreshButton}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={COLORS.green} />
            ) : (
              <Text style={styles.refreshButtonText}>↻</Text>
            )}
          </Pressable>
        </View>

        {selectedEvents.length > 0 ? (
          selectedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              alarmEnabled={alarmsEnabled && scheduledEventIDs.includes(event.id)}
              onSetClockAlarm={handleSetClockAlarm}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Etkinlik Bulunamadı</Text>
            <Text style={styles.mutedText}>
              Seçilen tarihte Apple Takviminizde herhangi bir etkinlik görünmüyor.
            </Text>
          </View>
        )}

        <View style={{ marginTop: 14 }}>
          <ActionButton
            disabled={isLoading || upcomingEvents.length === 0}
            icon="🔔"
            label={
              isLoading
                ? "Alarmlar kuruluyor..."
                : `Tüm Etkinliklere Alarm Kur (${alarmMinutes} dk önce)`
            }
            onPress={() => scheduleAlarms()}
          />

          <ActionButton
            icon="⏰"
            label="iPhone Saat Uygulamasını Aç"
            onPress={openAppleClockApp}
            secondary
          />
        </View>
      </>
    );
  }

  function renderAlarms() {
    return (
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.heading}>Kurulu Alarmlar</Text>
          <Text style={styles.mutedText}>
            iPhone Takviminize göre belirlenen alarmlar
          </Text>
        </View>
        {scheduledEvents.length > 0 ? (
          scheduledEvents.map((event, index) => (
            <View key={event.id}>
              {index === 0 ||
              scheduledEvents[index - 1].startDate.toDateString() !==
                event.startDate.toDateString() ? (
                <Text style={styles.alarmDateHeading}>
                  {formatLongDate(event.startDate)}
                </Text>
              ) : null}
              <EventCard
                event={event}
                alarmEnabled
                compact
                onSetClockAlarm={handleSetClockAlarm}
              />
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Aktif alarm bulunmuyor</Text>
            <Text style={styles.mutedText}>
              Takvim sekmesinden "Tüm Etkinliklere Alarm Kur" butonuna basarak alarmları başlatabilirsiniz.
            </Text>
          </View>
        )}
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.heading}>Ayarlar</Text>
          <Text style={styles.mutedText}>Alarm zamanlaması ve Saat entegrasyonu</Text>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>⏰ Kaç Dakika Önce Çalsın?</Text>
          <Text style={styles.mutedText}>
            Etkinliğin başlamasına kaç dakika kala alarm çalacağını seçin:
          </Text>

          <View style={styles.presetList}>
            {PRESETS.map((value) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selectedPreset === value }}
                key={value}
                onPress={() => choosePreset(value)}
                style={[
                  styles.presetButton,
                  selectedPreset === value && styles.selectedPreset,
                ]}
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
              style={[
                styles.presetButton,
                selectedPreset === null && styles.selectedPreset,
              ]}
            >
              <Text
                style={[
                  styles.presetText,
                  selectedPreset === null && styles.selectedPresetText,
                ]}
              >
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

          <ActionButton label="Seçimi Kaydet" onPress={saveAlarmTime} />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🧪 Test Alarmı</Text>
          <Text style={styles.mutedText}>
            iPhone'unuzda sesli alarm ve bildirimin nasıl çaldığını 5 saniye içinde test edin.
          </Text>
          <ActionButton
            disabled={isLoading}
            label={isLoading ? "Hazırlanıyor..." : "5 Saniye Sonra Çaldır"}
            onPress={scheduleTestNotification}
            secondary
          />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>📱 iPhone Saat (Clock) Entegrasyonu</Text>
          <Text style={styles.mutedText}>
            Apple gizlilik ilkeleri nedeniyle üçüncü parti uygulamaların Saat uygulamasının içerisine doğrudan gizlice alarm yazmasına izin vermez. Bu yüzden Alertify:
            {"\n"}• Belirlenen dakikada yüksek sesli yerel alarm çalar.
            {"\n"}• İsterseniz "Saat'te Kur" butonuna basarak Saat uygulamasında doğrudan alarm açmanızı sağlar.
          </Text>
          <ActionButton
            icon="⏰"
            label="Saat Uygulamasına Git"
            onPress={openAppleClockApp}
            secondary
          />
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
              <Text style={styles.brandMarkText}>⏰</Text>
            </View>
            <Text style={styles.brandText}>Alertify</Text>
          </View>
          <Text style={styles.previewBadge}>
            {calendarPermission === "granted" ? "iCloud Takvim" : "Bağlantısız"}
          </Text>
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
            { id: "calendar", label: "Takvim", icon: "📅" },
            { id: "alarms", label: "Alarmlar", icon: "⏰" },
            { id: "settings", label: "Ayarlar", icon: "⚙️" },
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
                <Text style={[styles.tabIcon, selected && styles.activeTabText]}>
                  {tab.icon}
                </Text>
                <Text style={[styles.tabLabel, selected && styles.activeTabText]}>
                  {tab.label}
                </Text>
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 26,
  },
  topBar: {
    minHeight: 50,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.green,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkText: {
    fontSize: 18,
  },
  brandText: {
    color: COLORS.greenDark,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  previewBadge: {
    color: COLORS.greenDark,
    backgroundColor: COLORS.greenSoft,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: "700",
  },
  greeting: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 14,
    marginBottom: 20,
  },
  greetingCopy: {
    flex: 1,
  },
  eyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  heading: {
    color: COLORS.ink,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 3,
  },
  mutedText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  syncDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  syncText: {
    color: COLORS.greenDark,
    fontSize: 10,
    fontWeight: "700",
  },
  permissionCard: {
    backgroundColor: "#fff9ea",
    borderWidth: 1,
    borderColor: "#ffe39f",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  permissionTitle: {
    color: "#8a5800",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  permissionText: {
    color: "#6b4a0c",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    marginTop: 8,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  sectionCaption: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  textButton: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: "700",
  },
  dateStrip: {
    gap: 8,
    paddingBottom: 16,
  },
  dateButton: {
    width: 60,
    height: 66,
    borderRadius: 16,
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
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  selectedDateText: {
    color: COLORS.surface,
  },
  nextAlarmCard: {
    minHeight: 100,
    backgroundColor: COLORS.greenDark,
    borderRadius: 20,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  nextAlarmIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  nextAlarmIconText: {
    fontSize: 20,
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
    fontSize: 24,
    fontWeight: "800",
    marginTop: 2,
  },
  nextAlarmTitle: {
    color: "#d8e9df",
    fontSize: 11,
    marginTop: 1,
  },
  countdownButton: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 16,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  countdown: {
    color: COLORS.surface,
    fontSize: 11,
    fontWeight: "700",
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  refreshButtonText: {
    color: COLORS.green,
    fontSize: 22,
  },
  eventCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: COLORS.surface,
    borderRadius: 17,
    padding: 13,
    marginBottom: 9,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  eventTime: {
    width: 58,
    alignItems: "flex-start",
    paddingTop: 2,
  },
  eventTimeText: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  eventTimeCaption: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 2,
  },
  eventDivider: {
    width: 3,
    height: "100%",
    minHeight: 48,
    borderRadius: 2,
    marginRight: 11,
  },
  eventInfo: {
    flex: 1,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  eventTitle: {
    color: COLORS.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  alarmChip: {
    color: COLORS.greenDark,
    backgroundColor: COLORS.greenSoft,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
    fontSize: 9,
    fontWeight: "700",
  },
  eventLocation: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 3,
  },
  clockButton: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fff6eb",
    borderWidth: 1,
    borderColor: "#ffe0b2",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  clockButtonIcon: {
    fontSize: 12,
  },
  clockButtonText: {
    color: "#b25e00",
    fontSize: 11,
    fontWeight: "700",
  },
  actionButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: COLORS.green,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 8,
  },
  actionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionButtonIcon: {
    fontSize: 15,
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
    opacity: 0.75,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 18,
    backgroundColor: COLORS.surface,
    marginTop: 4,
  },
  emptyTitle: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  pageHeading: {
    marginTop: 18,
    marginBottom: 18,
  },
  alarmDateHeading: {
    color: COLORS.greenDark,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 6,
    textTransform: "capitalize",
  },
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  settingsTitle: {
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 3,
  },
  presetList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  presetButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    marginTop: 12,
  },
  customInput: {
    width: 76,
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 11,
    paddingHorizontal: 10,
    color: COLORS.ink,
    fontSize: 14,
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
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.line,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
  },
  tabItem: {
    minWidth: 70,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 6,
  },
  tabIcon: {
    fontSize: 18,
    height: 22,
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
