// === State ===
let lang = 'he';
let labels = [];
let recipes = [];
let selectedFilterLabels = new Set();
let selectedFormLabels = new Set();
let triedOnly = true;
let searchTimeout = null;
let currentTab = 'freetext';
let formIngredients = [];
let formEquipment = [];
let detailUnitSystem = 'metric'; // 'metric' or 'imperial'
let currentDetailRecipe = null;

// === i18n ===
const translationsCache = {};
let currentTranslations = {};

const LANGUAGES = [
  { code: 'he', name: 'עברית', dir: 'rtl' },
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
  { code: 'ru', name: 'Русский', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'nl', name: 'Nederlands', dir: 'ltr' },
];

function getLangDir(code) {
  const l = LANGUAGES.find(x => x.code === code);
  return l ? l.dir : 'ltr';
}

async function loadTranslations(langCode) {
  if (translationsCache[langCode]) {
    currentTranslations = translationsCache[langCode];
    return;
  }
  try {
    const res = await fetch(`/i18n/${langCode}.json`);
    const data = await res.json();
    translationsCache[langCode] = data;
    currentTranslations = data;
  } catch {
    if (langCode !== 'en') await loadTranslations('en');
  }
}

function t(key) {
  return currentTranslations[key] || key;
}

// === Cookie helpers ===
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name, value, days) {
  const maxAge = days * 86400;
  document.cookie = name + '=' + encodeURIComponent(value) + ';path=/;max-age=' + maxAge;
}

// === On-the-fly recipe translation cache ===
const recipeTranslationCache = {};

async function getRecipeField(recipe, prop) {
  if (lang === 'he' || lang === 'en') {
    return recipe[`${prop}_${lang}`] || recipe[`${prop}_he`] || '';
  }
  const enValue = recipe[`${prop}_en`] || recipe[`${prop}_he`] || '';
  if (!enValue) return '';

  const cacheKey = `${recipe.id}_${prop}_${lang}`;
  if (recipeTranslationCache[cacheKey]) return recipeTranslationCache[cacheKey];

  const translated = await translateText(enValue, 'en', lang);
  recipeTranslationCache[cacheKey] = translated;
  return translated;
}

function recipePropSync(recipe, prop) {
  if (lang === 'he' || lang === 'en') {
    return recipe[`${prop}_${lang}`] || recipe[`${prop}_he`] || '';
  }
  const cacheKey = `${recipe.id}_${prop}_${lang}`;
  if (recipeTranslationCache[cacheKey]) return recipeTranslationCache[cacheKey];
  return recipe[`${prop}_en`] || recipe[`${prop}_he`] || '';
}

// === Unit Conversion ===
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'pcs'];

const conversions = {
  g: { to: 'oz', factor: 1 / 28.3495 },
  kg: { to: 'lbs', factor: 2.20462 },
  ml: { to: 'fl oz', factor: 1 / 29.5735 },
  L: { to: 'cups', factor: 4.22675 },
  oz: { to: 'g', factor: 28.3495 },
  lbs: { to: 'kg', factor: 1 / 2.20462 },
  'fl oz': { to: 'ml', factor: 29.5735 },
  cups: { to: 'L', factor: 1 / 4.22675 },
};

const metricUnits = new Set(['g', 'kg', 'ml', 'L']);
const imperialUnits = new Set(['oz', 'lbs', 'fl oz', 'cups']);

function convertIngredient(ingr, toSystem) {
  if (!ingr.qty || !ingr.unit) return ingr;
  const unit = ingr.unit;
  if (toSystem === 'imperial' && metricUnits.has(unit)) {
    const conv = conversions[unit];
    if (conv) return { ...ingr, qty: Math.round(ingr.qty * conv.factor * 100) / 100, unit: conv.to };
  } else if (toSystem === 'metric' && imperialUnits.has(unit)) {
    const conv = conversions[unit];
    if (conv) return { ...ingr, qty: Math.round(ingr.qty * conv.factor * 100) / 100, unit: conv.to };
  }
  return ingr;
}

function formatQty(qty) {
  if (qty == null || qty === 0) return '';
  if (qty % 1 === 0) return String(Math.round(qty));
  return String(Math.round(qty * 100) / 100);
}

function labelDisplay(label) {
  const name = labelName(label);
  return label.emoji ? `${label.emoji} ${name}` : name;
}

function labelName(label) {
  if (lang === 'he') return label.name_he;
  if (lang === 'en') return label.name_en;
  return label.name_en;
}

function formatRating(rating) {
  if (rating == null) return '';
  return rating % 1 === 0 ? String(Math.round(rating)) : String(rating);
}

// === Calorie Estimation ===
const CALORIE_TABLE = {
  flour: 364, sugar: 387, butter: 717, oil: 884, 'olive oil': 884, egg: 155, eggs: 155,
  milk: 42, cream: 340, 'heavy cream': 340, 'sour cream': 193, cheese: 402,
  'cream cheese': 342, rice: 130, pasta: 131, bread: 265, chicken: 239,
  beef: 250, pork: 242, salmon: 208, fish: 206, shrimp: 99, tofu: 76,
  potato: 77, potatoes: 77, tomato: 18, tomatoes: 18, onion: 40, onions: 40,
  garlic: 149, carrot: 41, carrots: 41, broccoli: 34, spinach: 23,
  avocado: 160, banana: 89, apple: 52, lemon: 29, honey: 304,
  chocolate: 546, cocoa: 228, 'cocoa powder': 228, nuts: 607, almonds: 579,
  walnuts: 654, peanuts: 567, 'peanut butter': 588, coconut: 354,
  'coconut milk': 230, 'coconut oil': 862, soy: 446, 'soy sauce': 53,
  vinegar: 18, mayonnaise: 680, ketchup: 112, mustard: 66,
  'קמח': 364, 'סוכר': 387, 'חמאה': 717, 'שמן': 884, 'ביצה': 155, 'ביצים': 155,
  'חלב': 42, 'שמנת': 340, 'גבינה': 402, 'אורז': 130, 'פסטה': 131,
  'עוף': 239, 'בקר': 250, 'סלמון': 208, 'דג': 206, 'טופו': 76,
  'תפוח אדמה': 77, 'עגבניה': 18, 'בצל': 40, 'שום': 149, 'גזר': 41,
  'אבוקדו': 160, 'בננה': 89, 'דבש': 304, 'שוקולד': 546,
};

function estimateCalories(ingredients) {
  let total = 0;
  let matched = 0;
  for (const ingr of ingredients) {
    const name = (ingr.name || '').toLowerCase().trim();
    let cal = null;
    for (const [key, kcal] of Object.entries(CALORIE_TABLE)) {
      if (name.includes(key)) { cal = kcal; break; }
    }
    if (cal == null) continue;
    matched++;
    let grams = 100;
    const qty = ingr.qty || 1;
    const unit = (ingr.unit || '').toLowerCase();
    if (unit === 'g') grams = qty;
    else if (unit === 'kg') grams = qty * 1000;
    else if (unit === 'ml' || unit === 'l') grams = unit === 'l' ? qty * 1000 : qty;
    else if (unit === 'cup') grams = qty * 240;
    else if (unit === 'tbsp') grams = qty * 15;
    else if (unit === 'tsp') grams = qty * 5;
    else if (unit === 'pcs') grams = qty * 100;
    else grams = qty * 100;
    total += (cal / 100) * grams;
  }
  if (matched === 0) return null;
  return Math.round(total);
}

// === API ===
async function fetchLabels() {
  const res = await fetch('/api/labels');
  labels = await res.json();
}

async function fetchRecipes() {
  const params = new URLSearchParams();

  if (selectedFilterLabels.size > 0) {
    params.set('labels', [...selectedFilterLabels].join(','));
  }

  if (triedOnly) {
    params.set('tried', 'true');
  }

  const searchText = document.getElementById('searchInput').value.trim();
  if (searchText) {
    const { detectedLabelIds, remainingTerms } = parseSearch(searchText);
    if (detectedLabelIds.length > 0) {
      const existing = params.get('labels');
      const merged = existing ? existing + ',' + detectedLabelIds.join(',') : detectedLabelIds.join(',');
      params.set('labels', merged);
    }
    if (remainingTerms.length > 0) {
      params.set('search', remainingTerms.join(' '));
    }
  }

  const res = await fetch('/api/recipes?' + params.toString());
  recipes = await res.json();
}

function parseSearch(text) {
  const detectedLabelIds = [];
  let remaining = text;

  const sortedLabels = [...labels].sort((a, b) => {
    const aLen = Math.max(a.name_he.length, a.name_en.length);
    const bLen = Math.max(b.name_he.length, b.name_en.length);
    return bLen - aLen;
  });

  for (const label of sortedLabels) {
    const nameHe = label.name_he;
    const nameEn = label.name_en.toLowerCase();

    if (remaining.includes(nameHe)) {
      detectedLabelIds.push(label.id);
      remaining = remaining.replace(nameHe, ' ').trim();
      continue;
    }

    const lowerRemaining = remaining.toLowerCase();
    const idx = lowerRemaining.indexOf(nameEn);
    if (idx !== -1) {
      detectedLabelIds.push(label.id);
      remaining = (remaining.substring(0, idx) + ' ' + remaining.substring(idx + nameEn.length)).trim();
      continue;
    }
  }

  const remainingTerms = remaining.split(/[\s,،]+/).map(t => t.trim()).filter(Boolean);
  return { detectedLabelIds, remainingTerms };
}

// === Translation ===
async function translateText(text, from, to) {
  if (!text || from === to) return text;
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from, to }),
    });
    const data = await res.json();
    return data.translated || text;
  } catch {
    return text;
  }
}

// === Language Detection ===
function detectInputLang(text) {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (['en', 'it', 'de', 'nl'].includes(lang)) return lang;
  return 'en';
}

// === Free Text Parser ===
function parseFreeText(text) {
  const lines = text.split('\n').map(l => l.trim());
  let title = '';
  let description = '';
  let ingredients = [];
  let instructions = '';
  let nutrition = {};
  let equipment = [];
  let prepTime = null;
  let cookTime = null;
  let servings = null;
  let course = '';
  let cuisine = '';

  const ingrHeaders = /^(ingredients|מרכיבים|חומרים|רכיבים|ingredienti|zutaten|ingrediënten|ингредиенты)\s*:?\s*$/i;
  const instrHeaders = /^(instructions|הוראות|אופן ההכנה|הכנה|directions|steps|שלבי הכנה|method|preparation|istruzioni|anleitung|zubereitung|instructies|bereiding|инструкции|приготовление)\s*:?\s*$/i;
  const nutritionHeaders = /^(nutrition|nutritional?\s*info|nutritional?\s*facts|ערכים תזונתיים|תזונה|nährwerte|voedingswaarden|valori nutrizionali|пищевая ценность)\s*:?\s*$/i;
  const equipmentHeaders = /^(equipment|tools|כלים|ציוד|ausstattung|benodigdheden|attrezzatura|оборудование)\s*:?\s*$/i;

  const looksLikeIngredient = (line) => {
    return /^[\d½¼¾⅓⅔⅛]/.test(line) || /^[\-–•·*]\s*\d/.test(line) || /^[\-–•·*]\s+/.test(line);
  };

  // Pre-scan for metadata lines
  const metaPatterns = {
    prepTime: /^(?:prep(?:aration)?\s*time|זמן הכנה|vorbereitungszeit|voorbereidingstijd|tempo di preparazione|время подготовки)\s*[:：]\s*(\d+)\s*(?:min|minutes|דקות|мин)?/i,
    cookTime: /^(?:cook(?:ing)?\s*time|זמן בישול|kochzeit|kooktijd|tempo di cottura|время приготовления)\s*[:：]\s*(\d+)\s*(?:min|minutes|דקות|мин)?/i,
    servings: /^(?:servings?|yield|מנות|portionen|porties|porzioni|порции)\s*[:：]\s*(\d+)/i,
    course: /^(?:course|category|קטגוריה|gang|categorie|portata|блюдо)\s*[:：]\s*(.+)/i,
    cuisine: /^(?:cuisine|מטבח|küche|keuken|cucina|кухня)\s*[:：]\s*(.+)/i,
  };

  const nutritionPatterns = {
    calories: /^(?:calories|קלוריות|kalorien|calorieën|calorie|калории)\s*[:：]\s*(.+)/i,
    protein: /^(?:protein|חלבון|eiweiß|eiwitten|proteine|белки)\s*[:：]\s*(.+)/i,
    carbs: /^(?:carb(?:ohydrate)?s?|פחמימות|kohlenhydrate|koolhydraten|carboidrati|углеводы)\s*[:：]\s*(.+)/i,
    fat: /^(?:(?:total\s+)?fat|שומן|fett|vet|grassi|жиры)\s*[:：]\s*(.+)/i,
    saturatedFat: /^(?:saturated\s+fat|שומן רווי|gesättigtes fett|verzadigd vet|grassi saturi|насыщенные жиры)\s*[:：]\s*(.+)/i,
    fiber: /^(?:fiber|fibre|סיבים|ballaststoffe|vezels|fibra|клетчатка)\s*[:：]\s*(.+)/i,
    sugar: /^(?:sugar|סוכר|zucker|suiker|zucchero|сахар)\s*[:：]\s*(.+)/i,
    sodium: /^(?:sodium|נתרן|natrium|sodio|натрий)\s*[:：]\s*(.+)/i,
  };

  let section = 'title';
  let foundTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (section === 'ingredients' && ingredients.length > 0) {
        const nextNonEmpty = lines.slice(i + 1).find(l => l.trim());
        if (nextNonEmpty && !looksLikeIngredient(nextNonEmpty) && !ingrHeaders.test(nextNonEmpty)) {
          section = 'instructions';
        }
      }
      continue;
    }

    // Check metadata patterns anywhere
    let metaMatched = false;
    for (const [key, pattern] of Object.entries(metaPatterns)) {
      const m = line.match(pattern);
      if (m) {
        if (key === 'prepTime') prepTime = parseInt(m[1]);
        else if (key === 'cookTime') cookTime = parseInt(m[1]);
        else if (key === 'servings') servings = parseInt(m[1]);
        else if (key === 'course') course = m[1].trim();
        else if (key === 'cuisine') cuisine = m[1].trim();
        metaMatched = true;
        break;
      }
    }
    if (metaMatched) continue;

    // Check nutrition patterns
    if (section === 'nutrition') {
      let nutMatched = false;
      for (const [key, pattern] of Object.entries(nutritionPatterns)) {
        const m = line.match(pattern);
        if (m) {
          nutrition[key] = m[1].trim();
          nutMatched = true;
          break;
        }
      }
      if (nutMatched) continue;
      // If no nutrition pattern matched and line isn't empty, switch section
      if (!nutritionHeaders.test(line)) {
        section = 'instructions';
      }
    }

    // Check for section headers
    if (ingrHeaders.test(line)) { section = 'ingredients'; continue; }
    if (instrHeaders.test(line)) { section = 'instructions'; continue; }
    if (nutritionHeaders.test(line)) { section = 'nutrition'; continue; }
    if (equipmentHeaders.test(line)) { section = 'equipment'; continue; }

    if (!foundTitle) {
      if (line.length < 100 && !looksLikeIngredient(line)) {
        title = line.replace(/^#+\s*/, '');
        foundTitle = true;
        section = 'description';
        continue;
      } else {
        foundTitle = true;
        section = 'ingredients';
      }
    }

    if (section === 'description') {
      if (looksLikeIngredient(line)) {
        section = 'ingredients';
      }
    }

    if (section === 'equipment') {
      const cleaned = line.replace(/^[\-–•·*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
      if (cleaned) equipment.push({ qty: 1, name: cleaned });
      continue;
    }

    if (section === 'ingredients') {
      if (/^(שלב|step)\s*\d/i.test(line) || (/^\d+[.)]\s/.test(line) && !looksLikeIngredient(line) && line.length > 60)) {
        section = 'instructions';
        instructions += line + '\n';
        continue;
      }
      const parsed = parseIngredientLine(line);
      ingredients.push(parsed);
    } else if (section === 'instructions') {
      instructions += line + '\n';
    } else if (section === 'description') {
      description += (description ? ' ' : '') + line;
    }
  }

  if (!title && ingredients.length > 0) {
    title = ingredients[0].name || 'Recipe';
  }

  return {
    title, description, ingredients, instructions: instructions.trim(),
    nutrition, equipment, prepTime, cookTime, servings, course, cuisine,
  };
}

function parseIngredientLine(line) {
  line = line.replace(/^[\-–•·*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();

  const match = line.match(/^([\d½¼¾⅓⅔⅛/.]+(?:\s*[\d½¼¾⅓⅔⅛/.]*)?)\s*(g|kg|ml|l|tsp|tbsp|cup|cups|oz|lbs|גרם|גר|קילו|מ"ל|כוס|כוסות|כף|כפות|כפית|כפיות|יחידות|יח')?\s*(.+)/i);

  if (match) {
    let qty = parseFraction(match[1]);
    let unit = normalizeUnit(match[2] || 'pcs');
    let name = match[3].trim();
    return { qty, unit, name };
  }

  return { qty: 0, unit: 'pcs', name: line };
}

function parseFraction(str) {
  str = str.trim();
  const fractions = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125 };
  if (fractions[str]) return fractions[str];

  for (const [frac, val] of Object.entries(fractions)) {
    if (str.includes(frac)) {
      const whole = parseFloat(str.replace(frac, '').trim()) || 0;
      return whole + val;
    }
  }

  if (str.includes('/')) {
    const [num, den] = str.split('/').map(Number);
    if (den) return num / den;
  }

  return parseFloat(str) || 0;
}

function normalizeUnit(unit) {
  if (!unit) return 'pcs';
  const u = unit.toLowerCase().trim();
  const map = {
    'g': 'g', 'gr': 'g', 'gram': 'g', 'grams': 'g', 'גרם': 'g', 'גר': 'g',
    'kg': 'kg', 'kilo': 'kg', 'קילו': 'kg',
    'ml': 'ml', 'מ"ל': 'ml',
    'l': 'L', 'liter': 'L', 'liters': 'L', 'ליטר': 'L',
    'tsp': 'tsp', 'teaspoon': 'tsp', 'כפית': 'tsp', 'כפיות': 'tsp',
    'tbsp': 'tbsp', 'tablespoon': 'tbsp', 'כף': 'tbsp', 'כפות': 'tbsp',
    'cup': 'cup', 'cups': 'cup', 'כוס': 'cup', 'כוסות': 'cup',
    'oz': 'oz', 'ounce': 'oz', 'ounces': 'oz',
    'lbs': 'lbs', 'lb': 'lbs', 'pound': 'lbs', 'pounds': 'lbs',
    'pcs': 'pcs', 'pc': 'pcs', 'piece': 'pcs', 'pieces': 'pcs', 'יחידות': 'pcs', "יח'": 'pcs',
  };
  return map[u] || 'pcs';
}

// === Render ===
function renderFilterLabels() {
  const container = document.getElementById('filterLabels');
  container.innerHTML = labels.map(l => `
    <span class="filter-label-chip ${selectedFilterLabels.has(l.id) ? 'active' : ''}" data-id="${l.id}">
      ${labelDisplay(l)}
    </span>
  `).join('');

  container.querySelectorAll('.filter-label-chip').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      if (selectedFilterLabels.has(id)) {
        selectedFilterLabels.delete(id);
      } else {
        selectedFilterLabels.add(id);
      }
      loadAndRender();
    });
  });
}

function renderRecipes() {
  const container = document.getElementById('recipeGrid');
  if (recipes.length === 0) {
    container.innerHTML = `<div class="empty-state">${t('empty')}</div>`;
    return;
  }

  container.innerHTML = recipes.map(r => `
    <div class="recipe-card" data-id="${r.id}">
      <div class="recipe-card-title">${recipePropSync(r, 'title')}</div>
      <div class="recipe-card-labels">
        ${(r.labels || []).map(l => `<span class="label-chip">${labelDisplay(l)}</span>`).join('')}
      </div>
      <div class="recipe-card-meta">
        <span class="${r.tried ? 'tried-badge' : 'not-tried-badge'}">
          ${r.tried ? t('tried') : t('notTried')}
        </span>
        ${r.tried && r.rating != null ? `<span class="rating-display">${formatRating(r.rating)}/10</span>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.recipe-card').forEach(el => {
    el.addEventListener('click', () => showDetail(Number(el.dataset.id)));
  });
}

async function showDetail(id) {
  const res = await fetch(`/api/recipes/${id}`);
  currentDetailRecipe = await res.json();
  detailUnitSystem = 'metric';
  await renderDetailContent();
  document.getElementById('detailModal').classList.remove('hidden');
}

async function renderDetailContent() {
  const recipe = currentDetailRecipe;
  if (!recipe) return;

  const content = document.getElementById('detailContent');

  const titleText = await getRecipeField(recipe, 'title');
  const descText = await getRecipeField(recipe, 'description');
  const instrText = await getRecipeField(recipe, 'instructions');

  const hasImage = recipe.image_url && recipe.image_url.trim();

  let ingredientsRaw;
  if (lang === 'he' || lang === 'en') {
    ingredientsRaw = recipe[`ingredients_${lang}`] || recipe.ingredients_he;
  } else {
    ingredientsRaw = recipe.ingredients_en || recipe.ingredients_he;
  }
  const ingredients = parseIngredients(ingredientsRaw);

  if (lang !== 'he' && lang !== 'en') {
    for (let i = 0; i < ingredients.length; i++) {
      const cacheKey = `${recipe.id}_ingr_${i}_${lang}`;
      if (recipeTranslationCache[cacheKey]) {
        ingredients[i].name = recipeTranslationCache[cacheKey];
      } else {
        const translated = await translateText(ingredients[i].name, 'en', lang);
        recipeTranslationCache[cacheKey] = translated;
        ingredients[i].name = translated;
      }
    }
  }

  // Parse nutrition & equipment
  let nutrition = {};
  try { nutrition = JSON.parse(recipe.nutrition || '{}'); } catch {}
  let equipmentArr = [];
  try { equipmentArr = JSON.parse(recipe.equipment || '[]'); } catch {}

  // Estimate calories if missing
  let estimatedCal = null;
  if (!nutrition.calories) {
    estimatedCal = estimateCalories(ingredients);
  }

  // Build metadata bar
  const metaItems = [];
  if (recipe.course) metaItems.push(`<div class="meta-item"><span class="meta-item-label">${t('course')}</span><span class="meta-item-value">${recipe.course}</span></div>`);
  if (recipe.cuisine) metaItems.push(`<div class="meta-item"><span class="meta-item-label">${t('cuisine')}</span><span class="meta-item-value">${recipe.cuisine}</span></div>`);
  if (recipe.prep_time) metaItems.push(`<div class="meta-item"><span class="meta-item-label">${t('prepTime')}</span><span class="meta-item-value">${recipe.prep_time} ${t('minutes')}</span></div>`);
  if (recipe.cook_time) metaItems.push(`<div class="meta-item"><span class="meta-item-label">${t('cookTime')}</span><span class="meta-item-value">${recipe.cook_time} ${t('minutes')}</span></div>`);
  if (recipe.servings) metaItems.push(`<div class="meta-item"><span class="meta-item-label">${t('servings')}</span><span class="meta-item-value">${recipe.servings}</span></div>`);
  const metadataHtml = metaItems.length > 0 ? `<div class="detail-metadata">${metaItems.join('')}</div>` : '';

  // Build equipment section
  let equipmentHtml = '';
  if (equipmentArr.length > 0) {
    equipmentHtml = `
      <h3 class="detail-section-title">${t('equipment')}</h3>
      <ul class="detail-equipment">
        ${equipmentArr.map(eq => `<li>${eq.qty > 1 ? `<span class="equip-qty">${eq.qty}x</span> ` : ''}${eq.name}</li>`).join('')}
      </ul>
    `;
  }

  // Build nutrition section
  let nutritionHtml = '';
  const nutKeys = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'fiber', 'sugar', 'sodium'];
  const hasNutrition = nutKeys.some(k => nutrition[k]);
  if (hasNutrition || estimatedCal) {
    let items = '';
    if (hasNutrition) {
      for (const k of nutKeys) {
        if (nutrition[k]) {
          items += `<div class="nutrition-item"><span class="nutrition-item-label">${t(k)}</span><span class="nutrition-item-value">${nutrition[k]}</span></div>`;
        }
      }
    } else if (estimatedCal) {
      items = `<div class="nutrition-item"><span class="nutrition-item-label">${t('estimatedCalories')}</span><span class="nutrition-item-value">~${estimatedCal} kcal</span></div>`;
    }
    nutritionHtml = `
      <h3 class="detail-section-title">${t('nutrition')}</h3>
      <div class="nutrition-detail">${items}</div>
    `;
  }

  content.innerHTML = `
    <div class="detail-title">${titleText}</div>
    ${hasImage ? `<img class="detail-image" src="${recipe.image_url}" alt="${titleText}">` : ''}
    ${descText ? `<p class="detail-description">${descText}</p>` : ''}
    ${metadataHtml}
    <div class="detail-labels">
      ${(recipe.labels || []).map(l => `<span class="label-chip">${labelDisplay(l)}</span>`).join('')}
    </div>
    <div class="detail-meta">
      <span class="${recipe.tried ? 'tried-badge' : 'not-tried-badge'}">
        ${recipe.tried ? t('tried') : t('notTried')}
      </span>
      ${recipe.tried && recipe.rating != null ? `<span class="rating-display">${formatRating(recipe.rating)}/10</span>` : ''}
    </div>
    <h3 class="detail-section-title">${t('ingredients')}</h3>
    <div class="unit-toggle">
      <button type="button" class="unit-toggle-btn ${detailUnitSystem === 'metric' ? 'active' : ''}" data-system="metric">${t('metric')}</button>
      <button type="button" class="unit-toggle-btn ${detailUnitSystem === 'imperial' ? 'active' : ''}" data-system="imperial">${t('imperial')}</button>
    </div>
    <ul class="detail-ingredients">
      ${ingredients.map(i => {
        const converted = convertIngredient(i, detailUnitSystem);
        const qtyStr = formatQty(converted.qty);
        const unitStr = converted.unit && converted.unit !== 'pcs' ? converted.unit : '';
        return `<li>${qtyStr ? `<span class="ingr-qty">${qtyStr}</span> ` : ''}${unitStr ? `<span class="ingr-unit">${unitStr}</span> ` : ''}${converted.name}</li>`;
      }).join('')}
    </ul>
    <h3 class="detail-section-title">${t('instructions')}</h3>
    <div class="detail-instructions">${instrText}</div>
    ${equipmentHtml}
    ${nutritionHtml}
    <div class="detail-actions">
      <button class="btn-edit" onclick="openEditForm(${recipe.id})">${t('edit')}</button>
      <button class="btn-delete" onclick="deleteRecipe(${recipe.id})">${t('delete')}</button>
    </div>
  `;

  content.querySelectorAll('.unit-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      detailUnitSystem = btn.dataset.system;
      renderDetailContent();
    });
  });
}

function parseIngredients(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.map(item => {
        if (typeof item === 'string') return { qty: 0, unit: 'pcs', name: item };
        return item;
      });
    }
  } catch {}
  return raw.split('\n').filter(Boolean).map(line => ({ qty: 0, unit: 'pcs', name: line }));
}

// === Form ===
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('freetextContent').classList.toggle('active', tab === 'freetext');
  document.getElementById('manualContent').classList.toggle('active', tab === 'manual');
}

function addIngredientRow(ingr) {
  formIngredients.push(ingr || { qty: 0, unit: 'pcs', name: '' });
  renderIngredientRows();
}

function removeIngredientRow(idx) {
  formIngredients.splice(idx, 1);
  renderIngredientRows();
}

function renderIngredientRows() {
  const container = document.getElementById('ingredientsList');
  container.innerHTML = formIngredients.map((ingr, idx) => `
    <div class="ingredient-row" data-idx="${idx}">
      <input type="number" value="${ingr.qty || ''}" step="any" min="0" placeholder="0" data-field="qty">
      <select data-field="unit">
        ${UNIT_OPTIONS.map(u => `<option value="${u}" ${ingr.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
      </select>
      <input type="text" value="${ingr.name}" placeholder="${t('ingredientName')}" data-field="name">
      <button type="button" class="remove-ingr" onclick="removeIngredientRow(${idx})">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('.ingredient-row').forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        formIngredients[idx][field] = field === 'qty' ? (parseFloat(input.value) || 0) : input.value;
      });
      input.addEventListener('change', () => {
        const field = input.dataset.field;
        formIngredients[idx][field] = field === 'qty' ? (parseFloat(input.value) || 0) : input.value;
      });
    });
  });
}

// Equipment form rows
function addEquipmentRow(eq) {
  formEquipment.push(eq || { qty: 1, name: '' });
  renderEquipmentRows();
}

function removeEquipmentRow(idx) {
  formEquipment.splice(idx, 1);
  renderEquipmentRows();
}

function renderEquipmentRows() {
  const container = document.getElementById('equipmentList');
  container.innerHTML = formEquipment.map((eq, idx) => `
    <div class="equipment-row" data-idx="${idx}">
      <input type="number" value="${eq.qty || 1}" min="1" data-field="qty" style="width:60px">
      <input type="text" value="${eq.name}" placeholder="${t('equipment')}" data-field="name">
      <button type="button" class="remove-ingr" onclick="removeEquipmentRow(${idx})">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('.equipment-row').forEach(row => {
    const idx = Number(row.dataset.idx);
    row.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', () => {
        const field = input.dataset.field;
        formEquipment[idx][field] = field === 'qty' ? (parseInt(input.value) || 1) : input.value;
      });
      input.addEventListener('change', () => {
        const field = input.dataset.field;
        formEquipment[idx][field] = field === 'qty' ? (parseInt(input.value) || 1) : input.value;
      });
    });
  });
}

function clearFormFields() {
  document.getElementById('formRecipeId').value = '';
  document.getElementById('formFreetext').value = '';
  document.getElementById('formTitle_input').value = '';
  document.getElementById('formDesc').value = '';
  document.getElementById('formInstructions').value = '';
  document.getElementById('formImageUrl').value = '';
  document.getElementById('formTried').checked = false;
  document.getElementById('formRating').value = '';
  document.getElementById('formCourse').value = '';
  document.getElementById('formCuisine').value = '';
  document.getElementById('formPrepTime').value = '';
  document.getElementById('formCookTime').value = '';
  document.getElementById('formServings').value = '';
  document.getElementById('imagePreview').classList.add('hidden');
  // Clear nutrition fields
  ['nutCalories', 'nutProtein', 'nutCarbs', 'nutFat', 'nutSatFat', 'nutFiber', 'nutSugar', 'nutSodium'].forEach(id => {
    document.getElementById(id).value = '';
  });
  // Collapse nutrition
  document.getElementById('nutritionFields').classList.add('hidden');
  document.getElementById('nutritionChevron').style.transform = '';
}

function openAddForm() {
  clearFormFields();
  document.getElementById('formTitle').textContent = t('formTitleNew');
  formIngredients = [];
  renderIngredientRows();
  formEquipment = [];
  renderEquipmentRows();
  selectedFormLabels = new Set();
  renderFormLabels();
  updateRatingState();
  switchTab('freetext');
  document.getElementById('formModal').classList.remove('hidden');
}

async function openEditForm(id) {
  document.getElementById('detailModal').classList.add('hidden');
  const res = await fetch(`/api/recipes/${id}`);
  const recipe = await res.json();

  clearFormFields();
  document.getElementById('formRecipeId').value = recipe.id;

  let titleVal, descVal, instrVal, ingrRaw;
  if (lang === 'he' || lang === 'en') {
    titleVal = recipe[`title_${lang}`] || '';
    descVal = recipe[`description_${lang}`] || '';
    instrVal = recipe[`instructions_${lang}`] || '';
    ingrRaw = recipe[`ingredients_${lang}`] || '[]';
  } else {
    titleVal = await getRecipeField(recipe, 'title');
    descVal = await getRecipeField(recipe, 'description');
    instrVal = await getRecipeField(recipe, 'instructions');
    ingrRaw = recipe.ingredients_en || recipe.ingredients_he || '[]';
  }

  document.getElementById('formTitle_input').value = titleVal;
  document.getElementById('formDesc').value = descVal;
  document.getElementById('formInstructions').value = instrVal;
  document.getElementById('formImageUrl').value = recipe.image_url || '';
  document.getElementById('formCourse').value = recipe.course || '';
  document.getElementById('formCuisine').value = recipe.cuisine || '';
  document.getElementById('formPrepTime').value = recipe.prep_time || '';
  document.getElementById('formCookTime').value = recipe.cook_time || '';
  document.getElementById('formServings').value = recipe.servings || '';

  if (recipe.image_url) {
    document.getElementById('previewImg').src = recipe.image_url;
    document.getElementById('imagePreview').classList.remove('hidden');
  }

  // Nutrition
  let nutrition = {};
  try { nutrition = JSON.parse(recipe.nutrition || '{}'); } catch {}
  document.getElementById('nutCalories').value = nutrition.calories || '';
  document.getElementById('nutProtein').value = nutrition.protein || '';
  document.getElementById('nutCarbs').value = nutrition.carbs || '';
  document.getElementById('nutFat').value = nutrition.fat || '';
  document.getElementById('nutSatFat').value = nutrition.saturatedFat || '';
  document.getElementById('nutFiber').value = nutrition.fiber || '';
  document.getElementById('nutSugar').value = nutrition.sugar || '';
  document.getElementById('nutSodium').value = nutrition.sodium || '';

  // Equipment
  let equipmentArr = [];
  try { equipmentArr = JSON.parse(recipe.equipment || '[]'); } catch {}
  formEquipment = equipmentArr.length > 0 ? equipmentArr : [];
  renderEquipmentRows();

  document.getElementById('formTried').checked = !!recipe.tried;
  document.getElementById('formRating').value = recipe.rating != null ? recipe.rating : '';
  document.getElementById('formTitle').textContent = t('formTitleEdit');

  formIngredients = parseIngredients(ingrRaw);
  if (lang !== 'he' && lang !== 'en') {
    for (let i = 0; i < formIngredients.length; i++) {
      formIngredients[i].name = await translateText(formIngredients[i].name, 'en', lang);
    }
  }
  renderIngredientRows();

  selectedFormLabels = new Set((recipe.labels || []).map(l => l.id));
  renderFormLabels();
  updateRatingState();
  switchTab('manual');
  document.getElementById('formModal').classList.remove('hidden');
}

function renderFormLabels() {
  const container = document.getElementById('formLabels');
  container.innerHTML = labels.map(l => `
    <span class="form-label-chip ${selectedFormLabels.has(l.id) ? 'selected' : ''}" data-id="${l.id}">
      ${labelDisplay(l)}
    </span>
  `).join('');

  container.querySelectorAll('.form-label-chip').forEach(el => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.id);
      if (selectedFormLabels.has(id)) {
        selectedFormLabels.delete(id);
      } else {
        selectedFormLabels.add(id);
      }
      renderFormLabels();
    });
  });
}

function updateRatingState() {
  const tried = document.getElementById('formTried').checked;
  const ratingGroup = document.getElementById('ratingGroup');
  if (tried) {
    ratingGroup.classList.remove('disabled');
  } else {
    ratingGroup.classList.add('disabled');
  }
}

function gatherNutrition() {
  const obj = {};
  const fields = [
    ['nutCalories', 'calories'], ['nutProtein', 'protein'], ['nutCarbs', 'carbs'],
    ['nutFat', 'fat'], ['nutSatFat', 'saturatedFat'], ['nutFiber', 'fiber'],
    ['nutSugar', 'sugar'], ['nutSodium', 'sodium'],
  ];
  for (const [elId, key] of fields) {
    const val = document.getElementById(elId).value.trim();
    if (val) obj[key] = val;
  }
  return obj;
}

function gatherEquipment() {
  return formEquipment.filter(eq => eq.name.trim()).map(eq => ({ qty: eq.qty || 1, name: eq.name.trim() }));
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('formRecipeId').value;
  const tried = document.getElementById('formTried').checked;
  const ratingVal = document.getElementById('formRating').value;
  const imageUrl = document.getElementById('formImageUrl').value;

  let title, description, ingredients, instructions;
  let parsedNutrition = {}, parsedEquipment = [];
  let parsedPrepTime = null, parsedCookTime = null, parsedServings = null;
  let parsedCourse = '', parsedCuisine = '';

  if (currentTab === 'freetext') {
    const freetext = document.getElementById('formFreetext').value.trim();
    if (!freetext) {
      alert(t('freetextPlaceholder').split(' - ')[0] || 'Please enter recipe text');
      return;
    }
    const parsed = parseFreeText(freetext);
    title = parsed.title;
    description = parsed.description;
    ingredients = parsed.ingredients;
    instructions = parsed.instructions;
    parsedNutrition = parsed.nutrition || {};
    parsedEquipment = parsed.equipment || [];
    parsedPrepTime = parsed.prepTime;
    parsedCookTime = parsed.cookTime;
    parsedServings = parsed.servings;
    parsedCourse = parsed.course || '';
    parsedCuisine = parsed.cuisine || '';

    // Validate: must have at least title or ingredients
    if (!title && ingredients.length === 0) {
      alert('Could not parse recipe. Please check the format.');
      return;
    }
  } else {
    title = document.getElementById('formTitle_input').value.trim();
    description = document.getElementById('formDesc').value.trim();
    instructions = document.getElementById('formInstructions').value.trim();
    ingredients = formIngredients.filter(i => i.name.trim());
    parsedNutrition = gatherNutrition();
    parsedEquipment = gatherEquipment();
    parsedPrepTime = parseInt(document.getElementById('formPrepTime').value) || null;
    parsedCookTime = parseInt(document.getElementById('formCookTime').value) || null;
    parsedServings = parseInt(document.getElementById('formServings').value) || null;
    parsedCourse = document.getElementById('formCourse').value.trim();
    parsedCuisine = document.getElementById('formCuisine').value.trim();

    if (!title) {
      alert(t('titleLabel'));
      return;
    }
    if (ingredients.length === 0) {
      alert(t('ingredientsLabel'));
      return;
    }
    if (!instructions) {
      alert(t('instructionsLabel'));
      return;
    }
  }

  const submitBtn = document.getElementById('formSubmitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = t('translating');
  submitBtn.disabled = true;

  try {
    const inputLang = detectInputLang(title + ' ' + instructions);

    let titleHe, titleEn, descHe, descEn, instrHe, instrEn, ingrHe, ingrEn;

    if (inputLang === 'he') {
      titleHe = title;
      descHe = description;
      instrHe = instructions;
      ingrHe = ingredients;
      [titleEn, descEn, instrEn] = await Promise.all([
        translateText(title, 'he', 'en'),
        description ? translateText(description, 'he', 'en') : Promise.resolve(''),
        instructions ? translateText(instructions, 'he', 'en') : Promise.resolve(''),
      ]);
      ingrEn = await Promise.all(ingredients.map(async (ingr) => ({
        ...ingr, name: await translateText(ingr.name, 'he', 'en')
      })));
    } else if (inputLang === 'en') {
      titleEn = title;
      descEn = description;
      instrEn = instructions;
      ingrEn = ingredients;
      [titleHe, descHe, instrHe] = await Promise.all([
        translateText(title, 'en', 'he'),
        description ? translateText(description, 'en', 'he') : Promise.resolve(''),
        instructions ? translateText(instructions, 'en', 'he') : Promise.resolve(''),
      ]);
      ingrHe = await Promise.all(ingredients.map(async (ingr) => ({
        ...ingr, name: await translateText(ingr.name, 'en', 'he')
      })));
    } else {
      [titleEn, descEn, instrEn] = await Promise.all([
        translateText(title, inputLang, 'en'),
        description ? translateText(description, inputLang, 'en') : Promise.resolve(''),
        instructions ? translateText(instructions, inputLang, 'en') : Promise.resolve(''),
      ]);
      ingrEn = await Promise.all(ingredients.map(async (ingr) => ({
        ...ingr, name: await translateText(ingr.name, inputLang, 'en')
      })));
      [titleHe, descHe, instrHe] = await Promise.all([
        translateText(title, inputLang, 'he'),
        description ? translateText(description, inputLang, 'he') : Promise.resolve(''),
        instructions ? translateText(instructions, inputLang, 'he') : Promise.resolve(''),
      ]);
      ingrHe = await Promise.all(ingredients.map(async (ingr) => ({
        ...ingr, name: await translateText(ingr.name, inputLang, 'he')
      })));
    }

    const body = {
      title_he: titleHe,
      title_en: titleEn,
      description_he: descHe,
      description_en: descEn,
      ingredients_he: JSON.stringify(ingrHe),
      ingredients_en: JSON.stringify(ingrEn),
      instructions_he: instrHe,
      instructions_en: instrEn,
      image_url: imageUrl,
      tried,
      rating: tried && ratingVal ? Number(ratingVal) : null,
      label_ids: [...selectedFormLabels],
      nutrition: JSON.stringify(parsedNutrition),
      equipment: JSON.stringify(parsedEquipment),
      prep_time: parsedPrepTime,
      cook_time: parsedCookTime,
      servings: parsedServings,
      course: parsedCourse,
      cuisine: parsedCuisine,
    };

    let apiRes;
    if (id) {
      apiRes = await fetch(`/api/recipes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      apiRes = await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    if (!apiRes.ok) {
      const errData = await apiRes.json().catch(() => ({}));
      alert(errData.error || 'Failed to save recipe');
      return;
    }

    document.getElementById('formModal').classList.add('hidden');
    await loadAndRender();
  } catch (err) {
    console.error('Save error:', err);
    alert('Error saving recipe: ' + err.message);
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

async function deleteRecipe(id) {
  if (!confirm(t('deleteConfirm'))) return;
  await fetch(`/api/recipes/${id}`, { method: 'DELETE' });
  document.getElementById('detailModal').classList.add('hidden');
  await loadAndRender();
}

async function addNewLabel() {
  const input = document.getElementById('newLabelInput');
  const name = input.value.trim();
  if (!name) return;

  const inputLang = detectInputLang(name);
  let nameHe, nameEn;

  if (inputLang === 'he') {
    nameHe = name;
    nameEn = await translateText(name, 'he', 'en');
  } else if (inputLang === 'en') {
    nameEn = name;
    nameHe = await translateText(name, 'en', 'he');
  } else {
    nameEn = await translateText(name, inputLang, 'en');
    nameHe = await translateText(name, inputLang, 'he');
  }

  const res = await fetch('/api/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name_he: nameHe, name_en: nameEn }),
  });
  const newLabel = await res.json();
  labels.push(newLabel);
  selectedFormLabels.add(newLabel.id);

  input.value = '';
  renderFormLabels();
  renderFilterLabels();
}

// === Image Upload ===
async function handleImageUpload(file) {
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url) {
      document.getElementById('formImageUrl').value = data.url;
      document.getElementById('previewImg').src = data.url;
      document.getElementById('imagePreview').classList.remove('hidden');
    }
  } catch (err) {
    console.error('Upload failed:', err);
  }
}

// === Language ===
async function changeLanguage(newLang) {
  lang = newLang;
  setCookie('lang', lang, 365);
  const dir = getLangDir(lang);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  await loadTranslations(lang);
  updateUIText();
  renderFilterLabels();

  // Pre-translate all recipe titles BEFORE rendering cards
  if (lang !== 'he' && lang !== 'en') {
    await Promise.all(recipes.map(r => getRecipeField(r, 'title')));
  }

  renderRecipes();
}

function updateUIText() {
  document.getElementById('appTitle').textContent = t('title');
  document.getElementById('searchInput').placeholder = t('searchPlaceholder');
  document.getElementById('recipesTitle').textContent = t('recipesTitle');
  document.getElementById('triedLabel').textContent = t('triedLabel');
  document.getElementById('formTitle').textContent = document.getElementById('formRecipeId').value ? t('formTitleEdit') : t('formTitleNew');
  document.getElementById('tabFreetext').textContent = t('freetext');
  document.getElementById('tabManual').textContent = t('manual');
  document.getElementById('labelFreetext').innerHTML = `${t('freetextLabel')} <span class="required-mark">*</span>`;
  document.getElementById('formFreetext').placeholder = t('freetextPlaceholder');
  document.getElementById('labelTitle').innerHTML = `${t('titleLabel')} <span class="required-mark">*</span>`;
  document.getElementById('labelDesc').textContent = t('descLabel');
  document.getElementById('labelIngredients').innerHTML = `${t('ingredientsLabel')} <span class="required-mark">*</span>`;
  document.getElementById('labelInstructions').innerHTML = `${t('instructionsLabel')} <span class="required-mark">*</span>`;
  document.getElementById('labelImageUrl').textContent = t('imageLabel');
  document.getElementById('formImageUrl').placeholder = t('imagePlaceholder');
  document.getElementById('browseText').textContent = t('browse');
  document.getElementById('labelLabels').textContent = t('labels');
  document.getElementById('labelTried').textContent = t('triedCheck');
  document.getElementById('labelRating').textContent = t('rating');
  document.getElementById('formSubmitBtn').textContent = t('save');
  document.getElementById('addIngredientBtn').textContent = t('addIngredient');
  document.getElementById('newLabelInput').placeholder = t('newLabelPlaceholder');
  // New fields
  document.getElementById('labelCourse').textContent = t('course');
  document.getElementById('labelCuisine').textContent = t('cuisine');
  document.getElementById('labelPrepTime').textContent = t('prepTime') + ' (' + t('minutes') + ')';
  document.getElementById('labelCookTime').textContent = t('cookTime') + ' (' + t('minutes') + ')';
  document.getElementById('labelServings').textContent = t('servings');
  document.getElementById('labelEquipment').textContent = t('equipment');
  document.getElementById('labelNutrition').textContent = t('nutrition');
  document.getElementById('addEquipmentBtn').textContent = '+ ' + t('equipment');
}

// === Load & Render ===
async function loadAndRender() {
  await fetchRecipes();

  // Pre-translate titles for non-HE/EN languages before rendering
  if (lang !== 'he' && lang !== 'en') {
    await Promise.all(recipes.map(r => getRecipeField(r, 'title')));
  }

  renderRecipes();
  renderFilterLabels();
}

// === Init ===
async function init() {
  // Read language from cookie
  const savedLang = getCookie('lang');
  if (savedLang && LANGUAGES.find(l => l.code === savedLang)) {
    lang = savedLang;
    document.getElementById('langSelect').value = lang;
    const dir = getLangDir(lang);
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', lang);
  }

  await loadTranslations(lang);
  updateUIText();
  await fetchLabels();
  await loadAndRender();

  // Event listeners
  document.getElementById('langSelect').addEventListener('change', (e) => {
    changeLanguage(e.target.value);
  });
  document.getElementById('addRecipeBtn').addEventListener('click', openAddForm);
  document.getElementById('recipeForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('addLabelBtn').addEventListener('click', addNewLabel);
  document.getElementById('formTried').addEventListener('change', updateRatingState);
  document.getElementById('addIngredientBtn').addEventListener('click', () => addIngredientRow());
  document.getElementById('addEquipmentBtn').addEventListener('click', () => addEquipmentRow());

  // Nutrition toggle
  document.getElementById('nutritionToggle').addEventListener('click', () => {
    const fields = document.getElementById('nutritionFields');
    const chevron = document.getElementById('nutritionChevron');
    fields.classList.toggle('hidden');
    chevron.style.transform = fields.classList.contains('hidden') ? '' : 'rotate(180deg)';
  });

  // Tab switching
  document.querySelectorAll('.form-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Filter toggle with chevron rotation
  document.getElementById('filterToggleBtn').addEventListener('click', () => {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('filterToggleBtn');
    panel.classList.toggle('hidden');
    btn.classList.toggle('open');
  });

  document.getElementById('triedToggle').addEventListener('change', (e) => {
    triedOnly = e.target.checked;
    loadAndRender();
  });

  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadAndRender(), 300);
  });

  // Image upload
  document.getElementById('formImageFile').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleImageUpload(e.target.files[0]);
    }
  });

  document.getElementById('removePreview').addEventListener('click', () => {
    document.getElementById('formImageUrl').value = '';
    document.getElementById('imagePreview').classList.add('hidden');
    document.getElementById('formImageFile').value = '';
  });

  // Close modals
  document.getElementById('detailClose').addEventListener('click', () => {
    document.getElementById('detailModal').classList.add('hidden');
  });
  document.getElementById('formClose').addEventListener('click', () => {
    document.getElementById('formModal').classList.add('hidden');
  });
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('detailModal').classList.add('hidden');
  });
  document.getElementById('formModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('formModal').classList.add('hidden');
  });
}

// Make functions available globally for onclick handlers
window.openEditForm = openEditForm;
window.deleteRecipe = deleteRecipe;
window.removeIngredientRow = removeIngredientRow;
window.removeEquipmentRow = removeEquipmentRow;

init();
