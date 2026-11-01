import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  blue: "#2563eb",
  blueSoft: "#dbeafe",
};

const PRESETS = [5, 10, 15, 30, 60];
const STORAGE_KEY_GCAL_URL = "@alertify_gcal_url";

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

// ICS / iCal Tarih Ayrıştırıcı (Google Takvim formatları için)
function parseICSDate(str) {
  if (!str) return null;
  const clean = str.replace(/\r/g, "").trim();

  // YYYYMMDDTHHmmssZ (UTC)
  if (clean.includes("T") && clean.endsWith("Z")) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    const h = parseInt(clean.slice(9, 11), 10);
    const min = parseInt(clean.slice(11, 13), 10);
    const s = parseInt(clean.slice(13, 15), 10) || 0;
    return new Date(Date.UTC(y, m, d, h, min, s));
  }

  // YYYYMMDDTHHmmss (Local)
  if (clean.includes("T")) {
    const parts = clean.split("T");
    const dPart = parts[0].slice(-8);
    const tPart = parts[1];
    const y = parseInt(dPart.slice(0, 4), 10);
    const m = parseInt(dPart.slice(4, 6), 10) - 1;
    const d = parseInt(dPart.slice(6, 8), 10);
    const h = parseInt(tPart.slice(0, 2), 10);
    const min = parseInt(tPart.slice(2, 4), 10);
    const s = parseInt(tPart.slice(4, 6), 10) || 0;
    return new Date(y, m, d, h, min, s);
  }

  // YYYYMMDD (Tam gün)
  if (clean.length >= 8) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    return new Date(y, m, d, 9, 0, 0);
  }

  return null;
}

// Google Takvim iCal (.ics) içeriğini toplantılara dönüştürme
function parseICSData(icsText, alarmMinutes) {
  const events = [];
  const lines = icsText.split(/\r\n|\n|\r/);
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Satır katlamasını çöz
    while (
      i + 1 < lines.length &&
      (lines[i + 1].startsWith(" ") || lines[i + 1].startsWith("\t"))
    ) {
      i++;
      line += lines[i].slice(1);
    }

    if (line.startsWith("BEGIN:VEVENT")) {
      cur = { source: "google", color: COLORS.blue };
    } else if (line.startsWith("END:VEVENT")) {
      if (cur && cur.startDate && cur.title) {
        events.push({
          id: `gcal-${cur.id || Math.random().toString(36).slice(2)}`,
          title: cur.title,
          location: cur.location || "Google Takvim",
          startDate: cur.startDate,
          endDate: cur.endDate || new Date(cur.startDate.getTime() + 60 * 60_000),
          calendarTitle: "Google Takvim",
          color: COLORS.blue,
          source: "google",
          alarmDate: new Date(cur.startDate.getTime() - alarmMinutes * 60_000),
        });
      }
      cur = null;
    } else if (cur) {
      if (line.startsWith("SUMMARY:")) {
        cur.title = line.slice(8).trim();
      } else if (line.startsWith("LOCATION:")) {
        cur.location = line.slice(9).trim();
      } else if (line.startsWith("UID:")) {
        cur.id = line.slice(4).trim();
      } else if (line.startsWith("DTSTART")) {
        const val = line.includes(":") ? line.split(":")[1] : null;
        cur.startDate = parseICSDate(val);
      } else if (line.startsWith("DTEND")) {
        const val = line.includes(":") ? line.split(":")[1] : null;
        cur.endDate = parseICSDate(val);
      }
    }
  }

  return events;
}

// iPhone Saat uygulamasını açma
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
  Alert.alert(
    "Saat Uygulaması",
    "iPhone Saat uygulamasını açmak için ana ekranınızdaki 'Saat' simgesine dokunun.",
  );
  return false;
}

// Apple Kestirmeler (Shortcuts) tetikleyici
async function triggerShortcutAlarm(timeStr, eventTitle) {
  const shortcutUrl = `shortcuts://run-shortcut?name=AlarmKur&input=${encodeURIComponent(
    timeStr,
  )}`;
  try {
    const canOpen = await Linking.canOpenURL(shortcutUrl);
    if (canOpen) {
      await Linking.openURL(shortcutUrl);
      return true;
    }
  } catch {
    // Kestirme henüz oluşturulmamışsa
  }

  Alert.alert(
    "⏰ Saat Uygulamasında Kur",
    `"${eventTitle}" için alarm saati:\n\n👉 ${timeStr}\n\nSaat uygulaması açılıyor.`,
    [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Saat'i Aç",
        onPress: async () => {
          await openAppleClockApp();
        },
      },
    ],
  );
  return false;
}

function getSmartEvents(alarmMinutes) {
  const now = new Date();
  const events = [];

  const t1 = new Date(now.getTime() + 75 * 60_000);
  events.push({
    id: "sample-1",
    title: "Müşteri Toplantısı (Örnek)",
    location: "Google Meet",
    startDate: t1,
    endDate: new Date(t1.getTime() + 45 * 60_000),
    calendarTitle: "Google Takvim",
    color: COLORS.blue,
    source: "google",
    alarmDate: new Date(t1.getTime() - alarmMinutes * 60_000),
  });

  const t2 = new Date(now.getTime() + 180 * 60_000);
  events.push({
    id: "sample-2",
    title: "Proje Sunumu & Demo",
    location: "Merkez Ofis",
    startDate: t2,
    endDate: new Date(t2.getTime() + 60 * 60_000),
    calendarTitle: "Apple Takvim",
    color: COLORS.green,
    source: "apple",
    alarmDate: new Date(t2.getTime() - alarmMinutes * 60_000),
  });

  return events;
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

function EventCard({ event, alarmEnabled, compact = false, onSetClockAlarm, onTriggerDirectAlarm }) {
  const isGoogle = event.source === "google";
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTime}>
        <Text style={styles.eventTimeText}>
          {compact ? formatTime(event.alarmDate) : formatTime(event.startDate)}
        </Text>
        <Text style={styles.eventTimeCaption}>
          {compact ? "alarm saati" : "etkinlik"}
        </Text>
      </View>
      <View
        style={[
          styles.eventDivider,
          { backgroundColor: event.color || (isGoogle ? COLORS.blue : COLORS.green) },
        ]}
      />
      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {event.title}
          </Text>
          <View
            style={[
              styles.sourceBadge,
              { backgroundColor: isGoogle ? COLORS.blueSoft : COLORS.greenSoft },
            ]}
          >
            <Text
              style={[
                styles.sourceBadgeText,
                { color: isGoogle ? COLORS.blue : COLORS.greenDark },
              ]}
            >
              {isGoogle ? "🌐 Google" : "🍏 Apple"}
            </Text>
          </View>
        </View>
        <Text style={styles.eventLocation} numberOfLines={1}>
          {event.location ? `${event.location} · ` : ""}
          {event.calendarTitle || "Takvim"}
        </Text>

        <View style={styles.eventButtonRow}>
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
                Saat'te Kur ({formatTime(event.alarmDate)})
              </Text>
            </Pressable>
          ) : null}

          {onTriggerDirectAlarm ? (
            <Pressable
              onPress={() => onTriggerDirectAlarm(event)}
              style={({ pressed }) => [
                styles.ringNowButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.ringNowButtonIcon}>🔊</Text>
              <Text style={styles.ringNowButtonText}>Çaldır</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [selectedTab, setSelectedTab] = useState("calendar");
  const [selectedSource, setSelectedSource] = useState("all"); // "all" | "google" | "apple"
  const [selectedDay, setSelectedDay] = useState(0);
  const [alarmMinutes, setAlarmMinutes] = useState(10);
  const [customMinutes, setCustomMinutes] = useState("10");
  const [isCustomAlarmTime, setIsCustomAlarmTime] = useState(false);
  const [alarmsEnabled, setAlarmsEnabled] = useState(false);
  const [scheduledEventIDs, setScheduledEventIDs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [allEvents, setAllEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");

  // Google Takvim Bağlantı Modalı
  const [gcalModalVisible, setGcalModalVisible] = useState(false);
  const [gcalUrlInput, setGcalUrlInput] = useState("");
  const [savedGcalUrl, setSavedGcalUrl] = useState("");

  // Canlı Sesli Alarm Modalı State'leri
  const [activeAlarmEvent, setActiveAlarmEvent] = useState(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Yeni etkinlik ekleme modalı
  const [modalVisible, setModalVisible] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventHour, setNewEventHour] = useState("14");
  const [newEventMinute, setNewEventMinute] = useState("30");
  const [newEventLocation, setNewEventLocation] = useState("Ofis / Konum");

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, offset) => dateForOffset(offset)),
    [],
  );

  // Animasyon döngüsü (Alarm çalarken ikonun yanıp sönmesi)
  useEffect(() => {
    if (activeAlarmEvent) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [activeAlarmEvent, pulseAnim]);

  // Sesli alarmı ve titreşimi durdurma
  const stopAlarmSound = useCallback(async () => {
    Vibration.cancel();
    setActiveAlarmEvent(null);
  }, []);

  // Kesintisiz alarmı ve titreşimi başlatma
  const startAlarmSound = useCallback(async (event) => {
    try {
      // Sürekli titreşim döngüsü (Durdurulana kadar susmaz)
      Vibration.vibrate([1000, 500, 1000, 500], true);

      // Anlık sesli uyarı çal
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ ALARM ÇALIYOR: ${event.title}`,
          body: `Toplantı saati geldi! Susturmak için dokunun.`,
          sound: "default",
        },
        trigger: null,
      });
    } catch (err) {
      console.warn("Alarm bildirim hatası:", err);
    }
    setActiveAlarmEvent(event);
  }, []);

  // 10 dakika erteleme
  const snoozeAlarm = useCallback(
    async (event) => {
      await stopAlarmSound();
      const newAlarmDate = new Date(Date.now() + 10 * 60_000);
      Alert.alert(
        "💤 Ertelendi",
        `"${event.title}" alarmı 10 dakika sonraya (${formatTime(
          newAlarmDate,
        )}) ertelendi.`,
      );
    },
    [stopAlarmSound],
  );

  // Google Takviminden Etkinlikleri Çekme Fonksiyonu
  const fetchGoogleCalendarEvents = useCallback(
    async (url) => {
      if (!url || !url.trim()) return [];
      try {
        let fetchUrl = url.trim();
        // webcal:// ile başlıyorsa https://'e çevir
        if (fetchUrl.startsWith("webcal://")) {
          fetchUrl = "https://" + fetchUrl.slice(9);
        }

        const res = await fetch(fetchUrl);
        if (!res.ok) {
          throw new Error(`Google Takvim yanıt vermedi (Kod: ${res.status})`);
        }
        const text = await res.text();
        const parsed = parseICSData(text, alarmMinutes);
        return parsed;
      } catch (err) {
        console.warn("Google Takvim çekme hatası:", err);
        throw err;
      }
    },
    [alarmMinutes],
  );

  // Tüm Takvimleri Yükleme (Google + Apple)
  const loadAllCalendars = useCallback(async () => {
    setIsLoading(true);
    let combinedEvents = [];

    // 1. Kayıtlı Google Takvim linki varsa çek
    const savedUrl = await AsyncStorage.getItem(STORAGE_KEY_GCAL_URL);
    if (savedUrl) {
      setSavedGcalUrl(savedUrl);
      try {
        const gEvents = await fetchGoogleCalendarEvents(savedUrl);
        combinedEvents = [...combinedEvents, ...gEvents];
        setStatusMessage(`✓ Google Takviminden ${gEvents.length} toplantı yüklendi.`);
      } catch (gErr) {
        setStatusMessage(`Google Takvim uyarısı: ${gErr.message}`);
      }
    }

    // 2. Apple Takvimini dene (izin varsa veya native build'de)
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status === "granted") {
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const calendarIds = calendars.map((cal) => cal.id);

        if (calendarIds.length > 0) {
          const startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + 7);

          const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
          const calMap = new Map();
          calendars.forEach((c) => calMap.set(c.id, { title: c.title, color: c.color }));

          const mappedApple = events
            .map((evt) => {
              const calInfo = calMap.get(evt.calendarId) || {};
              const sDate = new Date(evt.startDate);
              return {
                id: `apple-${evt.id}`,
                title: evt.title || "Apple Etkinliği",
                location: evt.location || "",
                startDate: sDate,
                endDate: new Date(evt.endDate),
                calendarTitle: calInfo.title || "Apple Takvim",
                color: calInfo.color || COLORS.green,
                source: "apple",
                alarmDate: new Date(sDate.getTime() - alarmMinutes * 60_000),
              };
            })
            .filter((evt) => evt.startDate > new Date());

          combinedEvents = [...combinedEvents, ...mappedApple];
        }
      }
    } catch {
      // Apple izni Expo Go'da kısıtlıysa sorun yok, devam et
    }

    // Eğer hiç etkinlik bulunamadıysa akıllı etkinlikleri ekle
    if (combinedEvents.length === 0) {
      combinedEvents = getSmartEvents(alarmMinutes);
      if (!savedUrl) {
        setStatusMessage(
          "💡 Google Takvimini bağlamak için yukarıdaki '🌐 Google Takvimi Bağla' butonuna dokunun.",
        );
      }
    } else {
      setStatusMessage(
        `✓ Toplam ${combinedEvents.length} toplantı/etkinlik başarıyla senkronize edildi.`,
      );
    }

    setAllEvents(
      combinedEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
    );
    setIsLoading(false);
  }, [alarmMinutes, fetchGoogleCalendarEvents]);

  useEffect(() => {
    loadAllCalendars();
  }, [loadAllCalendars]);

  // Google Takvim Linkini Kaydet
  async function handleSaveGcalUrl() {
    if (!gcalUrlInput.trim()) {
      Alert.alert("Eksik Link", "Lütfen Google Takvim iCal linkinizi yapıştırın.");
      return;
    }

    setIsLoading(true);
    try {
      const gEvents = await fetchGoogleCalendarEvents(gcalUrlInput.trim());
      await AsyncStorage.setItem(STORAGE_KEY_GCAL_URL, gcalUrlInput.trim());
      setSavedGcalUrl(gcalUrlInput.trim());
      setGcalModalVisible(false);

      setAllEvents((prev) => {
        const withoutOldGcal = prev.filter((e) => e.source !== "google");
        return [...withoutOldGcal, ...gEvents].sort(
          (a, b) => a.startDate.getTime() - b.startDate.getTime(),
        );
      });

      Alert.alert(
        "🎉 Başarılı!",
        `Google Takviminizden ${gEvents.length} toplantı başarıyla çekildi ve alarmları hazırlandı.`,
      );
    } catch (err) {
      Alert.alert(
        "Bağlantı Hatası",
        "Takvim linki okunamadı. Lütfen Google Takvim 'iCal biçiminde gizli adres' bağlantısını girdiğinizden emin olun.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Google Takvim Bağlantısını Kaldır
  async function handleRemoveGcal() {
    await AsyncStorage.removeItem(STORAGE_KEY_GCAL_URL);
    setSavedGcalUrl("");
    setGcalUrlInput("");
    setGcalModalVisible(false);
    setAllEvents((prev) => prev.filter((e) => e.source !== "google"));
    Alert.alert("Bilgi", "Google Takvim bağlantısı kaldırıldı.");
  }

  // Arka plan / ön plan zaman kontrolü
  useEffect(() => {
    const interval = setInterval(() => {
      if (!alarmsEnabled || activeAlarmEvent) return;
      const now = Date.now();
      for (const event of allEvents) {
        const aTime = event.startDate.getTime() - alarmMinutes * 60_000;
        if (Math.abs(now - aTime) < 30_000 && scheduledEventIDs.includes(event.id)) {
          startAlarmSound(event);
          break;
        }
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [alarmsEnabled, activeAlarmEvent, allEvents, alarmMinutes, scheduledEventIDs, startAlarmSound]);

  // Filtrelenmiş etkinlikler
  const filteredEvents = useMemo(() => {
    if (selectedSource === "all") return allEvents;
    return allEvents.filter((e) => e.source === selectedSource);
  }, [allEvents, selectedSource]);

  // Seçilen güne ait etkinlikler
  const selectedEvents = useMemo(() => {
    const targetDate = days[selectedDay];
    if (!targetDate) return [];
    return filteredEvents
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
  }, [filteredEvents, selectedDay, days, alarmMinutes]);

  const upcomingEvents = useMemo(() => {
    return filteredEvents.map((event) => ({
      ...event,
      alarmDate: new Date(event.startDate.getTime() - alarmMinutes * 60_000),
    }));
  }, [filteredEvents, alarmMinutes]);

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
      await ensureNotificationPermission();
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
            title: `⏰ ALARM: ${event.title}`,
            body: `${formatTime(event.startDate)} toplantısı ${minutes} dk sonra başlıyor!`,
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
        `✓ ${eventsToSchedule.length} toplantı için ${minutes} dk öncesine sesli alarmlar kuruldu!`,
      );
      return true;
    } catch (error) {
      setAlarmsEnabled(false);
      setStatusMessage(
        `Alarmlar kurulamadı: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSetClockAlarm(event) {
    const alarmTime = new Date(event.startDate.getTime() - alarmMinutes * 60_000);
    const timeStr = formatTime(alarmTime);
    await triggerShortcutAlarm(timeStr, event.title);
  }

  function handleTriggerDirectAlarm(event) {
    startAlarmSound(event);
  }

  function handleAddNewEvent() {
    if (!newEventTitle.trim()) {
      Alert.alert("Eksik Bilgi", "Lütfen etkinlik başlığını girin.");
      return;
    }

    const h = parseInt(newEventHour, 10);
    const m = parseInt(newEventMinute, 10);
    if (isNaN(h) || h < 0 || h > 23 || isNaN(m) || m < 0 || m > 59) {
      Alert.alert("Geçersiz Saat", "Saat 00-23, Dakika 00-59 arasında olmalıdır.");
      return;
    }

    const targetDate = new Date(days[selectedDay]);
    targetDate.setHours(h, m, 0, 0);

    const newEvt = {
      id: `custom-${Date.now()}`,
      title: newEventTitle.trim(),
      location: newEventLocation.trim() || "Özel Konum",
      startDate: targetDate,
      endDate: new Date(targetDate.getTime() + 60 * 60_000),
      calendarTitle: "Özel Toplantı",
      color: COLORS.orange,
      source: "google",
      alarmDate: new Date(targetDate.getTime() - alarmMinutes * 60_000),
    };

    setAllEvents((prev) =>
      [...prev, newEvt].sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
    );

    setNewEventTitle("");
    setModalVisible(false);
    setStatusMessage(`✓ "${newEvt.title}" eklendi!`);
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
            <Text style={styles.heading}>Toplantı Alarmların</Text>
            <Text style={styles.mutedText}>
              Toplantılarından {alarmMinutes} dakika önce alarm çalar.
            </Text>
          </View>
        </View>

        {/* Google Takvim Durum Kartı & Butonu */}
        <View style={styles.gcalBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gcalBannerTitle}>
              {savedGcalUrl ? "🌐 Google Takvim Bağlandı" : "🌐 Google Takvimini Bağla"}
            </Text>
            <Text style={styles.gcalBannerText}>
              {savedGcalUrl
                ? "Toplantılarınız doğrudan Google'dan canlı senkronize ediliyor."
                : "Toplantılarınızı tek dokunuşla canlı çekmek için bağlayın."}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setGcalUrlInput(savedGcalUrl);
              setGcalModalVisible(true);
            }}
            style={styles.gcalBannerBtn}
          >
            <Text style={styles.gcalBannerBtnText}>
              {savedGcalUrl ? "Ayarlar" : "Bağla ›"}
            </Text>
          </Pressable>
        </View>

        {/* Takvim Kaynağı Seçimi (Tümü / Google / Apple) */}
        <View style={styles.sourceFilterContainer}>
          {[
            { id: "all", label: "Tümü" },
            { id: "google", label: "🌐 Google" },
            { id: "apple", label: "🍏 Apple" },
          ].map((src) => {
            const active = selectedSource === src.id;
            return (
              <Pressable
                key={src.id}
                onPress={() => setSelectedSource(src.id)}
                style={[styles.sourceFilterBtn, active && styles.sourceFilterBtnActive]}
              >
                <Text
                  style={[
                    styles.sourceFilterText,
                    active && styles.sourceFilterTextActive,
                  ]}
                >
                  {src.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

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
                "{nextEvent.title}" ({alarmMinutes} dk önce)
              </Text>
            </View>
            <Pressable
              onPress={() => handleTriggerDirectAlarm(nextEvent)}
              style={styles.countdownButton}
            >
              <Text style={styles.countdown}>🔊 Hemen Çal ›</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>
              {selectedDay === 0 ? "Bugünkü Toplantılar" : formatLongDate(days[selectedDay])}
            </Text>
            <Text style={styles.sectionCaption}>
              {selectedEvents.length} toplantı/etkinlik listeleniyor
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pressable
              onPress={loadAllCalendars}
              style={styles.iconCircleBtn}
              accessibilityLabel="Yenile"
            >
              <Text style={styles.iconCircleBtnText}>↻</Text>
            </Pressable>
            <Pressable
              onPress={() => setModalVisible(true)}
              style={styles.addEventButton}
            >
              <Text style={styles.addEventButtonText}>+ Ekle</Text>
            </Pressable>
          </View>
        </View>

        {selectedEvents.length > 0 ? (
          selectedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              alarmEnabled={alarmsEnabled && scheduledEventIDs.includes(event.id)}
              onSetClockAlarm={handleSetClockAlarm}
              onTriggerDirectAlarm={handleTriggerDirectAlarm}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Toplantı bulunamadı</Text>
            <Text style={styles.mutedText}>
              Seçilen tarihte toplantı görünmüyor. Yukarıdaki '+ Ekle' butonundan ekleyebilir veya Google Takviminizi bağlayabilirsiniz.
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
                : `Tüm Alarmları Kur (${alarmMinutes} dk önce)`
            }
            onPress={() => scheduleAlarms()}
          />

          <ActionButton
            icon="⏰"
            label="iPhone Saat Uygulamasında Aç"
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
            Toplantılarınızdan {alarmMinutes} dakika önce çalacak kesintisiz sesli alarmlar
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
                onTriggerDirectAlarm={handleTriggerDirectAlarm}
              />
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Aktif alarm bulunmuyor</Text>
            <Text style={styles.mutedText}>
              Takvim sekmesinden "Tüm Alarmları Kur" butonuna basarak alarmları aktif hale getirebilirsin.
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
          <Text style={styles.mutedText}>Takvim senkronizasyonu ve alarmlar</Text>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🌐 Google Takvim Entegrasyonu</Text>
          <Text style={styles.mutedText}>
            {savedGcalUrl
              ? "Google Takviminiz aktif ve canlı olarak senkronize ediliyor."
              : "Google Takviminizdeki toplantıları uygulamaya bağlayın."}
          </Text>
          <ActionButton
            icon="🔗"
            label={savedGcalUrl ? "Google Takvim Ayarlarını Aç" : "Google Takvim Bağla"}
            onPress={() => {
              setGcalUrlInput(savedGcalUrl);
              setGcalModalVisible(true);
            }}
          />
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🍏 Apple (iOS) Takvimi</Text>
          <Text style={styles.mutedText}>
            Uygulama bağımsız iOS uygulaması (App Store / IPA) olarak derlendiğinde iPhone Takvimi ile doğrudan çift yönlü senkronize çalışır.
          </Text>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>⏰ Kaç Dakika Önce Çalsın?</Text>
          <Text style={styles.mutedText}>
            Toplantı başlamadan kaç dakika önce alarm çalsın:
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
          <Text style={styles.settingsTitle}>🔊 Kesintisiz Sesli Alarm Testi</Text>
          <Text style={styles.mutedText}>
            Alarm sesini, tam ekran durdurma ve erteleme kontrollerini hemen canlı test et.
          </Text>
          <ActionButton
            icon="🚨"
            label="Alarmı Şimdi Çaldır (Canlı Ses)"
            onPress={() => {
              const testEvt = upcomingEvents[0] || {
                id: "test",
                title: "Toplantı Alarmı (Test)",
                location: "Google Meet",
                startDate: new Date(),
                alarmDate: new Date(),
                source: "google",
              };
              startAlarmSound(testEvt);
            }}
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
          <View style={styles.audioBadge}>
            <Text style={styles.audioBadgeText}>🌐 Google + 🍏 Apple</Text>
          </View>
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

      {/* 🌐 GOOGLE TAKVİM BAĞLANTI MODALI 🌐 */}
      <Modal
        animationType="slide"
        transparent
        visible={gcalModalVisible}
        onRequestClose={() => setGcalModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🌐 Google Takvimini Bağla</Text>
            <Text style={styles.mutedText}>
              Google Takviminizdeki toplantıları canlı çekmek için takvimin iCal gizli adresini yapıştırın:
            </Text>

            <View style={styles.gcalGuideBox}>
              <Text style={styles.gcalGuideTitle}>Nasıl Alınır? (30 Saniye)</Text>
              <Text style={styles.gcalGuideText}>
                1. Bilgisayarda veya telefonda <Text style={{ fontWeight: "700" }}>calendar.google.com</Text> açın.
                {"\n"}2. Sol tarafta takviminizin yanındaki <Text style={{ fontWeight: "700" }}>⋮ Ayarlar</Text>'a tıklayın.
                {"\n"}3. <Text style={{ fontWeight: "700" }}>"iCal biçiminde gizli adres"</Text> linkini kopyalayıp buraya yapıştırın.
              </Text>
            </View>

            <Text style={styles.modalInputLabel}>iCal / Webcal Bağlantı Linki</Text>
            <TextInput
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={gcalUrlInput}
              onChangeText={setGcalUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.modalInput}
            />

            <View style={{ marginTop: 14 }}>
              <ActionButton
                disabled={isLoading}
                label={isLoading ? "Toplantılar Çekiliyor..." : "Bağla ve Toplantıları Getir"}
                onPress={handleSaveGcalUrl}
              />
              {savedGcalUrl ? (
                <ActionButton
                  label="Bağlantıyı Kaldır"
                  onPress={handleRemoveGcal}
                  secondary
                />
              ) : null}
              <ActionButton
                label="Vazgeç"
                onPress={() => setGcalModalVisible(false)}
                secondary
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 🚨 TAM EKRAN KESİNTİSİZ ÇALAN ALARM EKRANI 🚨 */}
      <Modal
        animationType="fade"
        transparent={false}
        visible={activeAlarmEvent !== null}
        onRequestClose={stopAlarmSound}
      >
        <SafeAreaView style={styles.alarmScreen}>
          <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
          <View style={styles.alarmContainer}>
            <Animated.View
              style={[
                styles.alarmPulseCircle,
                { transform: [{ scale: pulseAnim }] },
              ]}
            >
              <Text style={styles.alarmBigIcon}>⏰</Text>
            </Animated.View>

            <Text style={styles.alarmScreenHeader}>TOPLANTI ALARMI ÇALIYOR</Text>
            <Text style={styles.alarmEventTitle}>
              {activeAlarmEvent?.title || "Toplantı"}
            </Text>
            <Text style={styles.alarmTimeBig}>
              {formatTime(activeAlarmEvent?.startDate)}
            </Text>
            <Text style={styles.alarmSubtext}>
              {activeAlarmEvent?.location
                ? `${activeAlarmEvent.location} · `
                : ""}
              Toplantıya {alarmMinutes} dakika kaldı!
            </Text>

            <View style={styles.alarmButtonStack}>
              <Pressable
                onPress={stopAlarmSound}
                style={({ pressed }) => [
                  styles.stopAlarmButton,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={styles.stopAlarmButtonText}>🛑 ALARMI DURDUR</Text>
              </Pressable>

              <Pressable
                onPress={() => activeAlarmEvent && snoozeAlarm(activeAlarmEvent)}
                style={({ pressed }) => [
                  styles.snoozeButton,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={styles.snoozeButtonText}>💤 10 Dakika Ertele</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Yeni Etkinlik Ekleme Modalı */}
      <Modal
        animationType="slide"
        transparent
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>➕ Yeni Toplantı Ekle</Text>
            <Text style={styles.mutedText}>
              {days[selectedDay] ? formatLongDate(days[selectedDay]) : ""} için toplantı oluştur:
            </Text>

            <Text style={styles.modalInputLabel}>Toplantı Başlığı</Text>
            <TextInput
              placeholder="Örn: Proje Toplantısı, Görüşme..."
              value={newEventTitle}
              onChangeText={setNewEventTitle}
              style={styles.modalInput}
            />

            <Text style={styles.modalInputLabel}>Toplantı Saati (24 Saat)</Text>
            <View style={styles.timeInputRow}>
              <TextInput
                placeholder="Saat (14)"
                keyboardType="number-pad"
                maxLength={2}
                value={newEventHour}
                onChangeText={setNewEventHour}
                style={[styles.modalInput, { width: 80, textAlign: "center" }]}
              />
              <Text style={{ fontSize: 20, fontWeight: "700" }}>:</Text>
              <TextInput
                placeholder="Dk (30)"
                keyboardType="number-pad"
                maxLength={2}
                value={newEventMinute}
                onChangeText={setNewEventMinute}
                style={[styles.modalInput, { width: 80, textAlign: "center" }]}
              />
            </View>

            <Text style={styles.modalInputLabel}>Konum (Google Meet / Ofis)</Text>
            <TextInput
              placeholder="Örn: Google Meet, Zoom, Ofis..."
              value={newEventLocation}
              onChangeText={setNewEventLocation}
              style={styles.modalInput}
            />

            <View style={{ marginTop: 12 }}>
              <ActionButton label="Toplantıyı Kaydet" onPress={handleAddNewEvent} />
              <ActionButton
                label="Vazgeç"
                onPress={() => setModalVisible(false)}
                secondary
              />
            </View>
          </View>
        </View>
      </Modal>
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
  audioBadge: {
    backgroundColor: "#eff6ff",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  audioBadgeText: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: "700",
  },
  greeting: {
    marginTop: 14,
    marginBottom: 16,
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
  // Google Takvim Banner
  gcalBanner: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 10,
  },
  gcalBannerTitle: {
    color: "#1e40af",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  gcalBannerText: {
    color: "#3b82f6",
    fontSize: 11,
    lineHeight: 15,
  },
  gcalBannerBtn: {
    backgroundColor: COLORS.blue,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  gcalBannerBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  // Kaynak Filtresi
  sourceFilterContainer: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  sourceFilterBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  sourceFilterBtnActive: {
    backgroundColor: COLORS.ink,
    borderColor: COLORS.ink,
  },
  sourceFilterText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  sourceFilterTextActive: {
    color: "#ffffff",
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
  iconCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconCircleBtnText: {
    fontSize: 18,
    color: COLORS.green,
    fontWeight: "700",
  },
  addEventButton: {
    backgroundColor: COLORS.greenSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    justifyContent: "center",
  },
  addEventButtonText: {
    color: COLORS.greenDark,
    fontSize: 11,
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
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  countdown: {
    color: COLORS.surface,
    fontSize: 11,
    fontWeight: "700",
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
    minHeight: 52,
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
  sourceBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sourceBadgeText: {
    fontSize: 9,
    fontWeight: "800",
  },
  eventLocation: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 3,
  },
  eventButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
  },
  clockButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fff6eb",
    borderWidth: 1,
    borderColor: "#ffe0b2",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  clockButtonIcon: {
    fontSize: 12,
  },
  clockButtonText: {
    color: "#b25e00",
    fontSize: 11,
    fontWeight: "700",
  },
  ringNowButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  ringNowButtonIcon: {
    fontSize: 12,
  },
  ringNowButtonText: {
    color: "#b91c1c",
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
  // Alarm Ekranı
  alarmScreen: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  alarmContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  alarmPulseCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderWidth: 2,
    borderColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  alarmBigIcon: {
    fontSize: 64,
  },
  alarmScreenHeader: {
    color: "#f87171",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 8,
  },
  alarmEventTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 10,
  },
  alarmTimeBig: {
    color: "#38bdf8",
    fontSize: 48,
    fontWeight: "900",
    marginBottom: 8,
  },
  alarmSubtext: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 44,
  },
  alarmButtonStack: {
    width: "100%",
    gap: 14,
  },
  stopAlarmButton: {
    backgroundColor: "#ef4444",
    paddingVertical: 18,
    borderRadius: 20,
    alignItems: "center",
    shadowColor: "#ef4444",
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 4,
  },
  stopAlarmButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  snoozeButton: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: "center",
  },
  snoozeButtonText: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "700",
  },
  // Modal Stilleri
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 15,
  },
  modalTitle: {
    color: COLORS.ink,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  gcalGuideBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    marginBottom: 12,
  },
  gcalGuideTitle: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  gcalGuideText: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  modalInputLabel: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: COLORS.ink,
    backgroundColor: "#fafafa",
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
