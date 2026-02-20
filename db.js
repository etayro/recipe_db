const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:./fooddb.sqlite',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Helper to create ingredient objects
function ingr(qty, unit, name) {
  return { qty, unit, name };
}

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_he TEXT NOT NULL,
      name_en TEXT NOT NULL,
      emoji TEXT DEFAULT ''
    )
  `);

  await db.execute(`
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
      nutrition TEXT DEFAULT '{}',
      prep_time INTEGER,
      cook_time INTEGER,
      servings INTEGER,
      course TEXT DEFAULT '',
      cuisine TEXT DEFAULT '',
      equipment TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS recipe_labels (
      recipe_id INTEGER NOT NULL,
      label_id INTEGER NOT NULL,
      PRIMARY KEY (recipe_id, label_id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
    )
  `);

  // Add new columns if they don't exist (for existing databases)
  const newColumns = [
    ['nutrition', "TEXT DEFAULT '{}'"],
    ['prep_time', 'INTEGER'],
    ['cook_time', 'INTEGER'],
    ['servings', 'INTEGER'],
    ['course', "TEXT DEFAULT ''"],
    ['cuisine', "TEXT DEFAULT ''"],
    ['equipment', "TEXT DEFAULT '[]'"],
  ];
  for (const [col, type] of newColumns) {
    try { await db.execute(`ALTER TABLE recipes ADD COLUMN ${col} ${type}`); } catch {}
  }

  // Seed labels if empty
  const labelCountResult = await db.execute('SELECT COUNT(*) as count FROM labels');
  const labelCount = labelCountResult.rows[0].count;
  if (labelCount === 0) {
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
    const stmts = defaultLabels.map(([he, en, emoji]) => ({
      sql: 'INSERT INTO labels (name_he, name_en, emoji) VALUES (?, ?, ?)',
      args: [he, en, emoji],
    }));
    await db.batch(stmts, 'write');
  }

  // Seed recipes if empty
  const recipeCountResult = await db.execute('SELECT COUNT(*) as count FROM recipes');
  const recipeCount = recipeCountResult.rows[0].count;
  if (recipeCount === 0) {
    // Get label IDs
    const labelsResult = await db.execute('SELECT id, name_en FROM labels');
    const labelMap = {};
    for (const row of labelsResult.rows) {
      labelMap[row.name_en] = row.id;
    }
    const labelId = (name) => labelMap[name];

    const seedData = [
      // 1. American Pancakes
      {
        args: [
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
          1, 8,
          JSON.stringify({ calories: '227kcal', carbs: '28g', protein: '7g', fat: '10g', saturated_fat: '5g', fiber: '1g', sugar: '6g', sodium: '450mg', calcium: '150mg' }),
          10, 15, 4, 'Breakfast', 'American',
          JSON.stringify([{ qty: 1, name: 'large mixing bowl' }, { qty: 1, name: 'non-stick frying pan' }, { qty: 1, name: 'spatula' }])
        ],
        labels: ['Breakfast', 'American'],
      },
      // 2. Beef Tacos
      {
        args: [
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
          1, 9.5,
          JSON.stringify({ calories: '385kcal', carbs: '24g', protein: '22g', fat: '23g', saturated_fat: '9g', fiber: '4g', sugar: '3g', sodium: '520mg', potassium: '450mg', calcium: '80mg', iron: '4mg' }),
          15, 20, 4, 'Main Course', 'Mexican',
          JSON.stringify([{ qty: 1, name: 'large frying pan' }, { qty: 1, name: 'cutting board' }])
        ],
        labels: ['Dinner', 'Mexican'],
      },
      // 3. Pasta Carbonara
      {
        args: [
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
          1, 9,
          JSON.stringify({ calories: '520kcal', carbs: '58g', protein: '25g', fat: '20g', saturated_fat: '8g', fiber: '2g', sugar: '2g', sodium: '890mg', calcium: '250mg', iron: '3mg' }),
          10, 20, 4, 'Main Course', 'Italian',
          JSON.stringify([{ qty: 1, name: 'large pot' }, { qty: 1, name: 'frying pan' }, { qty: 1, name: 'mixing bowl' }])
        ],
        labels: ['Dinner', 'Italian'],
      },
      // 4. Caesar Salad
      {
        args: [
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
          1, 6.5,
          JSON.stringify({ calories: '320kcal', carbs: '15g', protein: '12g', fat: '24g', saturated_fat: '5g', mono_fat: '14g', fiber: '3g', sugar: '2g', sodium: '680mg', vitamin_a: '8500IU', vitamin_c: '18mg', calcium: '200mg', iron: '2mg' }),
          20, 5, 2, 'Salad', 'Mediterranean',
          JSON.stringify([{ qty: 1, name: 'large salad bowl' }, { qty: 1, name: 'small blender or mortar' }])
        ],
        labels: ['Lunch', 'Mediterranean'],
      },
      // 5. Mango Smoothie
      {
        args: [
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
          1, 7.5,
          JSON.stringify({ calories: '195kcal', carbs: '42g', protein: '5g', fat: '2g', fiber: '3g', sugar: '35g', vitamin_c: '45mg', calcium: '150mg', potassium: '450mg' }),
          5, 0, 2, 'Drink', 'International',
          JSON.stringify([{ qty: 1, name: 'blender' }, { qty: 1, name: 'tall glass' }])
        ],
        labels: ['Drink', 'Snack'],
      },
      // 6. Homemade Hummus
      {
        args: [
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
          1, 10,
          JSON.stringify({ calories: '166kcal', carbs: '14g', protein: '8g', fat: '10g', mono_fat: '5g', fiber: '4g', sugar: '1g', sodium: '300mg', potassium: '200mg', iron: '3mg', calcium: '50mg' }),
          10, 0, 6, 'Appetizer', 'Mediterranean',
          JSON.stringify([{ qty: 1, name: 'food processor' }])
        ],
        labels: ['Snack', 'Mediterranean'],
      },
      // 7. Sushi Roll
      {
        args: [
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
          0, null,
          JSON.stringify({ calories: '350kcal', carbs: '45g', protein: '18g', fat: '12g', poly_fat: '4g', mono_fat: '5g', fiber: '3g', sugar: '2g', sodium: '750mg', potassium: '300mg', vitamin_a: '400IU', iron: '2mg' }),
          30, 20, 4, 'Main Course', 'Japanese',
          JSON.stringify([{ qty: 1, name: 'bamboo sushi mat' }, { qty: 1, name: 'rice cooker or pot' }, { qty: 1, name: 'sharp knife' }])
        ],
        labels: ['Dinner', 'Asian'],
      },
      // 8. Chocolate Brownies
      {
        args: [
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
          1, 8.5,
          JSON.stringify({ calories: '410kcal', carbs: '45g', protein: '6g', fat: '24g', saturated_fat: '14g', fiber: '3g', sugar: '32g', sodium: '200mg', calcium: '40mg', iron: '4mg' }),
          15, 25, 9, 'Dessert', 'American',
          JSON.stringify([{ qty: 1, name: 'mixing bowl' }, { qty: 1, name: '9x13 inch baking pan' }, { qty: 1, name: 'saucepan' }])
        ],
        labels: ['Dessert', 'American'],
      },
    ];

    const insertSql = `INSERT INTO recipes (title_he, title_en, description_he, description_en, ingredients_he, ingredients_en, instructions_he, instructions_en, tried, rating, nutrition, prep_time, cook_time, servings, course, cuisine, equipment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const recipe of seedData) {
      const result = await db.execute({ sql: insertSql, args: recipe.args });
      const recipeId = result.lastInsertRowid;
      for (const labelName of recipe.labels) {
        await db.execute({
          sql: 'INSERT INTO recipe_labels (recipe_id, label_id) VALUES (?, ?)',
          args: [recipeId, labelId(labelName)],
        });
      }
    }
  }
}

module.exports = { db, initDb };
