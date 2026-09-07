const btn = document.getElementById("extract");
const statusMessage = document.getElementById("status");
const browserApi = globalThis.browser ?? globalThis.chrome;

btn.addEventListener("click", async () => {
  btn.disabled = true;
  statusMessage.textContent = "Extraction en cours...";

  try {
    const [tab] = await browserApi.tabs.query({
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

    const [result] = await browserApi.tabs.executeScript(tab.id, {
      code: `(${extractSchoolWeeks.toString()})();`,
    });

    if (!result || result.schoolDays.length === 0) {
      statusMessage.textContent =
        "Aucun jour école détecté. Classes bg-* trouvées sur la page :\n" +
        (result?.debugClasses?.join("\n") || "(aucune)") +
        "\n\nSi 'bg-accent' n'apparaît pas dans cette liste, le nom de classe a changé — ajuste STATUS_CLASS dans popup.js (fonction extractSchoolWeeks).";
      btn.disabled = false;
      return;
    }

    const username = result.username || "inconnu";
    const filename = `semaines-ecole-${username}.ics`;
    const ics = buildICS(result.schoolDays, username);
    downloadICS(ics, filename);
    statusMessage.textContent = `OK — ${result.schoolDays.length} jours école exportés dans ${filename}\nUtilisateur : ${username}`;
  } catch (err) {
    statusMessage.textContent = "Erreur : " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---- Cette fonction est sérialisée et exécutée DANS la page cfa.42.fr ----
// Elle doit être 100% autonome (pas de référence à des variables externes).
//
// Structure réelle du calendrier (composant react-day-picker) :
//   <td role="gridcell" data-day="2025-11-27" class="... bg-accent ...">
// data-day est déjà au format ISO (YYYY-MM-DD), donc pas besoin de parser
// les en-têtes de mois. Le statut du jour est porté par une classe :
//   bg-accent      -> semaine école (bleu)
//   bg-warning     -> semaine entreprise (orange)
//   bg-purple-500  -> jour spécial / férié
//   bg-grey-300    -> hors périmètre (weekend, jour d'un autre mois, etc.)
function extractSchoolWeeks() {
  const STATUS_CLASS = "bg-accent"; // <- change ici pour exporter un autre statut
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

  const cells = Array.from(document.querySelectorAll("td[data-day]"));
  const schoolDays = [];
  const debugClasses = new Set();

  for (const td of cells) {
    const day = td.getAttribute("data-day");
    if (!day) continue;

    const bgMatch = td.className.match(/\bbg-[\w-]+/);
    debugClasses.add(bgMatch ? bgMatch[0] : "(pas de classe bg-*)");

    if (td.classList.contains(STATUS_CLASS)) {
      schoolDays.push(day);
    }
  }

  return {
    schoolDays: Array.from(new Set(schoolDays)).sort(),
    debugClasses: Array.from(debugClasses),
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
