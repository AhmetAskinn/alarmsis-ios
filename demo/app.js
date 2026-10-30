const dayFormatter = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });
const fullDateFormatter = new Intl.DateTimeFormat("tr-TR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const eventTemplates = [
  {
    hour: 9,
    minute: 30,
    title: "Lizbon'a uçuş",
    location: "İstanbul Havalimanı · İstanbul yerel saati",
    color: "#e9975a",
  },
  {
    hour: 13,
    minute: 0,
    title: "Otel giriş saati",
    location: "Memmo Alfama · Lizbon yerel saati",
    color: "#647dcc",
  },
  {
    hour: 16,
    minute: 15,
    title: "Müşteri toplantısı",
    location: "LX Factory · Lizbon yerel saati",
    color: "#bc76ad",
  },
  {
    hour: 10,
    minute: 0,
    title: "Londra'ya uçuş",
    location: "Lizbon Havalimanı · Lizbon yerel saati",
    color: "#e9975a",
  },
  {
    hour: 11,
    minute: 45,
    title: "Şehir turu",
    location: "South Bank · Londra yerel saati",
    color: "#5b9e82",
  },
  {
    hour: 8,
    minute: 30,
    title: "Dönüş uçuşu",
    location: "Heathrow Havalimanı · Londra yerel saati",
    color: "#e9975a",
  },
  {
    hour: 14,
    minute: 0,
    title: "Yaratıcı ekip görüşmesi",
    location: "Soho House · New York yerel saati",
    color: "#bc76ad",
  },
];

const dateStrip = document.querySelector("#date-strip");
const eventList = document.querySelector("#event-list");
const agendaCaption = document.querySelector("#agenda-caption");
const todayLabel = document.querySelector("#today-label");
const nextAlarmTime = document.querySelector("#next-alarm-time");
const nextAlarmTitle = document.querySelector("#next-alarm-title");
const alarmsList = document.querySelector("#alarms-list");
const alarmTotal = document.querySelector("#alarm-total");
const nextCountdown = document.querySelector("#next-countdown");
const alarmPreset = document.querySelector("#alarm-preset");
const customTime = document.querySelector("#custom-time");
const customMinutesInput = document.querySelector("#custom-minutes");
const alarmPreview = document.querySelector("#alarm-preview");
const saveAlarmButton = document.querySelector("#save-alarm-button");
const toast = document.querySelector("#toast");

let selectedDate = startOfDay(new Date());
let toastTimer;
const storedAlarmMinutes = Number(localStorage.getItem("alarmsis.alarmLeadTimeMinutes"));
let alarmMinutes = Number.isInteger(storedAlarmMinutes) && storedAlarmMinutes >= 1 && storedAlarmMinutes <= 1440
  ? storedAlarmMinutes
  : 10;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function displayTime(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`;
}

function subtractMinutes(hour, minute, amount) {
  const totalMinutes = (hour * 60 + minute - amount + 24 * 60) % (24 * 60);
  return displayTime(Math.floor(totalMinutes / 60), totalMinutes % 60);
}

function eventsForDate(date) {
  const today = startOfDay(new Date());
  const dayOffset = Math.round(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000,
  );
  const dayTemplates = dayOffset === 0
    ? eventTemplates.slice(0, 3)
    : dayOffset === 1
      ? eventTemplates.slice(3, 5)
      : dayOffset === 2
        ? eventTemplates.slice(5, 7)
        : [];

  return dayTemplates
    .map((template, index) => {
      const eventDate = new Date(date);
      eventDate.setHours(template.hour, template.minute, 0, 0);

      return {
        ...template,
        id: `${dayOffset}-${index}`,
        time: displayTime(template.hour, template.minute),
        alarmTime: subtractMinutes(template.hour, template.minute, alarmMinutes),
        eventDate,
      };
    })
    .filter((event) => dayOffset !== 0 || event.eventDate > new Date());
}

function renderDates() {
  dateStrip.replaceChildren();

  for (let offset = 0; offset < 5; offset += 1) {
    const date = addDays(startOfDay(new Date()), offset);
    const button = document.createElement("button");
    const dayLabel = offset === 0
      ? "Bugün"
      : offset === 1
        ? "Yarın"
        : dayFormatter.format(date).replace(".", "");
    button.className = `date-button${startOfDay(date).getTime() === selectedDate.getTime() ? " is-selected" : ""}`;
    button.type = "button";
    button.setAttribute("aria-pressed", String(startOfDay(date).getTime() === selectedDate.getTime()));
    button.setAttribute("aria-label", fullDateFormatter.format(date));
    button.innerHTML = `<span class="date-day">${dayLabel}</span><span class="date-number">${date.getDate()}</span>`;
    button.addEventListener("click", () => {
      selectedDate = startOfDay(date);
      renderDates();
      renderEvents();
    });
    dateStrip.append(button);
  }
}

function renderEvents() {
  const events = eventsForDate(selectedDate);
  const isToday = selectedDate.getTime() === startOfDay(new Date()).getTime();

  agendaCaption.textContent = isToday
    ? "Bugün için planların"
    : fullDateFormatter.format(selectedDate);
  eventList.replaceChildren();

  if (events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Bugün için planlanmış etkinlik yok. Yeni bir toplantı eklendiğinde alarmı otomatik planlarız.";
    eventList.append(empty);
    nextAlarmTime.textContent = "—";
    nextAlarmTitle.textContent = "Bugün için sıradaki etkinlik yok";
    return;
  }

  const nextEvent = events[0];
  nextAlarmTime.textContent = nextEvent.alarmTime;
  nextAlarmTitle.textContent = `${nextEvent.title} için`;
  nextCountdown.textContent = `${alarmMinutes} dk önce`;

  for (const event of events) {
    const card = document.createElement("article");
    card.className = "event-card";
    card.innerHTML = `
      <div class="event-time">
        <strong>${event.time}</strong>
        <span>yerel saat</span>
      </div>
      <span class="event-divider" style="--event-color: ${event.color}" aria-hidden="true"></span>
      <div class="event-info">
        <div class="event-card-top">
          <h3>${event.title}</h3>
          <span class="alarm-chip">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
              <path d="M10 21h4" />
            </svg>
            ${event.alarmTime}
          </span>
        </div>
        <p class="event-location">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          ${event.location}
        </p>
      </div>`;
    eventList.append(card);
  }
}

function renderAlarms() {
  alarmsList.replaceChildren();
  const alarms = [];

  for (let offset = 0; offset < 5; offset += 1) {
    const date = addDays(startOfDay(new Date()), offset);
    const events = eventsForDate(date);
    if (events.length === 0) continue;

    const heading = document.createElement("h3");
    heading.className = "alarm-date-heading";
    heading.textContent = offset === 0
      ? "Bugün"
      : offset === 1
        ? `Yarın · ${fullDateFormatter.format(date)}`
        : fullDateFormatter.format(date);
    alarmsList.append(heading);

    for (const event of events) {
      alarms.push(event);
      const card = document.createElement("article");
      card.className = "event-card";
      card.innerHTML = `
        <div class="event-time">
          <strong>${event.alarmTime}</strong>
          <span>alarm</span>
        </div>
        <span class="event-divider" style="--event-color: ${event.color}" aria-hidden="true"></span>
        <div class="event-info">
          <div class="event-card-top">
            <h3>${event.title}</h3>
            <span class="alarm-chip">Etkinlik ${event.time}</span>
          </div>
          <p class="event-location">${event.location}</p>
        </div>`;
      alarmsList.append(card);
    }
  }

  alarmTotal.textContent = `${alarms.length} alarm`;
  if (alarms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Önümüzdeki günlerde kurulu alarm yok.";
    alarmsList.append(empty);
  }
}

function updateAlarmPreview() {
  const isCustom = alarmPreset.value === "custom";
  customTime.hidden = !isCustom;
  const minutes = isCustom ? Number(customMinutesInput.value) : Number(alarmPreset.value);
  const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;

  alarmPreview.textContent = validMinutes
    ? `Alarm etkinlikten ${minutes} dakika önce çalacak.`
    : "Lütfen 1 ile 1440 arasında bir dakika değeri gir.";
  saveAlarmButton.disabled = !validMinutes || minutes === alarmMinutes;
}

function syncAlarmSettingControls() {
  const hasPreset = [5, 10, 15, 30, 60].includes(alarmMinutes);
  alarmPreset.value = hasPreset ? String(alarmMinutes) : "custom";
  customMinutesInput.value = String(alarmMinutes);
  updateAlarmPreview();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

todayLabel.textContent = fullDateFormatter.format(new Date()).toLocaleUpperCase("tr-TR");
syncAlarmSettingControls();
renderDates();
renderEvents();

document.querySelector("#today-button").addEventListener("click", () => {
  selectedDate = startOfDay(new Date());
  renderDates();
  renderEvents();
  showToast("Bugünün takvimine döndün.");
});

document.querySelector("#refresh-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.classList.add("is-refreshing");
  renderDates();
  renderEvents();
  setTimeout(() => button.classList.remove("is-refreshing"), 650);
  showToast("Demo takvimi yenilendi.");
});

document.querySelectorAll(".tab-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-item").forEach((tab) => tab.classList.remove("is-active"));
    button.classList.add("is-active");
    document.querySelectorAll("[data-page-content]").forEach((section) => {
      section.hidden = section.dataset.pageContent !== button.dataset.tab;
    });
    if (button.dataset.tab === "alarms") renderAlarms();
    if (button.dataset.tab === "settings") syncAlarmSettingControls();
});
  });

  alarmPreset.addEventListener("change", updateAlarmPreview);
  customMinutesInput.addEventListener("input", updateAlarmPreview);
  saveAlarmButton.addEventListener("click", () => {
    const minutes = alarmPreset.value === "custom"
      ? Number(customMinutesInput.value)
      : Number(alarmPreset.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      updateAlarmPreview();
      return;
    }

    alarmMinutes = minutes;
    localStorage.setItem("alarmsis.alarmLeadTimeMinutes", String(minutes));
    renderEvents();
    renderAlarms();
    updateAlarmPreview();
    showToast(`Otomatik alarm ${minutes} dakika öncesine ayarlandı.`);
  });
