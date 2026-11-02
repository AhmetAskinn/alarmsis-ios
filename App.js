// Expo Go ve React Native bilgilendirme uyarılarını sessize al
if (typeof console !== "undefined" && console.warn) {
  const origWarn = console.warn;
  console.warn = (...args) => {
    const text = args[0] ? String(args[0]) : "";
    if (
      text.includes("expo-notifications") ||
      text.includes("SafeAreaView") ||
      text.includes("Android Push notifications") ||
      text.includes("development build")
    ) {
      return;
    }
    origWarn(...args);
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Keyboard,
  Linking,
  LogBox,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Calendar from "expo-calendar/legacy";
import * as Notifications from "expo-notifications";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Zararsız Expo Go bilgilendirme uyarılarını sessize al
LogBox.ignoreLogs([
  "`expo-notifications` functionality is not fully supported in Expo Go",
  "Android Push notifications",
  "SafeAreaView has been deprecated",
]);

// Expo Go için güvenli, çökmeyen bellek deposu
let MEMORY_GCAL_URL = "";
const SafeStorage = {
  getItem: async () => MEMORY_GCAL_URL,
  setItem: async (key, val) => {
    MEMORY_GCAL_URL = val;
  },
  removeItem: async () => {
    MEMORY_GCAL_URL = "";
  },
};

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
  purple: "#7c3aed",
  purpleSoft: "#ede9fe",
};

const WAKE_UP_PRESETS = [10, 15, 20, 30, 45, 60];
const INTERIM_PRESETS = [5, 10, 15, 20, 30];
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

// ICS / iCal Tarih Ayrıştırıcı
function parseICSDate(str) {
  if (!str) return null;
  const clean = str.replace(/\r/g, "").trim();

  if (clean.includes("T") && clean.endsWith("Z")) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    const h = parseInt(clean.slice(9, 11), 10);
    const min = parseInt(clean.slice(11, 13), 10);
    const s = parseInt(clean.slice(13, 15), 10) || 0;
    return new Date(Date.UTC(y, m, d, h, min, s));
  }

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

  if (clean.length >= 8) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    return new Date(y, m, d, 9, 0, 0);
  }

  return null;
}

function parseICSData(icsText) {
  const events = [];
  const lines = icsText.split(/\r\n|\n|\r/);
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
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
          location: cur.location || "Google Meet / Takvim",
          startDate: cur.startDate,
          endDate: cur.endDate || new Date(cur.startDate.getTime() + 60 * 60_000),
          calendarTitle: "Google Takvim",
          color: COLORS.blue,
          source: "google",
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

function getInitialSmartEvents() {
  const now = new Date();
  const events = [];

  const m1 = new Date(now);
  m1.setHours(9, 30, 0, 0);
  const validM1 = m1 > now ? m1 : new Date(now.getTime() + 90 * 60_000);

  events.push({
    id: "main-meeting-1",
    title: "Yönetim & Müşteri Toplantısı",
    location: "Google Meet",
    startDate: validM1,
    endDate: new Date(validM1.getTime() + 60 * 60_000),
    calendarTitle: "Google Takvim",
    color: COLORS.blue,
    source: "google",
  });

  const m2 = new Date(validM1.getTime() + 180 * 60_000);
  events.push({
    id: "sample-2",
    title: "Proje Değerlendirme & Sunum",
    location: "Merkez Ofis",
    startDate: m2,
    endDate: new Date(m2.getTime() + 60 * 60_000),
    calendarTitle: "Google Takvim",
    color: COLORS.green,
    source: "google",
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

function EventCard({
  event,
  alarmDate,
  minutesBefore,
  isFirstOfDay,
  onTriggerDirectAlarm,
  onEditDuration,
}) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTime}>
        <Text style={styles.eventTimeText}>{formatTime(event.startDate)}</Text>
        <Text style={styles.eventTimeCaption}>toplantı</Text>
      </View>
      <View
        style={[
          styles.eventDivider,
          { backgroundColor: isFirstOfDay ? COLORS.purple : event.color || COLORS.blue },
        ]}
      />
      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {event.title}
          </Text>
          {isFirstOfDay ? (
            <View style={styles.firstMeetingBadge}>
              <Text style={styles.firstMeetingBadgeText}>🌅 Günün İlki</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.eventLocation} numberOfLines={1}>
          {event.location ? `${event.location} · ` : ""}
          {event.calendarTitle || "Takvim"}
        </Text>

        <View style={styles.eventAlarmBadgeRow}>
          {/* TIKLANABİLİR SÜRE AYARI */}
          <Pressable
            onPress={() => onEditDuration && onEditDuration(event, minutesBefore)}
            style={({ pressed }) => [
              styles.calculatedAlarmChip,
              pressed && styles.pressedButton,
            ]}
          >
            <Text style={styles.calculatedAlarmChipText}>
              ⏰ Alarm: <Text style={{ fontWeight: "800" }}>{formatTime(alarmDate)}</Text> (
              {minutesBefore} dk önce <Text style={{ color: COLORS.purple }}>✎ Değiştir</Text>)
            </Text>
          </Pressable>

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
  const [selectedDay, setSelectedDay] = useState(0);

  // KULLANICININ İSTEDİĞİ GİBİ ŞEKİLLENDİRİLEBİLEN ALARM SÜRELERİ:
  // 1. Genel uyanma süresi (Varsayılan 30 dk)
  const [wakeUpMinutes, setWakeUpMinutes] = useState(30);
  // 2. Gün içi diğer toplantılar için varsayılan süre (10 dk)
  const [interimMinutes, setInterimMinutes] = useState(10);
  // 3. Toplantılara ÖZEL kullanıcı tanımlı süreler { [eventId]: minutes }
  const [eventCustomMinutes, setEventCustomMinutes] = useState({});

  // Özel Süre Düzenleme Modalı
  const [editingEvent, setEditingEvent] = useState(null);
  const [modalDurationVal, setModalDurationVal] = useState("30");

  // Otonom Arka Plan Takibi
  const [isAutoWatcherActive, setIsAutoWatcherActive] = useState(true);
  const [autoRescheduleAlert, setAutoRescheduleAlert] = useState(null);

  const [allEvents, setAllEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const prevEarliestTimeRef = useRef(null);
  const isFetchingRef = useRef(false);

  // Google Takvim Bağlantı Modalı
  const [gcalModalVisible, setGcalModalVisible] = useState(false);
  const [gcalUrlInput, setGcalUrlInput] = useState("");
  const [savedGcalUrl, setSavedGcalUrl] = useState("");

  // Canlı Sesli Alarm Modalı
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

  // Gerçek Yüksek Sesli Alarm Çalıcı (expo-audio)
  const alarmAudioPlayerRef = useRef(null);

  const stopAlarmSound = useCallback(async () => {
    try {
      if (alarmAudioPlayerRef.current) {
        alarmAudioPlayerRef.current.pause();
        alarmAudioPlayerRef.current.seekTo(0);
      }
    } catch (e) {
      console.warn("Alarm sesi durdurulamadı:", e);
    }
    Vibration.cancel();
    setActiveAlarmEvent(null);
  }, []);

  const startAlarmSound = useCallback(async (event) => {
    try {
      // 1. Sessiz modda bile bağırması için iOS Audio Session yapılandır
      await setAudioModeAsync({
        playsInSilentMode: true,
        staysActiveInBackground: true,
        interruptionMode: "doNotMixPersistent",
      }).catch(() => {});

      // 2. Yüksek sesli alarm dosyasını başlat ve sonsuz döngüye (loop) al
      if (!alarmAudioPlayerRef.current) {
        alarmAudioPlayerRef.current = createAudioPlayer(require("./assets/alarm.mp3"));
      }
      alarmAudioPlayerRef.current.loop = true;
      alarmAudioPlayerRef.current.volume = 1.0;
      alarmAudioPlayerRef.current.seekTo(0);
      alarmAudioPlayerRef.current.play();
    } catch (audioErr) {
      console.warn("Yüksek sesli alarm başlatma hatası:", audioErr);
    }

    try {
      Vibration.vibrate([1000, 500, 1000, 500], true);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ UYANMA ALARMI: ${event.title}`,
          body: `Toplantınız ${formatTime(event.startDate)}'da başlıyor! Uyanma vaktiniz geldi.`,
          sound: "default",
        },
        trigger: null,
      }).catch((e) => console.warn("Bildirim schedule uyarısı:", e));
    } catch (err) {
      console.warn("Alarm bildirim hatası:", err);
    }
    setActiveAlarmEvent(event);
  }, []);

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

  // KULLANICININ BELİRLEDİĞİ DAKİKAYI ALMA
  // (Eğer o toplantıya özel dakika seçtiyse onu, yoksa ilk toplantı için wakeUpMinutes, sonrakiler için interimMinutes)
  const getMinutesForEvent = useCallback(
    (event, isFirstOfDay) => {
      if (eventCustomMinutes[event.id] !== undefined) {
        return eventCustomMinutes[event.id];
      }
      return isFirstOfDay ? wakeUpMinutes : interimMinutes;
    },
    [eventCustomMinutes, wakeUpMinutes, interimMinutes],
  );

  const calculateAlarmDate = useCallback(
    (event, isFirstOfDay) => {
      const minutesBefore = getMinutesForEvent(event, isFirstOfDay);
      return new Date(event.startDate.getTime() - minutesBefore * 60_000);
    },
    [getMinutesForEvent],
  );

  const earliestUpcomingEvent = useMemo(() => {
    const now = new Date();
    const future = allEvents.filter((e) => e.startDate > now);
    if (future.length === 0) return null;
    return future.sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  }, [allEvents]);

  // Otonom Canlı Takip Motoru
  useEffect(() => {
    if (!isAutoWatcherActive || !earliestUpcomingEvent) return;

    const currentStartTimeMs = earliestUpcomingEvent.startDate.getTime();

    if (prevEarliestTimeRef.current !== null) {
      if (prevEarliestTimeRef.current !== currentStartTimeMs) {
        const oldDate = new Date(prevEarliestTimeRef.current);
        const newDate = earliestUpcomingEvent.startDate;
        const newAlarm = calculateAlarmDate(earliestUpcomingEvent, true);
        const now = new Date();

        Notifications.cancelAllScheduledNotificationsAsync()
          .then(async () => {
            // iOS UNNotificationTrigger.m AssertLine=537 Çökme Koruması:
            // Sadece alarm zamanı gelecekteyse (now'dan büyükse) bildirim zamanla.
            if (newAlarm.getTime() > now.getTime()) {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: `⏰ UYANMA ALARMI: ${earliestUpcomingEvent.title}`,
                  body: `Toplantınız öne çekildi! Yeni saat: ${formatTime(newDate)}`,
                  sound: "default",
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: newAlarm,
                },
              });
            } else {
              // Eğer alarm saati şimdiden küçük veya eşitse (yani vakti gelmişse), doğrudan alarmı çal!
              await startAlarmSound(earliestUpcomingEvent);
            }
          })
          .catch((err) => {
            console.warn("Bildirim planlama uyarısı:", err);
          });

        setAutoRescheduleAlert({
          oldTime: formatTime(oldDate),
          newTime: formatTime(newDate),
          newAlarmTime: formatTime(newAlarm),
          title: earliestUpcomingEvent.title,
        });

        Vibration.vibrate(500);
      }
    }

    prevEarliestTimeRef.current = currentStartTimeMs;
  }, [earliestUpcomingEvent, isAutoWatcherActive, calculateAlarmDate, startAlarmSound]);

  // Google Takviminden Etkinlikleri Çekme (Önbellek Engelleme & Anlık Senkronizasyon)
  const fetchGoogleCalendarEvents = useCallback(async (url) => {
    if (!url || !url.trim()) return [];
    try {
      let fetchUrl = url.trim();
      if (fetchUrl.startsWith("webcal://")) {
        fetchUrl = "https://" + fetchUrl.slice(9);
      }
      // Önbellek baypas: URL sonuna zaman damgası ekle ve no-cache header'ları yolla
      const sep = fetchUrl.includes("?") ? "&" : "?";
      const noCacheUrl = `${fetchUrl}${sep}_t=${Date.now()}`;
      const res = await fetch(noCacheUrl, {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      });
      if (!res.ok) throw new Error("Takvim okunamadı.");
      const text = await res.text();
      return parseICSData(text);
    } catch (err) {
      if (err?.message?.includes("cancelled") || err?.name === "AbortError") {
        // iOS arka plana geçişte veya kilitte isteği iptal edebilir, bu normaldir
        return [];
      }
      console.warn("Google Takvim hatası:", err);
      throw err;
    }
  }, []);

  const loadAllCalendars = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      let combinedEvents = [];
      const savedUrl = (await SafeStorage.getItem(STORAGE_KEY_GCAL_URL)) || savedGcalUrl;
      if (savedUrl) {
        setSavedGcalUrl(savedUrl);
        try {
          const gEvents = await fetchGoogleCalendarEvents(savedUrl);
          if (gEvents && gEvents.length > 0) {
            combinedEvents = [...combinedEvents, ...gEvents];
            setStatusMessage(
              `✓ Google Takvim senkronize: ${gEvents.length} toplantı (${new Date().toLocaleTimeString(
                "tr-TR",
                { hour: "2-digit", minute: "2-digit", second: "2-digit" },
              )})`,
            );
          }
        } catch (gErr) {
          if (!gErr?.message?.includes("cancelled")) {
            setStatusMessage(`Google Takvim uyarısı: ${gErr.message}`);
          }
        }
      }

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
                };
              })
              .filter((evt) => evt.startDate > new Date());

            combinedEvents = [...combinedEvents, ...mappedApple];
          }
        }
      } catch {
        // devam et
      }

      if (combinedEvents.length === 0) {
        combinedEvents = getInitialSmartEvents();
      }

      setAllEvents(
        combinedEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
      );
    } finally {
      isFetchingRef.current = false;
    }
  }, [fetchGoogleCalendarEvents, savedGcalUrl]);

  // Otonom Canlı Takvim Takibi:
  // 1. Uygulama açıldığında çalıştır
  // 2. Her 10 saniyede bir Google Takvimini arka planda sessizce tara
  // 3. Kullanıcı Google Takvim uygulamasından Alertify'a geçtiği anda hemen tara
  useEffect(() => {
    loadAllCalendars();

    const autoSyncTimer = setInterval(() => {
      loadAllCalendars();
    }, 10000);

    const appStateSub = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        loadAllCalendars();
      }
    });

    return () => {
      clearInterval(autoSyncTimer);
      appStateSub.remove();
    };
  }, [loadAllCalendars]);

  // Simülasyon Testi: Toplantıyı 40 dk öne çekme
  function simulateRescheduleEarlier() {
    if (!earliestUpcomingEvent) {
      Alert.alert("Bilgi", "Test edilecek toplantı bulunamadı.");
      return;
    }
    const shiftedTime = new Date(
      earliestUpcomingEvent.startDate.getTime() - 40 * 60_000,
    );
    setAllEvents((prev) =>
      prev.map((e) => {
        if (e.id === earliestUpcomingEvent.id) {
          return {
            ...e,
            startDate: shiftedTime,
            endDate: new Date(shiftedTime.getTime() + 60 * 60_000),
          };
        }
        return e;
      }),
    );
  }

  // Toplantıya özel süre düzenleme modalını aç
  function handleOpenEditDuration(event, currentMinutes) {
    setEditingEvent(event);
    setModalDurationVal(String(currentMinutes));
  }

  // Toplantıya özel süreyi kaydet
  function handleSaveCustomEventDuration() {
    if (!editingEvent) return;
    const val = parseInt(modalDurationVal, 10);
    if (isNaN(val) || val <= 0 || val > 1440) {
      Alert.alert("Geçersiz Süre", "Lütfen 1 ile 1440 arasında bir dakika girin.");
      return;
    }

    setEventCustomMinutes((prev) => ({
      ...prev,
      [editingEvent.id]: val,
    }));
    setEditingEvent(null);
    Alert.alert(
      "✓ Süre Güncellendi",
      `"${editingEvent.title}" için alarm tam ${val} dakika öncesine ayarlandı.`,
    );
  }

  async function handleSaveGcalUrl() {
    if (!gcalUrlInput.trim()) {
      Alert.alert("Eksik Link", "Lütfen iCal linkinizi yapıştırın.");
      return;
    }
    try {
      const gEvents = await fetchGoogleCalendarEvents(gcalUrlInput.trim());
      await SafeStorage.setItem(STORAGE_KEY_GCAL_URL, gcalUrlInput.trim());
      setSavedGcalUrl(gcalUrlInput.trim());
      setGcalModalVisible(false);
      setAllEvents((prev) => {
        const withoutOldGcal = prev.filter((e) => e.source !== "google");
        return [...withoutOldGcal, ...gEvents].sort(
          (a, b) => a.startDate.getTime() - b.startDate.getTime(),
        );
      });
      Alert.alert("🎉 Bağlandı!", `${gEvents.length} toplantı çekildi.`);
    } catch {
      Alert.alert("Hata", "Takvim linki okunamadı.");
    }
  }

  function handleAddNewEvent() {
    if (!newEventTitle.trim()) {
      Alert.alert("Eksik Bilgi", "Lütfen toplantı başlığını girin.");
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
      location: newEventLocation.trim() || "Google Meet",
      startDate: targetDate,
      endDate: new Date(targetDate.getTime() + 60 * 60_000),
      calendarTitle: "Toplantım",
      color: COLORS.blue,
      source: "google",
    };

    setAllEvents((prev) =>
      [...prev, newEvt].sort((a, b) => a.startDate.getTime() - b.startDate.getTime()),
    );
    setNewEventTitle("");
    setModalVisible(false);
  }

  const selectedEvents = useMemo(() => {
    const targetDate = days[selectedDay];
    if (!targetDate) return [];
    return allEvents.filter((event) => {
      const eDate = event.startDate;
      return (
        eDate.getDate() === targetDate.getDate() &&
        eDate.getMonth() === targetDate.getMonth() &&
        eDate.getFullYear() === targetDate.getFullYear()
      );
    });
  }, [allEvents, selectedDay, days]);

  function renderCalendar() {
    const firstOfDay = selectedEvents[0];
    const firstAlarm = firstOfDay ? calculateAlarmDate(firstOfDay, true) : null;
    const firstOfDayMinutes = firstOfDay ? getMinutesForEvent(firstOfDay, true) : wakeUpMinutes;

    return (
      <>
        {/* OTONOM DEĞİŞİKLİK BİLDİRİM BANNER'I */}
        {autoRescheduleAlert ? (
          <View style={styles.autoRescheduleBanner}>
            <View style={styles.autoRescheduleIconWrap}>
              <Text style={{ fontSize: 20 }}>⚡</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.autoRescheduleTitle}>
                OTONOM TAKİP: ALARM GÜNCELLENDİ!
              </Text>
              <Text style={styles.autoRescheduleBody}>
                "{autoRescheduleAlert.title}" toplantısı{" "}
                <Text style={{ textDecorationLine: "line-through" }}>
                  {autoRescheduleAlert.oldTime}
                </Text>{" "}
                ➔ <Text style={{ fontWeight: "800" }}>{autoRescheduleAlert.newTime}</Text> saatine çekildi!
                {"\n"}
                Alarmınız otomatik olarak{" "}
                <Text style={{ fontWeight: "800", color: "#b91c1c" }}>
                  {autoRescheduleAlert.newAlarmTime}
                </Text>{" "}
                saatine güncellendi.
              </Text>
            </View>
            <Pressable
              onPress={() => setAutoRescheduleAlert(null)}
              style={styles.closeAlertBtn}
            >
              <Text style={{ color: "#7f1d1d", fontWeight: "700" }}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.greeting}>
          <View style={styles.greetingCopy}>
            <Text style={styles.eyebrow}>
              {formatLongDate(new Date()).toLocaleUpperCase("tr-TR")}
            </Text>
            <Text style={styles.heading}>Kişiselleştirilmiş Alarmlar</Text>
            <Text style={styles.mutedText}>
              Her toplantı için alarm süresini istediğin gibi kendin belirle.
            </Text>
          </View>
        </View>

        {/* GÜNÜN İLK TOPLANTISI & CANLI UYANMA ALARMI KARTI */}
        {firstOfDay ? (
          <View style={styles.wakeUpHeroCard}>
            <View style={styles.wakeUpBadgeRow}>
              <View style={styles.livePulseDot} />
              <Text style={styles.wakeUpBadgeText}>
                {isAutoWatcherActive ? "OTONOM CANLI TAKİP AKTİF" : "TAKİP DURDURULDU"}
              </Text>
            </View>

            <Text style={styles.wakeUpHeroSub}>SABAH UYANMA SAATİN</Text>
            <Text style={styles.wakeUpHeroAlarmTime}>{formatTime(firstAlarm)}</Text>

            <View style={styles.wakeUpMeetingInfo}>
              <Text style={styles.wakeUpMeetingTitle} numberOfLines={1}>
                📌 İlk Toplantı: {firstOfDay.title} ({formatTime(firstOfDay.startDate)})
              </Text>
            </View>

            {/* ⏱️ CANLI ALARM SÜRESİ STEPPER'I & KONTROLÜ */}
            <View style={styles.liveDurationBox}>
              <Text style={styles.liveDurationBoxTitle}>
                ⏱️ Uyanma Süresini Kendin Belirle:
              </Text>

              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setWakeUpMinutes((prev) => Math.max(5, prev - 5))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>- 5 dk</Text>
                </Pressable>

                <View style={styles.stepDisplay}>
                  <Text style={styles.stepDisplayNumber}>{wakeUpMinutes}</Text>
                  <Text style={styles.stepDisplayLabel}>dakika önce</Text>
                </View>

                <Pressable
                  onPress={() => setWakeUpMinutes((prev) => Math.min(180, prev + 5))}
                  style={styles.stepBtn}
                >
                  <Text style={styles.stepBtnText}>+ 5 dk</Text>
                </Pressable>
              </View>

              {/* Hızlı Seçim Chip'leri */}
              <View style={styles.quickChipsRow}>
                {[10, 15, 20, 30, 45, 60].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setWakeUpMinutes(m)}
                    style={[
                      styles.quickChip,
                      wakeUpMinutes === m && styles.quickChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        wakeUpMinutes === m && styles.quickChipTextActive,
                      ]}
                    >
                      {m} dk
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* SİMÜLASYON TEST BUTONU */}
            <Pressable
              onPress={simulateRescheduleEarlier}
              style={({ pressed }) => [
                styles.simulateButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.simulateButtonText}>
                🧪 Test Et: Toplantıyı 40 Dk Öne Çek (09:30 ➔ 08:50)
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Google Takvim Durum Kartı & Butonu */}
        <View style={styles.gcalBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gcalBannerTitle}>
              {savedGcalUrl ? "🌐 Google Takvim Canlı İzleniyor" : "🌐 Google Takvimini Bağla"}
            </Text>
            <Text style={styles.gcalBannerText}>
              {savedGcalUrl
                ? "Toplantı saatleri değiştikçe alarmlar otomatik uyarlanır."
                : "Toplantılarını bağla, sabah uyanma alarmlarını Alertify yönetsin."}
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

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>
              {selectedDay === 0 ? "Bugünkü Toplantılar" : formatLongDate(days[selectedDay])}
            </Text>
            <Text style={styles.sectionCaption}>
              Her toplantının alarm süresini üstüne dokunarak özelleştirebilirsin
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
          selectedEvents.map((event, index) => {
            const isFirst = index === 0;
            const aDate = calculateAlarmDate(event, isFirst);
            const mins = getMinutesForEvent(event, isFirst);
            return (
              <EventCard
                key={event.id}
                event={event}
                alarmDate={aDate}
                minutesBefore={mins}
                isFirstOfDay={isFirst}
                onTriggerDirectAlarm={startAlarmSound}
                onEditDuration={handleOpenEditDuration}
              />
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Toplantı bulunamadı</Text>
            <Text style={styles.mutedText}>
              Seçilen tarihte toplantı görünmüyor. Yukarıdaki '+ Ekle' butonundan ekleyebilirsin.
            </Text>
          </View>
        )}

        <View style={{ marginTop: 14 }}>
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

  function renderSettings() {
    return (
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.heading}>Özelleştirilebilir Alarmlar</Text>
          <Text style={styles.mutedText}>
            Uyanma ve hatırlatma sürelerini tamamen kendi isteğine göre ayarla.
          </Text>
        </View>

        {/* 1. GÜNÜN İLK TOPLANTISI İÇİN UYANMA SÜRESİ */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🌅 Sabah İlk Toplantı Uyanma Payı</Text>
          <Text style={styles.mutedText}>
            Sabah yataktan kalkıp hazırlanabilmen için ilk toplantıdan ne kadar önce uyandırayım?
          </Text>

          <View style={styles.presetList}>
            {WAKE_UP_PRESETS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setWakeUpMinutes(value)}
                style={[
                  styles.presetButton,
                  wakeUpMinutes === value && styles.selectedPreset,
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    wakeUpMinutes === value && styles.selectedPresetText,
                  ]}
                >
                  {value === 60 ? "1 saat" : `${value} dk`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 2. DİĞER GÜN İÇİ TOPLANTILAR İÇİN HATIRLATMA SÜRESİ */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>☕ Gün İçi Diğer Toplantılar</Text>
          <Text style={styles.mutedText}>
            Günün sonraki toplantılarına kaç dakika kala haber vereyim?
          </Text>

          <View style={styles.presetList}>
            {INTERIM_PRESETS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setInterimMinutes(value)}
                style={[
                  styles.presetButton,
                  interimMinutes === value && styles.selectedPreset,
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    interimMinutes === value && styles.selectedPresetText,
                  ]}
                >
                  {value} dk
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 3. OTONOM CANLI İZLEYİCİ */}
        <View style={styles.settingsCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.settingsTitle}>⚡ Otonom Gece İzleyici</Text>
            <Pressable
              onPress={() => setIsAutoWatcherActive(!isAutoWatcherActive)}
              style={[
                styles.toggleBtn,
                { backgroundColor: isAutoWatcherActive ? COLORS.green : COLORS.line },
              ]}
            >
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>
                {isAutoWatcherActive ? "AÇIK" : "KAPALI"}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.mutedText}>
            Sen uyurken toplantı saati öne çekilirse sistem alarmı otomatik olarak yeni saate çeker.
          </Text>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>🔊 Kesintisiz Alarm Testi</Text>
          <Text style={styles.mutedText}>
            Tam ekran uyanma alarmının sesini ve durdurma ekranını hemen canlı test et.
          </Text>
          <ActionButton
            icon="🚨"
            label="Alarmı Şimdi Çaldır"
            onPress={() => {
              const testEvt = earliestUpcomingEvent || {
                id: "test",
                title: "Sabah Toplantısı",
                startDate: new Date(),
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
            <Text style={styles.audioBadgeText}>⚡ Otonom İzleyici Aktif</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.pageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {selectedTab === "calendar" ? renderCalendar() : null}
          {selectedTab === "settings" ? renderSettings() : null}

          {statusMessage ? (
            <Text accessibilityLiveRegion="polite" style={styles.statusMessage}>
              {statusMessage}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.tabBar}>
          {[
            { id: "calendar", label: "Alarmlar & Takvim", icon: "⏰" },
            { id: "settings", label: "Süre Ayarları", icon: "⚙️" },
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

      {/* ⏱️ TOPLANTIYA ÖZEL SÜRE DÜZENLEME MODALI */}
      <Modal
        animationType="fade"
        transparent
        visible={editingEvent !== null}
        onRequestClose={() => setEditingEvent(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>⏰ Alarm Süresini Belirle</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              "{editingEvent?.title}" için
            </Text>
            <Text style={styles.mutedText}>
              Bu toplantı başlamadan tam kaç dakika önce alarm çalsın?
            </Text>

            {/* Stepper Kontrolü */}
            <View style={styles.modalStepperRow}>
              <Pressable
                onPress={() =>
                  setModalDurationVal((prev) =>
                    String(Math.max(1, (parseInt(prev, 10) || 10) - 5)),
                  )
                }
                style={styles.modalStepBtn}
              >
                <Text style={styles.modalStepBtnText}>- 5 dk</Text>
              </Pressable>

              <View style={styles.modalStepInputWrap}>
                <TextInput
                  keyboardType="number-pad"
                  maxLength={4}
                  value={modalDurationVal}
                  onChangeText={setModalDurationVal}
                  style={styles.modalStepInput}
                />
                <Text style={styles.modalStepInputLabel}>dakika önce</Text>
              </View>

              <Pressable
                onPress={() =>
                  setModalDurationVal((prev) =>
                    String(Math.min(1440, (parseInt(prev, 10) || 10) + 5)),
                  )
                }
                style={styles.modalStepBtn}
              >
                <Text style={styles.modalStepBtnText}>+ 5 dk</Text>
              </Pressable>
            </View>

            {/* Hızlı Seçim Butonları */}
            <View style={styles.modalPresetRow}>
              {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setModalDurationVal(String(m))}
                  style={[
                    styles.modalPresetChip,
                    parseInt(modalDurationVal, 10) === m &&
                      styles.modalPresetChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modalPresetChipText,
                      parseInt(modalDurationVal, 10) === m &&
                        styles.modalPresetChipTextActive,
                    ]}
                  >
                    {m} dk
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ marginTop: 14 }}>
              <ActionButton
                label="Bu Toplantı İçin Kaydet"
                onPress={handleSaveCustomEventDuration}
              />
              <ActionButton
                label="Vazgeç"
                onPress={() => setEditingEvent(null)}
                secondary
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 🚨 TAM EKRAN KESİNTİSİZ ÇALAN ALARM EKRANI */}
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

            <Text style={styles.alarmScreenHeader}>UYANMA VAKTİ GELDİ</Text>
            <Text style={styles.alarmEventTitle}>
              {activeAlarmEvent?.title || "Toplantı"}
            </Text>
            <Text style={styles.alarmTimeBig}>
              Toplantı: {formatTime(activeAlarmEvent?.startDate)}
            </Text>
            <Text style={styles.alarmSubtext}>
              Toplantı vaktiniz yaklaştı! Hazırlanıp katılabilirsiniz.
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

      {/* 🌐 GOOGLE TAKVİM BAĞLANTI MODALI */}
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
                1. <Text style={{ fontWeight: "700" }}>calendar.google.com</Text> açın.
                {"\n"}2. Takviminizin yanındaki <Text style={{ fontWeight: "700" }}>⋮ Ayarlar</Text>'a tıklayın.
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
                label="Bağla ve Canlı Takibi Başlat"
                onPress={handleSaveGcalUrl}
              />
              <ActionButton
                label="Vazgeç"
                onPress={() => setGcalModalVisible(false)}
                secondary
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* YENİ TOPLANTI EKLEME MODALI */}
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
              placeholder="Örn: Müşteri Sunumu..."
              value={newEventTitle}
              onChangeText={setNewEventTitle}
              style={styles.modalInput}
            />

            <Text style={styles.modalInputLabel}>Toplantı Saati (24 Saat)</Text>
            <View style={styles.timeInputRow}>
              <TextInput
                placeholder="Saat (08)"
                keyboardType="number-pad"
                maxLength={2}
                value={newEventHour}
                onChangeText={setNewEventHour}
                style={[styles.modalInput, { width: 80, textAlign: "center" }]}
              />
              <Text style={{ fontSize: 20, fontWeight: "700" }}>:</Text>
              <TextInput
                placeholder="Dk (50)"
                keyboardType="number-pad"
                maxLength={2}
                value={newEventMinute}
                onChangeText={setNewEventMinute}
                style={[styles.modalInput, { width: 80, textAlign: "center" }]}
              />
            </View>

            <Text style={styles.modalInputLabel}>Konum (Opsiyonel)</Text>
            <TextInput
              placeholder="Örn: Google Meet, Ofis..."
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
    backgroundColor: COLORS.purpleSoft,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  audioBadgeText: {
    color: COLORS.purple,
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
  autoRescheduleBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1.5,
    borderColor: "#f87171",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 16,
    shadowColor: "#ef4444",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
  },
  autoRescheduleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
  },
  autoRescheduleTitle: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  autoRescheduleBody: {
    color: "#7f1d1d",
    fontSize: 12,
    lineHeight: 17,
  },
  closeAlertBtn: {
    padding: 4,
  },
  wakeUpHeroCard: {
    backgroundColor: "#1e1b4b",
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#4338ca",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  wakeUpBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4ade80",
  },
  wakeUpBadgeText: {
    color: "#86efac",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  wakeUpHeroSub: {
    color: "#c7d2fe",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  wakeUpHeroAlarmTime: {
    color: "#ffffff",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 2,
    marginBottom: 4,
  },
  wakeUpMeetingInfo: {
    marginBottom: 10,
  },
  wakeUpMeetingTitle: {
    color: "#e0e7ff",
    fontSize: 13,
    fontWeight: "700",
  },
  // CANLI SÜRE KUTUSU
  liveDurationBox: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  liveDurationBoxTitle: {
    color: "#c7d2fe",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  stepBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  stepBtnText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  stepDisplay: {
    alignItems: "center",
  },
  stepDisplayNumber: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  stepDisplayLabel: {
    color: "#a5b4fc",
    fontSize: 10,
  },
  quickChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
  },
  quickChip: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
  },
  quickChipActive: {
    backgroundColor: COLORS.purple,
  },
  quickChipText: {
    color: "#e0e7ff",
    fontSize: 11,
    fontWeight: "600",
  },
  quickChipTextActive: {
    color: "#ffffff",
    fontWeight: "800",
  },
  simulateButton: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
  },
  simulateButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
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
  firstMeetingBadge: {
    backgroundColor: COLORS.purpleSoft,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  firstMeetingBadgeText: {
    color: COLORS.purple,
    fontSize: 10,
    fontWeight: "800",
  },
  eventLocation: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 3,
  },
  eventAlarmBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  calculatedAlarmChip: {
    backgroundColor: COLORS.greenSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  calculatedAlarmChipText: {
    color: COLORS.greenDark,
    fontSize: 11,
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
    fontSize: 11,
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
    borderColor: COLORS.purple,
    backgroundColor: COLORS.purpleSoft,
  },
  presetText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  selectedPresetText: {
    color: COLORS.purple,
    fontWeight: "800",
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
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
    minWidth: 100,
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
    fontSize: 11,
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
    fontSize: 14,
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
    fontSize: 22,
    fontWeight: "800",
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
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    padding: 22,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  modalTitle: {
    color: COLORS.ink,
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 2,
  },
  modalSubtitle: {
    color: COLORS.purple,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  modalStepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 16,
  },
  modalStepBtn: {
    backgroundColor: COLORS.purpleSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  modalStepBtnText: {
    color: COLORS.purple,
    fontSize: 14,
    fontWeight: "800",
  },
  modalStepInputWrap: {
    alignItems: "center",
  },
  modalStepInput: {
    fontSize: 28,
    fontWeight: "900",
    color: COLORS.ink,
    textAlign: "center",
    minWidth: 80,
  },
  modalStepInputLabel: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  modalPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    marginBottom: 14,
  },
  modalPresetChip: {
    backgroundColor: COLORS.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  modalPresetChipActive: {
    backgroundColor: COLORS.purple,
  },
  modalPresetChipText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  modalPresetChipTextActive: {
    color: "#ffffff",
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
