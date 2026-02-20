const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { db, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// --- Image Upload ---
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// --- Translation ---
app.post('/api/translate', async (req, res) => {
  const { text, from, to } = req.body;
  if (!text || !from || !to) return res.status(400).json({ error: 'text, from, to required' });

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translated = data[0].map(s => s[0]).join('');
    res.json({ translated });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed', translated: text });
  }
});

// --- Labels ---
app.get('/api/labels', async (req, res) => {
  const result = await db.execute('SELECT * FROM labels ORDER BY id');
  res.json(result.rows);
});

app.post('/api/labels', async (req, res) => {
  const { name_he, name_en, emoji } = req.body;
  if (!name_he || !name_en) return res.status(400).json({ error: 'name_he and name_en are required' });
  const result = await db.execute({
    sql: 'INSERT INTO labels (name_he, name_en, emoji) VALUES (?, ?, ?)',
    args: [name_he, name_en, emoji || ''],
  });
  res.json({ id: Number(result.lastInsertRowid), name_he, name_en, emoji: emoji || '' });
});

// --- Fuzzy Search Helpers ---
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatchesLabel(token, label) {
  const lower = token.toLowerCase();
  const nameEn = label.name_en.toLowerCase();
  const nameHe = label.name_he;

  if (nameEn === lower || nameHe === token) return { match: true, score: 100 };
  if (nameEn.includes(lower) || lower.includes(nameEn) || nameHe.includes(token)) return { match: true, score: 80 };
  const maxDist = lower.length <= 4 ? 1 : 2;
  const distEn = levenshtein(lower, nameEn);
  const distHe = levenshtein(token, nameHe);
  if (distEn <= maxDist) return { match: true, score: 60 - distEn * 10 };
  if (distHe <= maxDist) return { match: true, score: 60 - distHe * 10 };

  return { match: false, score: 0 };
}

function fuzzyMatchesIngredient(token, ingredientsJson) {
  const lower = token.toLowerCase();
  let ingredients;
  try { ingredients = JSON.parse(ingredientsJson); } catch { return { match: false, score: 0 }; }

  if (!Array.isArray(ingredients)) return { match: false, score: 0 };

  let bestScore = 0;
  for (const ingr of ingredients) {
    const name = (typeof ingr === 'string' ? ingr : ingr.name || '').toLowerCase();
    if (!name) continue;

    if (name === lower) { bestScore = Math.max(bestScore, 100); continue; }
    if (name.includes(lower) || lower.includes(name)) { bestScore = Math.max(bestScore, 80); continue; }
    const maxDist = lower.length <= 4 ? 1 : 2;
    const dist = levenshtein(lower, name);
    if (dist <= maxDist) { bestScore = Math.max(bestScore, 60 - dist * 10); }
  }

  return { match: bestScore > 0, score: bestScore };
}

// --- Recipes ---
app.get('/api/recipes', async (req, res) => {
  const { labels: labelParam, ingredients, tried, search } = req.query;

  if (search || ingredients) {
    let sql = 'SELECT DISTINCT r.* FROM recipes r';
    const joins = [];
    const conditions = [];
    const params = [];

    if (labelParam) {
      const labelIds = labelParam.split(',').map(Number).filter(Boolean);
      for (let i = 0; i < labelIds.length; i++) {
        const alias = `rl${i}`;
        joins.push(`JOIN recipe_labels ${alias} ON r.id = ${alias}.recipe_id AND ${alias}.label_id = ?`);
        params.push(labelIds[i]);
      }
    }

    if (tried !== undefined) {
      conditions.push('r.tried = ?');
      params.push(tried === 'true' || tried === '1' ? 1 : 0);
    }

    if (joins.length > 0) sql += ' ' + joins.join(' ');
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');

    const allRecipesResult = await db.execute({ sql, args: params });
    const allRecipes = allRecipesResult.rows;

    for (const recipe of allRecipes) {
      const labelsResult = await db.execute({
        sql: 'SELECT l.* FROM labels l JOIN recipe_labels rl ON l.id = rl.label_id WHERE rl.recipe_id = ?',
        args: [recipe.id],
      });
      recipe._labels = labelsResult.rows;
    }

    const allLabelsResult = await db.execute('SELECT * FROM labels');
    const allLabels = allLabelsResult.rows;

    const searchTokens = search ? search.split(/[\s,،]+/).map(t => t.trim()).filter(Boolean) : [];
    const ingrTokens = ingredients ? ingredients.split(',').map(t => t.trim()).filter(Boolean) : [];
    const allTokens = [...searchTokens, ...ingrTokens];

    const tokenLabelMatches = {};
    for (const token of allTokens) {
      tokenLabelMatches[token] = [];
      for (const label of allLabels) {
        const result = fuzzyMatchesLabel(token, label);
        if (result.match) {
          tokenLabelMatches[token].push({ labelId: label.id, score: result.score });
        }
      }
    }

    const scored = allRecipes.map(recipe => {
      let totalScore = 0;
      let allMatch = true;
      const recipeLabelIds = new Set((recipe._labels || []).map(l => l.id));

      for (const token of allTokens) {
        let tokenScore = 0;

        for (const lm of tokenLabelMatches[token]) {
          if (recipeLabelIds.has(lm.labelId)) {
            tokenScore = Math.max(tokenScore, lm.score);
          }
        }

        const titleHe = (recipe.title_he || '').toLowerCase();
        const titleEn = (recipe.title_en || '').toLowerCase();
        const descHe = (recipe.description_he || '').toLowerCase();
        const descEn = (recipe.description_en || '').toLowerCase();
        const lower = token.toLowerCase();

        if (titleHe.includes(lower) || titleEn.includes(lower)) tokenScore = Math.max(tokenScore, 90);
        else if (descHe.includes(lower) || descEn.includes(lower)) tokenScore = Math.max(tokenScore, 70);

        const ingrMatchHe = fuzzyMatchesIngredient(token, recipe.ingredients_he);
        const ingrMatchEn = fuzzyMatchesIngredient(token, recipe.ingredients_en);
        tokenScore = Math.max(tokenScore, ingrMatchHe.score, ingrMatchEn.score);

        if (tokenScore === 0) {
          const maxDist = lower.length <= 4 ? 1 : 2;
          for (const word of titleEn.split(/\s+/)) {
            const dist = levenshtein(lower, word);
            if (dist <= maxDist) tokenScore = Math.max(tokenScore, 50 - dist * 10);
          }
          for (const word of titleHe.split(/\s+/)) {
            const dist = levenshtein(lower, word);
            if (dist <= maxDist) tokenScore = Math.max(tokenScore, 50 - dist * 10);
          }
        }

        if (tokenScore === 0) allMatch = false;
        totalScore += tokenScore;
      }

      return { recipe, totalScore, allMatch };
    });

    const minAvgScore = 30;
    const results = scored
      .filter(s => s.totalScore > 0 && (s.totalScore / allTokens.length) >= minAvgScore)
      .sort((a, b) => {
        if (a.allMatch !== b.allMatch) return b.allMatch - a.allMatch;
        return b.totalScore - a.totalScore;
      })
      .map(s => s.recipe);

    for (const recipe of results) {
      recipe.labels = recipe._labels || [];
      delete recipe._labels;
    }

    return res.json(results);
  }

  // Non-search path (just filters)
  let sql = 'SELECT DISTINCT r.* FROM recipes r';
  const joins = [];
  const conditions = [];
  const params = [];

  if (labelParam) {
    const labelIds = labelParam.split(',').map(Number).filter(Boolean);
    for (let i = 0; i < labelIds.length; i++) {
      const alias = `rl${i}`;
      joins.push(`JOIN recipe_labels ${alias} ON r.id = ${alias}.recipe_id AND ${alias}.label_id = ?`);
      params.push(labelIds[i]);
    }
  }

  if (tried !== undefined) {
    conditions.push('r.tried = ?');
    params.push(tried === 'true' || tried === '1' ? 1 : 0);
  }

  if (joins.length > 0) sql += ' ' + joins.join(' ');
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY r.created_at DESC';

  const recipesResult = await db.execute({ sql, args: params });
  const recipes = recipesResult.rows;

  for (const recipe of recipes) {
    const labelsResult = await db.execute({
      sql: 'SELECT l.* FROM labels l JOIN recipe_labels rl ON l.id = rl.label_id WHERE rl.recipe_id = ?',
      args: [recipe.id],
    });
    recipe.labels = labelsResult.rows;
  }

  res.json(recipes);
});

app.get('/api/recipes/:id', async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT * FROM recipes WHERE id = ?',
    args: [req.params.id],
  });
  const recipe = result.rows[0];
  if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

  const labelsResult = await db.execute({
    sql: 'SELECT l.* FROM labels l JOIN recipe_labels rl ON l.id = rl.label_id WHERE rl.recipe_id = ?',
    args: [recipe.id],
  });
  recipe.labels = labelsResult.rows;
  res.json(recipe);
});

app.post('/api/recipes', async (req, res) => {
  const { title_he, title_en, description_he, description_en, ingredients_he, ingredients_en, instructions_he, instructions_en, image_url, tried, rating, label_ids, nutrition, prep_time, cook_time, servings, course, cuisine, equipment } = req.body;

  if (!title_he && !title_en) return res.status(400).json({ error: 'At least one title is required' });

  const result = await db.execute({
    sql: `INSERT INTO recipes (title_he, title_en, description_he, description_en, ingredients_he, ingredients_en, instructions_he, instructions_en, image_url, tried, rating, nutrition, prep_time, cook_time, servings, course, cuisine, equipment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      title_he || '', title_en || '',
      description_he || '', description_en || '',
      typeof ingredients_he === 'string' ? ingredients_he : JSON.stringify(ingredients_he || []),
      typeof ingredients_en === 'string' ? ingredients_en : JSON.stringify(ingredients_en || []),
      instructions_he || '', instructions_en || '',
      image_url || '',
      tried ? 1 : 0,
      tried && rating != null ? rating : null,
      typeof nutrition === 'string' ? nutrition : JSON.stringify(nutrition || {}),
      prep_time != null ? Number(prep_time) : null,
      cook_time != null ? Number(cook_time) : null,
      servings != null ? Number(servings) : null,
      course || '', cuisine || '',
      typeof equipment === 'string' ? equipment : JSON.stringify(equipment || [])
    ],
  });

  const recipeId = Number(result.lastInsertRowid);

  if (label_ids && label_ids.length > 0) {
    for (const lid of label_ids) {
      await db.execute({
        sql: 'INSERT INTO recipe_labels (recipe_id, label_id) VALUES (?, ?)',
        args: [recipeId, lid],
      });
    }
  }

  res.json({ id: recipeId });
});

app.put('/api/recipes/:id', async (req, res) => {
  const { title_he, title_en, description_he, description_en, ingredients_he, ingredients_en, instructions_he, instructions_en, image_url, tried, rating, label_ids, nutrition, prep_time, cook_time, servings, course, cuisine, equipment } = req.body;

  const existingResult = await db.execute({
    sql: 'SELECT * FROM recipes WHERE id = ?',
    args: [req.params.id],
  });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'Recipe not found' });

  const ingrHe = ingredients_he !== undefined
    ? (typeof ingredients_he === 'string' ? ingredients_he : JSON.stringify(ingredients_he))
    : existing.ingredients_he;
  const ingrEn = ingredients_en !== undefined
    ? (typeof ingredients_en === 'string' ? ingredients_en : JSON.stringify(ingredients_en))
    : existing.ingredients_en;

  const nutVal = nutrition !== undefined
    ? (typeof nutrition === 'string' ? nutrition : JSON.stringify(nutrition))
    : existing.nutrition;
  const equipVal = equipment !== undefined
    ? (typeof equipment === 'string' ? equipment : JSON.stringify(equipment))
    : existing.equipment;

  await db.execute({
    sql: `UPDATE recipes SET
      title_he = ?, title_en = ?, description_he = ?, description_en = ?,
      ingredients_he = ?, ingredients_en = ?, instructions_he = ?, instructions_en = ?,
      image_url = ?, tried = ?, rating = ?,
      nutrition = ?, prep_time = ?, cook_time = ?, servings = ?, course = ?, cuisine = ?, equipment = ?
    WHERE id = ?`,
    args: [
      title_he ?? existing.title_he, title_en ?? existing.title_en,
      description_he ?? existing.description_he, description_en ?? existing.description_en,
      ingrHe, ingrEn,
      instructions_he ?? existing.instructions_he, instructions_en ?? existing.instructions_en,
      image_url ?? existing.image_url,
      tried !== undefined ? (tried ? 1 : 0) : existing.tried,
      tried && rating != null ? rating : (tried === false ? null : existing.rating),
      nutVal,
      prep_time !== undefined ? (prep_time != null ? Number(prep_time) : null) : existing.prep_time,
      cook_time !== undefined ? (cook_time != null ? Number(cook_time) : null) : existing.cook_time,
      servings !== undefined ? (servings != null ? Number(servings) : null) : existing.servings,
      course ?? existing.course,
      cuisine ?? existing.cuisine,
      equipVal,
      req.params.id
    ],
  });

  if (label_ids !== undefined) {
    await db.execute({
      sql: 'DELETE FROM recipe_labels WHERE recipe_id = ?',
      args: [req.params.id],
    });
    if (label_ids.length > 0) {
      for (const lid of label_ids) {
        await db.execute({
          sql: 'INSERT INTO recipe_labels (recipe_id, label_id) VALUES (?, ?)',
          args: [req.params.id, lid],
        });
      }
    }
  }

  res.json({ success: true });
});

app.delete('/api/recipes/:id', async (req, res) => {
  const result = await db.execute({
    sql: 'DELETE FROM recipes WHERE id = ?',
    args: [req.params.id],
  });
  if (result.rowsAffected === 0) return res.status(404).json({ error: 'Recipe not found' });
  res.json({ success: true });
});

// Start server for local dev
if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`FoodDB server running at http://localhost:${PORT}`);
    });
  });
}

module.exports = { app, initDb };
