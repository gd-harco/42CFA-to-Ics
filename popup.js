const btn = document.getElementById("extract");
const statusMessage = document.getElementById("status");
const startMonthInput = document.getElementById("startMonth");

const START_MONTH_STORAGE_KEY = "cfa42-contract-start-month";
const savedStartMonth = localStorage.getItem(START_MONTH_STORAGE_KEY);
if (savedStartMonth) startMonthInput.value = savedStartMonth;

btn.addEventListener("click", async () => {
  btn.disabled = true;
  statusMessage.textContent = "Extraction en cours...";

  try {
    const contractStartMonth = Math.min(
      12,
      Math.max(1, parseInt(startMonthInput.value, 10) || 1),
    );
    localStorage.setItem(START_MONTH_STORAGE_KEY, String(contractStartMonth));

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
      btn.disabled = false;
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSchoolWeeks,
      args: [contractStartMonth],
    });

    if (!result || result.schoolDays.length === 0) {
      statusMessage.textContent =
        "Aucun jour école détecté. Classes bg-* trouvées sur la page :\n" +
        (result?.debugClasses?.join("\n") || "(aucune)") +
        "\n\nSi 'bg-accent' n'apparaît pas dans cette liste, la couleur/classe a changé — ajuste STATUS_CLASS dans popup.js (fonction extractSchoolWeeks).";
      btn.disabled = false;
      return;
    }

    const username = result.username || "inconnu";
    const filename = `semaines-ecole-${username}.ics`;
    const ics = buildICS(result.schoolDays, username);
    downloadICS(ics, filename);
    statusMessage.textContent = `OK — ${result.schoolDays.length} semaines écoles exportées dans ${filename}\nUtilisateur : ${username}`;
  } catch (err) {
    statusMessage.textContent = "Erreur : " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---- Cette fonction est sérialisée et exécutée DANS la page cfa.42.fr ----
// Elle doit être 100% autonome (pas de référence à des variables externes).
//
// Structure du calendrier (grille annuelle, un bloc <div class="grid grid-cols-7">
// par mois, dans l'ordre janvier -> décembre) :
//   <div title="lundi 5 janvier · École sur site\n7h31 / 7 h" class="... bg-accent ...">5</div>
// Le statut du jour est porté par une classe de couleur (voir la légende
// ajoutée sous le sélecteur d'année, ex: bg-accent = École sur site,
// bg-success = École à distance, bg-warning = Jour entreprise,
// bg-purple-500 = Jour férié). On se base sur cette classe plutôt que sur
// le texte (français) du title, pour rester indépendant de la langue de
// l'utilisateur. Le numéro du jour vient du texte visible de la cellule.
// Le mois est déduit de la position (1-based) du bloc grid-cols-7 dans la
// page, mais un onglet année peut ne pas commencer en janvier (ex: contrat
// d'alternance débutant en cours d'année) : pour l'année la plus ancienne
// affichée, le premier bloc correspond donc à contractStartMonth plutôt qu'à
// janvier. L'année n'apparaît nulle part dans la grille : elle est lue via
// l'onglet actif du sélecteur d'année (boutons role="tab" affichant 4 chiffres).
async function extractSchoolWeeks(contractStartMonth) {
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

  const pad = (n) => String(n).padStart(2, "0");

  // Lit les cellules jour actuellement affichées dans le DOM pour l'année donnée.
  // startMonth: numéro du mois (1-12) du premier bloc grid-cols-7 rencontré.
  function readVisibleDays(year, startMonth) {
    const days = [];
    const debugClasses = new Set();

    const monthGrids = document.querySelectorAll("div.grid.grid-cols-7");
    monthGrids.forEach((grid, index) => {
      const month = startMonth + index;
      if (month > 12) return; // sécurité si d'autres grilles 7 colonnes existent sur la page

      for (const cell of grid.querySelectorAll("div[title]")) {
        const dayNum = parseInt(cell.textContent.trim(), 10);
        if (!dayNum) continue;

        const bgMatch = cell.className.match(/\bbg-[\w-]+/);
        debugClasses.add(bgMatch ? bgMatch[0] : "(pas de classe bg-*)");

        if (cell.classList.contains(STATUS_CLASS)) {
          days.push(`${year}-${pad(month)}-${pad(dayNum)}`);
        }
      }
    });

    return { days, debugClasses };
  }

  // Attend que l'onglet devienne actif et que son contenu se rende.
  async function waitTabActive(btn, timeoutMs = 800) {
    const start = Date.now();
    while (
      btn.getAttribute("data-state") !== "active" &&
      Date.now() - start < timeoutMs
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  const yearTabs = Array.from(
    document.querySelectorAll('button[role="tab"]'),
  ).filter((b) => /^\d{4}$/.test(b.textContent.trim()));

  const schoolDays = [];
  const debugStatuses = new Set();

  if (yearTabs.length === 0) {
    // Pas de sélecteur d'année trouvé : on lit directement le contenu affiché.
    const { days, debugClasses } = readVisibleDays(
      new Date().getFullYear(),
      contractStartMonth,
    );
    schoolDays.push(...days);
    debugClasses.forEach((s) => debugStatuses.add(s));
  } else {
    const originalActive = yearTabs.find(
      (b) =>
        b.getAttribute("data-state") === "active" ||
        b.getAttribute("aria-selected") === "true",
    );
    const minYear = Math.min(
      ...yearTabs.map((b) => parseInt(b.textContent.trim(), 10)),
    );

    for (const btn of yearTabs) {
      const year = parseInt(btn.textContent.trim(), 10);
      const startMonth = year === minYear ? contractStartMonth : 1;
      btn.click();
      await waitTabActive(btn);
      const { days, debugClasses } = readVisibleDays(year, startMonth);
      schoolDays.push(...days);
      debugClasses.forEach((s) => debugStatuses.add(s));
    }

    if (originalActive) {
      originalActive.click();
      await waitTabActive(originalActive);
    }
  }

  return {
    schoolDays: Array.from(new Set(schoolDays)).sort(),
    debugClasses: Array.from(debugStatuses),
    username,
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
