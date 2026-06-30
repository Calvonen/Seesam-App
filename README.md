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

The Seesam API must be running on port 8000. Configure the API base URL in [app.json](./app.json) under `extra.seesamApiBaseUrl`:

```json
{
  "expo": {
    "extra": {
      "seesamApiBaseUrl": "http://YOUR_SERVER_IP:8000"
    }
  }
}
```

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
