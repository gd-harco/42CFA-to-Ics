# CFA42 - Export semaines ecole (.ics)

Extension Chrome qui exporte les periodes d'ecole du calendrier CFA 42 vers un fichier calendrier au format ICS, importable dans Google Calendar, Outlook, Apple Calendar et la plupart des agendas.

## Fonctionnement

L'extension s'execute uniquement sur `https://cfa.42.fr/students/calendars`.

- Elle lit la grille annuelle du calendrier: chaque mois est un bloc `div.grid.grid-cols-7`, dans l'ordre janvier -> decembre, et chaque jour y est une `div` avec un attribut `title`.
- Le statut du jour est porte par une classe de couleur (`bg-accent` = Ecole sur site, `bg-success` = Ecole a distance, `bg-warning` = Jour entreprise, `bg-purple-500` = Jour ferie, `bg-grey-*` = Week-end/hors perimetre), visible dans la legende ajoutee sous le selecteur d'annee. L'extraction se base sur cette classe plutot que sur le texte (en francais) du `title`, pour rester independante de la langue de l'utilisateur. Seul le statut `bg-accent` (Ecole sur site) est exporte.
- Le numero du jour est lu depuis le texte visible de la cellule, et le mois depuis la position de son bloc dans la page. L'annee n'apparait pas dans la grille: elle est lue via l'onglet actif du selecteur d'annee (boutons `role="tab"` affichant `2025`, `2026`, ...). L'extension clique automatiquement sur chaque onglet annee pour recuperer toutes les annees disponibles, puis restaure l'onglet initialement actif.
- L'onglet correspondant a la premiere annee du contrat d'alternance ne commence pas forcement en janvier (ex: contrat debutant en septembre). Le popup demande donc le numero du premier mois du contrat (1-12): ce numero est applique au premier bloc mois de l'annee la plus ancienne affichee; les annees suivantes repartent normalement de janvier. La valeur saisie est memorisee dans le popup pour les prochains exports.
- Les jours proches sont regroupes en une meme periode; un week-end entre deux jours ecole reste dans la periode.
- Le fichier telecharge est nomme `semaines-ecole-<username>.ics`.
- Le nom d'utilisateur est lu dans le `localStorage` de CFA42, dans le profil OIDC. Il n'est pas envoye par l'extension.

Un evenement ICS est cree par periode continue, et non par jour. Une semaine dont seul le lundi est identifie comme ecole produit donc un evenement d'une journee.

## Installation

1. Ouvrir `chrome://extensions` dans Chrome ou un navigateur compatible Chromium.
2. Activer le **Mode developpeur**.
3. Cliquer sur **Charger l'extension non empaquetee**.
4. Selectionner ce dossier: `cfa_to_Ics`.
5. Epinglez l'extension depuis la barre d'outils si necessaire.

Apres une modification des fichiers, cliquer sur l'icone de rechargement de l'extension dans `chrome://extensions`.

## Utilisation

1. Se connecter a CFA42.
2. Ouvrir la page du calendrier: `https://cfa.42.fr/students/calendars`.
3. Ouvrir le popup de l'extension.
4. Cliquer sur **Extraire et generer le .ics**.
5. Importer le fichier ICS telecharge dans l'agenda souhaite.

Les evenements sont des evenements sur une journee entiere. Ils contiennent egalement l'emplacement et les coordonnees de 42 Lyon Auvergne-Rhone-Alpes.

## Depannage

### Aucun jour ecole detecte

Le site peut modifier ses classes CSS. Le popup affiche alors les classes `bg-*` trouvees sur les cellules jour. Dans `popup.js`, adaptez la constante suivante dans `extractSchoolWeeks`:

```js
const STATUS_CLASS = "bg-accent";
```

Par exemple, remplacez `bg-accent` par la classe correspondant au statut que vous souhaitez exporter (voir la legende de couleurs affichee sous le selecteur d'annee sur la page).

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
