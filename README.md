# Classic Games

A small arcade of classic browser games, served with a lightweight Express server.

## Games

- Tic Tac Toe
- Tetris
- Snake
- Pong (vs CPU)
- 2048
- Breakout
- Memory Match
- Minesweeper
- Flappy Bird

All games are plain HTML/CSS/JS (canvas-based where relevant) — no build step, no external assets. Each one supports touch controls for mobile and keyboard input on desktop.

## Getting started

### Requirements

- Node.js 18 or newer

### Install

```bash
npm install
```

### Run

```bash
npm start
```

By default the server listens on port `4000`. Open `http://localhost:4000` to see the arcade: a gallery of every game with a live gameplay thumbnail.

## Configuration

The server reads the following environment variables:

| Variable   | Default       | Description                          |
|------------|---------------|---------------------------------------|
| `PORT`     | `4000`        | Port the server listens on            |
| `HOST`     | `0.0.0.0`     | Host/interface to bind to             |
| `NODE_ENV` | `development` | Environment label shown in startup log |

Example:

```bash
PORT=8080 npm start
```

## Deployment

This app is ready to deploy on any Node-friendly host (Render, Railway, Heroku, Fly.io, etc.):

- It binds to `process.env.PORT` and `0.0.0.0`, which is what most platforms require.
- `npm start` is the standard start command most platforms detect automatically.
- A `GET /health` endpoint is available for uptime/health checks.
- Unmatched routes fall back to the landing page instead of a bare 404.

No database or external services are required — it's fully static content served by Express.

## SEO

Page titles, descriptions, social preview tags, structured data (JSON-LD), the home page gallery tiles, `sitemap.xml` and `robots.txt` are generated from two files:

- `seo/games.json`: one entry per game (name, URL, tile shape, search description, thumbnail size)
- `seo/config.json`: site URL, site name, and optional Google/Bing verification codes

After adding a game or editing either file, run:

```bash
npm run seo
```

To add a game: put its page in `public/`, add a gameplay screenshot as `public/thumbs/<id>.webp` and a 1200×630 social image as `public/og/<id>.jpg`, add an entry to `seo/games.json`, then run `npm run seo`. If the site moves to a new domain, change `siteUrl` in `seo/config.json` and re-run.

## Project structure

```
.
├── index.js          # Express server
├── package.json
└── public/           # All game files (static)
    ├── index.html    # Home page: game gallery
    ├── games.html    # Redirects to / (old arcade URL)
    ├── thumbs/       # Gameplay screenshots used by the gallery
    └── *.html        # Individual games
```

## License

MIT
