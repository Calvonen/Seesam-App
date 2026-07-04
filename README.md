# Seesam-App

Seesam-App is a React Native / Expo mobile app for talking to the Seesam API through a retro intercom interface. The main screen is intentionally simple: a speaker grille, status text, text input, and a physical-style push button.

## Requirements

- Node 22
- npm
- Expo Go on your mobile device, or an Expo-compatible simulator/emulator
- Seesam API running on port 8000

## Setup

Install dependencies:

```sh
npm install
```

## Start

Start the Expo development server:

```sh
npx expo start
```

Then open the project in Expo Go or your simulator/emulator.

## Backend

The Seesam API must be running on port 8000. The app tries the LAN API first with a short `/health` check, then falls back to the Tailscale API if LAN is not reachable.

Copy [.env.example](./.env.example) to `.env` if you want to use your own addresses:

```sh
EXPO_PUBLIC_SEESAM_LAN_API_URL=http://192.168.68.75:8000
EXPO_PUBLIC_SEESAM_TAILSCALE_API_URL=http://100.90.126.101:8000
```

At home, the app uses the LAN address without requiring Tailscale on the phone. Outside home, keep Tailscale enabled on the phone so the app can reach the Tailscale address.

Fallbacks can also be configured in [app.json](./app.json) under `extra.lanApiBaseUrl` and `extra.tailscaleApiBaseUrl`.

## Health Check

The service console calls `GET /health` when it is opened and when the user presses `REFRESH`. The endpoint should return JSON with at least these fields:

```json
{
  "server_online": true,
  "memory_file_found": true,
  "ollama": "ok",
  "server_time": "2026-07-01T12:00:00Z",
  "version": "dev"
}
```

Backend expectations:

- `memory_file_found` is `true` only when `memory/marko.local.txt` exists.
- `ollama` is `"ok"` only when `http://127.0.0.1:11434/api/tags` responds successfully.
- If Ollama does not respond, return HTTP 200 with `ollama: "offline"` or an object such as `{ "ok": false }`, so the app can show API online and Ollama offline separately.
- `version` should always be present. Use `"dev"` if no commit or release version is available.

If the `/health` request fails or returns a non-2xx response, the app marks the API server as offline and keeps showing the latest successful connection time.

## Features

- Retro intercom UI
- Physical-style button interaction
- Crackle/static effect while activating
- Chat with the Seesam API
- Hidden service console for server status

## Development Notes

- Keep the normal intercom UI minimal and focused.
- Maintenance mode opens with a long press on the speaker area.
- The hidden service console should stay secondary to the main intercom experience.
