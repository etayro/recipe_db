# FoodDB - המטבח של הפוכים

## Overview
Hebrew-first RTL recipe database web app with English toggle. 70s retro-modern design. Responsive mobile-first.

## Tech Stack
- **Backend**: Node.js + Express + SQLite (better-sqlite3) + Multer
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Translation**: Google Translate free endpoint (gtx)

## Run
```bash
npm install
node server.js  # http://localhost:3000
# Delete fooddb.sqlite to re-seed with sample data
```

## File Structure
```
server.js          — Express server, API routes, fuzzy search (Levenshtein), translation proxy, image upload
db.js              — SQLite setup, tables, seed data (11 labels with emojis, 8 sample recipes)
public/index.html  — SPA page, RTL default, detail modal + form modal with tabs
public/style.css   — 70s palette (burnt-orange, mustard, avocado, coral), responsive, RTL/LTR
public/app.js      — All frontend: CRUD, search, free-text parser, translation, unit conversion, tabs
public/uploads/    — Uploaded recipe images
```

## Database
- **labels**: id, name_he, name_en, emoji
- **recipes**: id, title_he/en, description_he/en, ingredients_he/en (JSON), instructions_he/en, image_url, tried, rating, created_at
- **recipe_labels**: recipe_id, label_id (junction)

Ingredients stored as JSON: `[{"qty": 200, "unit": "g", "name": "flour"}]`
Units: g, kg, ml, L, tsp, tbsp, cup, pcs

## API
- `GET /api/labels` | `POST /api/labels`
- `GET /api/recipes(?search=&ingredients=&labels=&tried=)` | `GET /api/recipes/:id`
- `POST /api/recipes` | `PUT /api/recipes/:id` | `DELETE /api/recipes/:id`
- `POST /api/upload` — multipart image → /uploads/filename
- `POST /api/translate` — {text, from, to} → {translated}

## Key Features
1. **Language toggle** — HE (RTL) default, EN (LTR) switch. `dir` attr on `<html>`
2. **Free-text paste** (default tab) — `parseFreeText()` auto-detects title/ingredients/instructions
3. **Single-language input** — User fills one language, auto-translates to the other on save
4. **Ingredient quantities** — {qty, unit, name} format. Metric/Imperial toggle in detail view with conversion
5. **Mandatory fields** — Red `*` on Title, Ingredients, Instructions. Client-side validation
6. **Filter chevron** — Down-facing `▼`, rotates 180° when open (CSS `.open` class)
7. **Category emojis** — emoji column on labels, displayed but excluded from search matching
8. **No category tiles** — Filter panel in header is the only label filter
9. **Fuzzy search** — Levenshtein distance backend. Handles typos ("breakfest"→Breakfast). Scoring: exact>substring>fuzzy

## Design
- **Fonts**: Fredoka One (headings), Rubik (body/Hebrew)
- **Colors**: burnt-orange `#D2691E`, mustard `#DAA520`, avocado `#6B8E23`, coral `#E8734A`, cream `#FFF8E7`
- **Responsive**: 1 col mobile → 2 col tablet → 3 col desktop
- Recipe cards have alternating colored side borders

## Seed Labels
☀️ Breakfast, 🥪 Lunch, 🍽️ Dinner, 🍰 Dessert, 🍿 Snack, 🥤 Drink, 🍝 Italian, 🌮 Mexican, 🥢 Asian, 🍔 American, 🫒 Mediterranean
