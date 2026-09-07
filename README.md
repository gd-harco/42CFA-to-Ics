# CFA42 - Export semaines ecole (.ics)

Extension Firefox qui exporte les periodes d'ecole du calendrier CFA 42 vers un fichier calendrier au format ICS, importable dans Google Calendar, Outlook, Apple Calendar et la plupart des agendas.

## Fonctionnement

L'extension s'execute uniquement sur `https://cfa.42.fr/students/calendars`.

- Elle repere les cellules du calendrier ayant la classe `bg-accent`.
- Chaque cellule fournit une date avec son attribut `data-day`, par exemple `2025-11-27`.
- Les jours proches sont regroupes en une meme periode; un week-end entre deux jours ecole reste dans la periode.
- Le fichier telecharge est nomme `semaines-ecole-<username>.ics`.
- Le nom d'utilisateur est lu dans le `localStorage` de CFA42, dans le profil OIDC. Il n'est pas envoye par l'extension.

Un evenement ICS est cree par periode continue, et non par jour. Une semaine dont seul le lundi est identifie comme ecole produit donc un evenement d'une journee.

## Installation

1. Ouvrir `about:debugging#/runtime/this-firefox` dans Firefox.
2. Cliquer sur **Charger un module complementaire temporaire...**.
3. Selectionner le fichier `manifest.json` de ce dossier.
4. Epinglez l'extension depuis la barre d'outils si necessaire.

Apres une modification des fichiers, rechargez l'extension depuis `about:debugging`.

## Utilisation

1. Se connecter a CFA42.
2. Ouvrir la page du calendrier: `https://cfa.42.fr/students/calendars`.
3. Ouvrir le popup de l'extension.
4. Cliquer sur **Extraire et generer le .ics**.
5. Importer le fichier ICS telecharge dans l'agenda souhaite.

Les evenements sont des evenements sur une journee entiere. Ils contiennent egalement l'emplacement et les coordonnees de 42 Lyon Auvergne-Rhone-Alpes.

## Depannage

### Aucun jour ecole detecte

Le site peut modifier ses classes CSS. Le popup affiche alors les classes `bg-*` trouvees. Dans `popup.js`, adaptez la constante suivante dans `extractSchoolWeeks`:

```js
const STATUS_CLASS = "bg-accent";
```

Par exemple, remplacez `bg-accent` par la classe correspondant au statut que vous souhaitez exporter.

### Nom d'utilisateur inconnu

Le nom est lu avec la cle de stockage suivante:

```text
oidc.user:https://auth.42.fr/auth/realms/students-42:frontend-react
```

Reconnectez-vous a CFA42 si le popup affiche `Utilisateur : inconnu`. L'export du calendrier reste disponible meme sans nom d'utilisateur.

## Permissions

- `activeTab`: identifie l'onglet actif au clic.
- `scripting`: execute l'extraction dans la page du calendrier.
- `https://cfa.42.fr/*`: autorise l'execution sur CFA42.

## Limites

L'extension depend de la structure HTML et des classes CSS exposees par CFA42. Si le calendrier est modifie, l'extraction peut devoir etre ajustee dans `popup.js`.