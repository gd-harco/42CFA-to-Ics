const addYearBtn = document.getElementById("addYear");
const downloadBtn = document.getElementById("download");
const statusMessage = document.getElementById("status");
const SAVED_DAYS_STORAGE_KEY = "cfa42-accumulated-school-days";
const SAVED_USERNAME_STORAGE_KEY = "cfa42-username";

function loadSavedDays() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_DAYS_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

addYearBtn.addEventListener("click", async () => {
  addYearBtn.disabled = true;
  statusMessage.textContent = "Extraction en cours...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (
      !tab ||
      !tab.url ||
      !tab.url.startsWith("https://cfa.42.fr/students/calendars")
    ) {
      statusMessage.textContent =
        "Ouvre d'abord https://cfa.42.fr/students/calendars (connecté) dans l'onglet actif.";
      addYearBtn.disabled = false;
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSchoolWeeks,
    });

    if (!result || result.schoolDays.length === 0) {
      statusMessage.textContent =
        "Aucun jour école détecté. Classes bg-* trouvées sur la page :\n" +
        (result?.debugClasses?.join("\n") || "(aucune)") +
        "\n\nSi 'bg-accent' n'apparaît pas dans cette liste, la couleur/classe a changé — ajuste STATUS_CLASS dans popup.js (fonction extractSchoolWeeks).";
      addYearBtn.disabled = false;
      return;
    }

    const allDays = Array.from(
      new Set([...loadSavedDays(), ...result.schoolDays]),
    ).sort();
    localStorage.setItem(SAVED_DAYS_STORAGE_KEY, JSON.stringify(allDays));
    if (result.username) {
      localStorage.setItem(SAVED_USERNAME_STORAGE_KEY, result.username);
    }

    statusMessage.textContent =
      `OK — ${result.schoolDays.length} jours école trouvés pour l'année ${result.year} (${allDays.length} au total accumulés).\n\n` +
      'Change l\'année sur la page CFA42 puis reclique sur "Ajouter l\'année affichée" pour continuer, ou clique sur "Télécharger le .ics complet" pour générer le fichier.';
  } catch (err) {
    statusMessage.textContent = "Erreur : " + err.message;
  } finally {
    addYearBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  const allDays = loadSavedDays();
  if (allDays.length === 0) {
    statusMessage.textContent =
      "Aucune donnée accumulée. Clique d'abord sur \"Ajouter l'année affichée\" sur la page du calendrier CFA42.";
    return;
  }

  const username =
    localStorage.getItem(SAVED_USERNAME_STORAGE_KEY) || "inconnu";
  const filename = `semaines-ecole-${username}.ics`;
  const ics = buildICS(allDays, username);
  downloadICS(ics, filename);
  statusMessage.textContent = `OK — ${allDays.length} jours école exportés dans ${filename}\nUtilisateur : ${username}`;
});

// ---- Cette fonction est sérialisée et exécutée DANS la page cfa.42.fr ----
// Elle doit être 100% autonome (pas de référence à des variables externes).
//
// Chaque jour est une div avec un title du type
// "lundi 5 janvier · École sur site\n7h31 / 7 h". On lit le jour et le mois
// directement dans ce texte plutôt que de déduire le mois de la position du
// bloc "grid-cols-7" dans la page : cette dernière approche s'est révélée
// non fiable (un bloc en trop/en moins dans le DOM réel décale tous les
// mois suivants). Seul le statut du jour est détecté via sa classe de
// couleur (bg-accent), pour rester indépendant de la langue du texte du
// title.
//
// L'onglet année (boutons role="tab") ne peut pas être changé de façon
// fiable par un clic programmatique (l'appli ne réagit pas toujours à un
// clic synthétique). On lit donc uniquement l'année actuellement affichée
// à l'écran ; pour les autres années, l'utilisateur change l'onglet
// manuellement puis relance l'extraction (les résultats sont cumulés).
async function extractSchoolWeeks() {
  const STATUS_CLASS = "bg-accent"; // <- change ici pour exporter un autre statut (voir la légende de couleurs sur la page)
  const OIDC_STORAGE_KEY =
    "oidc.user:https://auth.42.fr/auth/realms/students-42:frontend-react";
  let username = null;

  try {
    const storedUser = localStorage.getItem(OIDC_STORAGE_KEY);
    username = storedUser
      ? JSON.parse(storedUser)?.profile?.preferred_username
      : null;
  } catch {
    username = null;
  }

  const MONTHS = {
    janvier: 1,
    février: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    août: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    décembre: 12,
  };
  const pad = (n) => String(n).padStart(2, "0");

  // Lit les cellules jour actuellement affichées dans le DOM pour l'année donnée.
  function readVisibleDays(year) {
    const days = [];
    const debugClasses = new Set();

    for (const cell of document.querySelectorAll("div[title]")) {
      const title = cell.getAttribute("title");
      if (!title || !title.includes(" · ")) continue;

      const tokens = title.split(" · ")[0].trim().split(/\s+/);
      const dayNum = parseInt(tokens[1], 10);
      const month = MONTHS[tokens[2]?.toLowerCase()];
      if (!dayNum || !month) continue;

      const bgMatch = cell.className.match(/\bbg-[\w-]+/);
      debugClasses.add(bgMatch ? bgMatch[0] : "(pas de classe bg-*)");

      if (cell.classList.contains(STATUS_CLASS)) {
        days.push(`${year}-${pad(month)}-${pad(dayNum)}`);
      }
    }

    return { days, debugClasses };
  }

  // Attend que le nombre de cellules jour (avec title) de chaque bloc mois
  // soit identique sur deux lectures consécutives, signe que les données
  // asynchrones du calendrier ont fini de se charger.
  async function waitForStableGrids(timeoutMs = 5000) {
    const start = Date.now();
    let lastSignature = null;
    let stableReads = 0;

    while (Date.now() - start < timeoutMs) {
      const signature = Array.from(
        document.querySelectorAll("div.grid.grid-cols-7"),
      )
        .map((g) => g.querySelectorAll("div[title]").length)
        .join(",");

      if (signature && signature === lastSignature) {
        stableReads++;
        if (stableReads >= 2) return;
      } else {
        stableReads = 0;
      }
      lastSignature = signature;
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  // Année actuellement affichée : onglet actif du sélecteur d'année, sinon
  // année en cours (cas où la page n'a pas ce sélecteur).
  const yearTabs = Array.from(
    document.querySelectorAll('button[role="tab"]'),
  ).filter((b) => /^\d{4}$/.test(b.textContent.trim()));
  const activeYearTab = yearTabs.find(
    (b) =>
      b.getAttribute("data-state") === "active" ||
      b.getAttribute("aria-selected") === "true",
  );
  const year = activeYearTab
    ? parseInt(activeYearTab.textContent.trim(), 10)
    : new Date().getFullYear();

  await waitForStableGrids();
  const { days, debugClasses } = readVisibleDays(year);

  return {
    schoolDays: Array.from(new Set(days)).sort(),
    debugClasses: Array.from(debugClasses),
    username,
    year,
  };
}

// Regroupe les jours consécutifs (en tolérant un trou de weekend) en plages,
// puis génère un .ics avec un VEVENT "journée entière" par plage.
function buildICS(dateStrings, username) {
  const dates = dateStrings
    .map((d) => new Date(d + "T00:00:00Z"))
    .sort((a, b) => a - b);

  const fmtStamp = (d) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const ranges = [];
  let start = dates[0];
  let prev = dates[0];

  for (let i = 1; i < dates.length; i++) {
    const d = dates[i];
    const diffDays = (d - prev) / 86400000;
    if (diffDays > 3) {
      ranges.push([start, prev]);
      start = d;
    }
    prev = d;
  }
  ranges.push([start, prev]);

  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Semaine Ecole 42 ${username} //FR\r\n`;
  ranges.forEach(([s, e], i) => {
    const dtStart = fmt(s);
    const dtEnd = fmt(addDays(e, 1)); // DTEND exclusif pour un événement journée entière
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:cfa42-school-${dtStart}-${i}@local\r\n`;
    ics += `DTSTAMP:${fmtStamp(new Date())}\r\n`;
    ics += `DTSTART;VALUE=DATE:${dtStart}\r\n`;
    ics += `DTEND;VALUE=DATE:${dtEnd}\r\n`;
    ics += "LOCATION:42 Lyon Auvergne-Rhône-Alpes\r\n";
    ics += "GEO:45.78133100589248;4.747675806477145\r\n";
    ics += "SUMMARY:Semaine école\r\n";
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR\r\n";
  return ics;
}

function downloadICS(ics, filename) {
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
