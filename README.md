# JARVIS Phone — Android companion APK

Application Android compagnon de Jarvis Desktop. Permet à l'agent Jarvis qui tourne sur ton PC Windows de prendre la main sur le téléphone via le VPS Jarvis OS (relais HTTPS).

## Build

Le build se fait dans le cloud via GitHub Actions à chaque push sur `main`.

L'APK est disponible :
1. En artifact dans l'onglet **Actions** du repo
2. En release GitHub (auto-créée à chaque build sur main)

## Stack

- **Capacitor 6** (wrapper natif Android)
- **HTML/CSS/JS vanilla** dans `www/` (pas de bundler)
- **Plugins** : Device, Geolocation, LocalNotifications, Network, Preferences, Share

## Permissions Android

Patches automatiques dans le workflow : INTERNET, NOTIFS, LOCATION fine/coarse, RECORD_AUDIO, CAMERA, READ/SEND_SMS, READ_CONTACTS, READ_CALL_LOG, READ_PHONE_STATE, BLUETOOTH_CONNECT, VIBRATE, FOREGROUND_SERVICE, WAKE_LOCK, etc.

## Architecture

```
┌──────────────────┐         ┌────────────────┐         ┌──────────────────┐
│ Jarvis Desktop   │   →     │ Jarvis OS VPS  │    ←    │ Jarvis Phone     │
│ (Windows)        │  HTTPS  │ (Hostinger)    │  HTTPS  │ (Android)        │
└──────────────────┘         │ /api/phones/*  │         │ pairing code     │
                             └────────────────┘         └──────────────────┘
                                     ↑
                              Sidecar API gère
                              les queues de commandes
```

## Pairing

1. Lance l'APK sur Android
2. Va dans **Settings** → renseigne URL VPS Jarvis OS + Bearer token
3. Note le **PAIRING CODE** (6 chars) affiché sur l'écran HOME
4. Dans Jarvis Desktop → Paramètres → TÉLÉPHONE → "Pair par code" → saisis le code

## Commandes supportées

| Type | Action |
|------|--------|
| `notify` | Notification locale (titre + body) |
| `open-url` | Ouvre une URL dans le navigateur |
| `location` | GPS (lat/lon/précision) renvoyé via `/api/results` |
| `speak` | Synthèse vocale (Web Speech API) |
| `vibrate` | Vibration (pattern personnalisable) |
| `info` | Infos device + statut réseau |

## Sécurité

- Bearer token VPS chiffré dans `Capacitor.Preferences` (équivalent EncryptedSharedPreferences)
- Toutes les requêtes en HTTPS
- Pairing code régénérable
- Aucune donnée envoyée à des tiers (seul ton VPS reçoit)

## Roadmap

- Foreground Service pour persister la connexion en arrière-plan
- Background sync de SMS / appels via `READ_SMS` (Android limite cet usage)
- Notification Listener Service pour relayer toutes les notifs vers le PC
- Lecture du flux caméra à distance (via WebRTC)
- Auto-réponse aux SMS via Ollama distant
