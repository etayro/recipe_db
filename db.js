const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'fooddb.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_he TEXT NOT NULL,
    name_en TEXT NOT NULL,
    emoji TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_he TEXT NOT NULL,
    title_en TEXT NOT NULL,
    description_he TEXT DEFAULT '',
    description_en TEXT DEFAULT '',
    ingredients_he TEXT DEFAULT '[]',
    ingredients_en TEXT DEFAULT '[]',
    instructions_he TEXT DEFAULT '',
    instructions_en TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    tried INTEGER DEFAULT 0,
    rating REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recipe_labels (
    recipe_id INTEGER NOT NULL,
    label_id INTEGER NOT NULL,
    PRIMARY KEY (recipe_id, label_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  );
`);

// Seed labels if empty
const labelCount = db.prepare('SELECT COUNT(*) as count FROM labels').get().count;
if (labelCount === 0) {
  const insertLabel = db.prepare('INSERT INTO labels (name_he, name_en, emoji) VALUES (?, ?, ?)');
  const defaultLabels = [
    ['ארוחת בוקר', 'Breakfast', '☀️'],
    ['ארוחת צהריים', 'Lunch', '🥪'],
    ['ארוחת ערב', 'Dinner', '🍽️'],
    ['קינוח', 'Dessert', '🍰'],
    ['חטיף', 'Snack', '🍿'],
    ['משקה', 'Drink', '🥤'],
    ['איטלקי', 'Italian', '🍝'],
    ['מקסיקני', 'Mexican', '🌮'],
    ['אסייתי', 'Asian', '🥢'],
    ['אמריקאי', 'American', '🍔'],
    ['ים תיכוני', 'Mediterranean', '🫒'],
  ];
  const insertMany = db.transaction((labels) => {
    for (const [he, en, emoji] of labels) {
      insertLabel.run(he, en, emoji);
    }
  });
  insertMany(defaultLabels);
}

// Helper to create ingredient objects
function ingr(qty, unit, name) {
  return { qty, unit, name };
}

// Seed recipes if empty
const recipeCount = db.prepare('SELECT COUNT(*) as count FROM recipes').get().count;
if (recipeCount === 0) {
  const insertRecipe = db.prepare(`
    INSERT INTO recipes (title_he, title_en, description_he, description_en, ingredients_he, ingredients_en, instructions_he, instructions_en, tried, rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecipeLabel = db.prepare('INSERT INTO recipe_labels (recipe_id, label_id) VALUES (?, ?)');

  const getLabel = db.prepare('SELECT id FROM labels WHERE name_en = ?');
  const labelId = (name) => getLabel.get(name).id;

  const seedRecipes = db.transaction(() => {
    // 1. American Pancakes
    let r = insertRecipe.run(
      'פנקייק אמריקאי', 'American Pancakes',
      'פנקייקים רכים ואוורירים לארוחת בוקר מושלמת', 'Fluffy and airy pancakes for the perfect breakfast',
      JSON.stringify([
        ingr(200, 'g', 'קמח'), ingr(2, 'pcs', 'ביצים'), ingr(250, 'ml', 'חלב'),
        ingr(2, 'tbsp', 'סוכר'), ingr(1, 'tsp', 'אבקת אפייה'), ingr(30, 'g', 'חמאה'), ingr(0.5, 'tsp', 'מלח')
      ]),
      JSON.stringify([
        ingr(200, 'g', 'flour'), ingr(2, 'pcs', 'eggs'), ingr(250, 'ml', 'milk'),
        ingr(2, 'tbsp', 'sugar'), ingr(1, 'tsp', 'baking powder'), ingr(30, 'g', 'butter'), ingr(0.5, 'tsp', 'salt')
      ]),
      'מערבבים את המרכיבים היבשים. מוסיפים ביצים, חלב וחמאה מומסת. מטגנים על מחבת חמה עד שמופיעות בועות, הופכים ומטגנים עוד דקה.',
      'Mix dry ingredients. Add eggs, milk, and melted butter. Cook on a hot pan until bubbles appear, flip and cook another minute.',
      1, 8
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Breakfast'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('American'));

    // 2. Beef Tacos
    r = insertRecipe.run(
      'טאקו בשר', 'Beef Tacos',
      'טאקו מקסיקני קלאסי עם בשר טחון מתובל', 'Classic Mexican tacos with seasoned ground beef',
      JSON.stringify([
        ingr(500, 'g', 'בשר טחון'), ingr(8, 'pcs', 'טורטייה'), ingr(1, 'pcs', 'בצל'),
        ingr(2, 'pcs', 'עגבניות'), ingr(0.5, 'cup', 'כוסברה'), ingr(2, 'pcs', 'לימון'),
        ingr(1, 'pcs', 'אבוקדו'), ingr(100, 'ml', 'שמנת חמוצה')
      ]),
      JSON.stringify([
        ingr(500, 'g', 'ground beef'), ingr(8, 'pcs', 'tortillas'), ingr(1, 'pcs', 'onion'),
        ingr(2, 'pcs', 'tomatoes'), ingr(0.5, 'cup', 'cilantro'), ingr(2, 'pcs', 'lime'),
        ingr(1, 'pcs', 'avocado'), ingr(100, 'ml', 'sour cream')
      ]),
      'מטגנים בשר טחון עם תבלינים. ממלאים טורטיות עם הבשר ומוסיפים תוספות לפי הטעם.',
      'Brown ground beef with spices. Fill tortillas with meat and add toppings to taste.',
      1, 9.5
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Dinner'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Mexican'));

    // 3. Pasta Carbonara
    r = insertRecipe.run(
      'פסטה קרבונרה', 'Pasta Carbonara',
      'פסטה איטלקית קלאסית עם רוטב ביצים ופנצ\'טה', 'Classic Italian pasta with egg sauce and pancetta',
      JSON.stringify([
        ingr(400, 'g', 'ספגטי'), ingr(200, 'g', 'פנצ\'טה'), ingr(3, 'pcs', 'ביצים'),
        ingr(100, 'g', 'פרמזן'), ingr(1, 'tsp', 'פלפל שחור'), ingr(1, 'tsp', 'מלח')
      ]),
      JSON.stringify([
        ingr(400, 'g', 'spaghetti'), ingr(200, 'g', 'pancetta'), ingr(3, 'pcs', 'eggs'),
        ingr(100, 'g', 'parmesan'), ingr(1, 'tsp', 'black pepper'), ingr(1, 'tsp', 'salt')
      ]),
      'מבשלים פסטה. מטגנים פנצ\'טה. מערבבים ביצים עם פרמזן. מוסיפים את הפסטה החמה לפנצ\'טה ואז את תערובת הביצים.',
      'Cook pasta. Fry pancetta. Mix eggs with parmesan. Add hot pasta to pancetta, then toss with egg mixture.',
      1, 9
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Dinner'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Italian'));

    // 4. Caesar Salad
    r = insertRecipe.run(
      'סלט קיסר', 'Caesar Salad',
      'סלט קלאסי עם רוטב קיסר ביתי וקרוטונים', 'Classic salad with homemade Caesar dressing and croutons',
      JSON.stringify([
        ingr(1, 'pcs', 'חסה רומית'), ingr(100, 'g', 'קרוטונים'), ingr(50, 'g', 'פרמזן'),
        ingr(4, 'pcs', 'אנשובי'), ingr(2, 'pcs', 'שום'), ingr(1, 'pcs', 'לימון'),
        ingr(1, 'tsp', 'חרדל'), ingr(3, 'tbsp', 'שמן זית'), ingr(1, 'pcs', 'ביצה')
      ]),
      JSON.stringify([
        ingr(1, 'pcs', 'romaine lettuce'), ingr(100, 'g', 'croutons'), ingr(50, 'g', 'parmesan'),
        ingr(4, 'pcs', 'anchovies'), ingr(2, 'pcs', 'garlic cloves'), ingr(1, 'pcs', 'lemon'),
        ingr(1, 'tsp', 'mustard'), ingr(3, 'tbsp', 'olive oil'), ingr(1, 'pcs', 'egg')
      ]),
      'מכינים רוטב מאנשובי, שום, לימון, חרדל וביצה. קורעים חסה, מוסיפים קרוטונים ופרמזן ומערבבים עם הרוטב.',
      'Make dressing from anchovies, garlic, lemon, mustard, and egg. Tear lettuce, add croutons and parmesan, toss with dressing.',
      1, 6.5
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Lunch'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Mediterranean'));

    // 5. Mango Smoothie
    r = insertRecipe.run(
      'סמוזי מנגו', 'Mango Smoothie',
      'שייק מנגו מרענן ובריא', 'Refreshing and healthy mango shake',
      JSON.stringify([
        ingr(1, 'pcs', 'מנגו'), ingr(1, 'pcs', 'בננה'), ingr(200, 'ml', 'יוגורט'),
        ingr(1, 'tbsp', 'דבש'), ingr(100, 'g', 'קרח')
      ]),
      JSON.stringify([
        ingr(1, 'pcs', 'mango'), ingr(1, 'pcs', 'banana'), ingr(200, 'ml', 'yogurt'),
        ingr(1, 'tbsp', 'honey'), ingr(100, 'g', 'ice')
      ]),
      'שמים את כל המרכיבים בבלנדר וטוחנים עד לקבלת מרקם חלק.',
      'Put all ingredients in a blender and blend until smooth.',
      1, 7.5
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Drink'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Snack'));

    // 6. Homemade Hummus
    r = insertRecipe.run(
      'חומוס ביתי', 'Homemade Hummus',
      'חומוס קרמי וחלק כמו בחומוסייה', 'Creamy and smooth hummus just like the hummus shop',
      JSON.stringify([
        ingr(400, 'g', 'חומוס מבושל'), ingr(3, 'tbsp', 'טחינה'), ingr(1, 'pcs', 'לימון'),
        ingr(2, 'pcs', 'שום'), ingr(0.5, 'tsp', 'כמון'), ingr(0.5, 'tsp', 'מלח'),
        ingr(2, 'tbsp', 'שמן זית'), ingr(50, 'ml', 'מים קרים')
      ]),
      JSON.stringify([
        ingr(400, 'g', 'cooked chickpeas'), ingr(3, 'tbsp', 'tahini'), ingr(1, 'pcs', 'lemon'),
        ingr(2, 'pcs', 'garlic cloves'), ingr(0.5, 'tsp', 'cumin'), ingr(0.5, 'tsp', 'salt'),
        ingr(2, 'tbsp', 'olive oil'), ingr(50, 'ml', 'cold water')
      ]),
      'טוחנים חומוס עם טחינה, לימון, שום וכמון. מוסיפים מים קרים בהדרגה עד לקבלת מרקם חלק וקרמי. מגישים עם שמן זית.',
      'Blend chickpeas with tahini, lemon, garlic, and cumin. Gradually add cold water until smooth and creamy. Serve with olive oil.',
      1, 10
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Snack'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Mediterranean'));

    // 7. Sushi Roll
    r = insertRecipe.run(
      'סושי רול', 'Sushi Roll',
      'רול סושי ביתי עם סלמון ואבוקדו', 'Homemade sushi roll with salmon and avocado',
      JSON.stringify([
        ingr(300, 'g', 'אורז סושי'), ingr(4, 'pcs', 'אצות נורי'), ingr(200, 'g', 'סלמון'),
        ingr(1, 'pcs', 'אבוקדו'), ingr(1, 'pcs', 'מלפפון'), ingr(2, 'tbsp', 'חומץ אורז'),
        ingr(2, 'tbsp', 'סויה'), ingr(1, 'tsp', 'וואסבי')
      ]),
      JSON.stringify([
        ingr(300, 'g', 'sushi rice'), ingr(4, 'pcs', 'nori seaweed'), ingr(200, 'g', 'salmon'),
        ingr(1, 'pcs', 'avocado'), ingr(1, 'pcs', 'cucumber'), ingr(2, 'tbsp', 'rice vinegar'),
        ingr(2, 'tbsp', 'soy sauce'), ingr(1, 'tsp', 'wasabi')
      ]),
      'מבשלים אורז סושי עם חומץ. פורסים על גיליון נורי, מוסיפים מילוי ומגלגלים. חותכים לפרוסות.',
      'Cook sushi rice with vinegar. Spread on nori sheet, add filling and roll. Cut into slices.',
      0, null
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Dinner'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Asian'));

    // 8. Chocolate Brownies
    r = insertRecipe.run(
      'בראוניז שוקולד', 'Chocolate Brownies',
      'בראוניז שוקולד עשירים ולחים', 'Rich and moist chocolate brownies',
      JSON.stringify([
        ingr(200, 'g', 'שוקולד מריר'), ingr(150, 'g', 'חמאה'), ingr(200, 'g', 'סוכר'),
        ingr(3, 'pcs', 'ביצים'), ingr(100, 'g', 'קמח'), ingr(30, 'g', 'קקאו'),
        ingr(1, 'tsp', 'וניל'), ingr(0.5, 'tsp', 'מלח')
      ]),
      JSON.stringify([
        ingr(200, 'g', 'dark chocolate'), ingr(150, 'g', 'butter'), ingr(200, 'g', 'sugar'),
        ingr(3, 'pcs', 'eggs'), ingr(100, 'g', 'flour'), ingr(30, 'g', 'cocoa'),
        ingr(1, 'tsp', 'vanilla'), ingr(0.5, 'tsp', 'salt')
      ]),
      'ממיסים שוקולד עם חמאה. מערבבים סוכר וביצים. מוסיפים קמח וקקאו. אופים ב-180 מעלות 25 דקות.',
      'Melt chocolate with butter. Mix sugar and eggs. Add flour and cocoa. Bake at 180°C for 25 minutes.',
      1, 8.5
    );
    insertRecipeLabel.run(r.lastInsertRowid, labelId('Dessert'));
    insertRecipeLabel.run(r.lastInsertRowid, labelId('American'));
  });

  seedRecipes();
}

module.exports = db;
