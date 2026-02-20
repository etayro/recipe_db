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
    // Fallback to English
    if (langCode !== 'en') await loadTranslations('en');
  }
}

function t(key) {
  return currentTranslations[key] || key;
}

// === On-the-fly recipe translation cache ===
// Key: `${recipeId}_${field}_${lang}`, Value: translated string
const recipeTranslationCache = {};

async function getRecipeField(recipe, prop) {
  // HE and EN are stored in DB directly
  if (lang === 'he' || lang === 'en') {
    return recipe[`${prop}_${lang}`] || recipe[`${prop}_he`] || '';
  }
  // For other languages, translate from EN on the fly
  const enValue = recipe[`${prop}_en`] || recipe[`${prop}_he`] || '';
  if (!enValue) return '';

  const cacheKey = `${recipe.id}_${prop}_${lang}`;
  if (recipeTranslationCache[cacheKey]) return recipeTranslationCache[cacheKey];

  const translated = await translateText(enValue, 'en', lang);
  recipeTranslationCache[cacheKey] = translated;
  return translated;
}

// Sync version for cards (uses cached or falls back to EN)
function recipePropSync(recipe, prop) {
  if (lang === 'he' || lang === 'en') {
    return recipe[`${prop}_${lang}`] || recipe[`${prop}_he`] || '';
  }
  const cacheKey = `${recipe.id}_${prop}_${lang}`;
  if (recipeTranslationCache[cacheKey]) return recipeTranslationCache[cacheKey];
  // Fallback to English while async translation loads
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
  // For other languages, return EN (labels are short, no on-the-fly translate)
  return label.name_en;
}

function formatRating(rating) {
  if (rating == null) return '';
  return rating % 1 === 0 ? String(Math.round(rating)) : String(rating);
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

  // Sort labels by name length descending (greedy match longest first)
  const sortedLabels = [...labels].sort((a, b) => {
    const aLen = Math.max(a.name_he.length, a.name_en.length);
    const bLen = Math.max(b.name_he.length, b.name_en.length);
    return bLen - aLen;
  });

  // Try to match multi-word label names in the search text
  for (const label of sortedLabels) {
    const nameHe = label.name_he;
    const nameEn = label.name_en.toLowerCase();

    // Check Hebrew name
    if (remaining.includes(nameHe)) {
      detectedLabelIds.push(label.id);
      remaining = remaining.replace(nameHe, ' ').trim();
      continue;
    }

    // Check English name (case-insensitive)
    const lowerRemaining = remaining.toLowerCase();
    const idx = lowerRemaining.indexOf(nameEn);
    if (idx !== -1) {
      detectedLabelIds.push(label.id);
      remaining = (remaining.substring(0, idx) + ' ' + remaining.substring(idx + nameEn.length)).trim();
      continue;
    }
  }

  // Tokenize whatever is left
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
  // Check for Hebrew characters
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  // Check for Russian/Cyrillic
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // Default to current lang if it uses Latin script, otherwise English
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

  const ingrHeaders = /^(ingredients|מרכיבים|חומרים|רכיבים|ingredienti|zutaten|ingrediënten|ингредиенты)\s*:?\s*$/i;
  const instrHeaders = /^(instructions|הוראות|אופן ההכנה|הכנה|directions|steps|שלבי הכנה|method|preparation|istruzioni|anleitung|zubereitung|instructies|bereiding|инструкции|приготовление)\s*:?\s*$/i;

  // Detect if a line looks like an ingredient (has quantity/unit/bullet)
  const looksLikeIngredient = (line) => {
    return /^[\d½¼¾⅓⅔⅛]/.test(line) || /^[\-–•·*]\s*\d/.test(line) || /^[\-–•·*]\s+/.test(line);
  };

  let section = 'title';
  let foundTitle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      // Blank line after ingredients could signal instructions
      if (section === 'ingredients' && ingredients.length > 0) {
        // Look ahead: if next non-empty line doesn't look like an ingredient, switch to instructions
        const nextNonEmpty = lines.slice(i + 1).find(l => l.trim());
        if (nextNonEmpty && !looksLikeIngredient(nextNonEmpty) && !ingrHeaders.test(nextNonEmpty)) {
          section = 'instructions';
        }
      }
      continue;
    }

    // Check for section headers
    if (ingrHeaders.test(line)) {
      section = 'ingredients';
      continue;
    }
    if (instrHeaders.test(line)) {
      section = 'instructions';
      continue;
    }

    if (!foundTitle) {
      // First line is title if it's short and doesn't have quantities
      if (line.length < 100 && !looksLikeIngredient(line)) {
        title = line.replace(/^#+\s*/, ''); // Strip markdown headings
        foundTitle = true;
        section = 'description';
        continue;
      } else {
        // First line looks like an ingredient, skip title
        foundTitle = true;
        section = 'ingredients';
      }
    }

    if (section === 'description') {
      // If this line looks like an ingredient, transition
      if (looksLikeIngredient(line)) {
        section = 'ingredients';
      }
    }

    if (section === 'ingredients') {
      // If line looks like a numbered instruction step (not an ingredient), switch
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

  // If no title was found, generate from first ingredient or content
  if (!title && ingredients.length > 0) {
    title = ingredients[0].name || 'Recipe';
  }

  return {
    title,
    description,
    ingredients,
    instructions: instructions.trim(),
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

  // For non-HE/EN, trigger async translation of card titles
  if (lang !== 'he' && lang !== 'en') {
    translateRecipeCards();
  }
}

async function translateRecipeCards() {
  const cards = document.querySelectorAll('.recipe-card');
  for (const card of cards) {
    const id = Number(card.dataset.id);
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;
    const translated = await getRecipeField(recipe, 'title');
    const titleEl = card.querySelector('.recipe-card-title');
    if (titleEl) titleEl.textContent = translated;
  }
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

  // Get translated fields
  const titleText = await getRecipeField(recipe, 'title');
  const descText = await getRecipeField(recipe, 'description');
  const instrText = await getRecipeField(recipe, 'instructions');

  const hasImage = recipe.image_url && recipe.image_url.trim();

  // For ingredients, use stored JSON for HE/EN, translate for others
  let ingredientsRaw;
  if (lang === 'he' || lang === 'en') {
    ingredientsRaw = recipe[`ingredients_${lang}`] || recipe.ingredients_he;
  } else {
    ingredientsRaw = recipe.ingredients_en || recipe.ingredients_he;
  }
  const ingredients = parseIngredients(ingredientsRaw);

  // Translate ingredient names for non-HE/EN
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

  content.innerHTML = `
    <div class="detail-title">${titleText}</div>
    ${hasImage ? `<img class="detail-image" src="${recipe.image_url}" alt="${titleText}">` : ''}
    ${descText ? `<p class="detail-description">${descText}</p>` : ''}
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

function openAddForm() {
  document.getElementById('formRecipeId').value = '';
  document.getElementById('formFreetext').value = '';
  document.getElementById('formTitle_input').value = '';
  document.getElementById('formDesc').value = '';
  document.getElementById('formInstructions').value = '';
  document.getElementById('formImageUrl').value = '';
  document.getElementById('formTried').checked = false;
  document.getElementById('formRating').value = '';
  document.getElementById('formTitle').textContent = t('formTitleNew');
  document.getElementById('imagePreview').classList.add('hidden');
  formIngredients = [];
  renderIngredientRows();
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

  document.getElementById('formRecipeId').value = recipe.id;
  document.getElementById('formFreetext').value = '';

  // Fill manual fields — use HE/EN directly, for other languages translate
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

  if (recipe.image_url) {
    document.getElementById('previewImg').src = recipe.image_url;
    document.getElementById('imagePreview').classList.remove('hidden');
  } else {
    document.getElementById('imagePreview').classList.add('hidden');
  }

  document.getElementById('formTried').checked = !!recipe.tried;
  document.getElementById('formRating').value = recipe.rating != null ? recipe.rating : '';
  document.getElementById('formTitle').textContent = t('formTitleEdit');

  formIngredients = parseIngredients(ingrRaw);
  // Translate ingredient names for non-HE/EN
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

async function handleFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('formRecipeId').value;
  const tried = document.getElementById('formTried').checked;
  const ratingVal = document.getElementById('formRating').value;
  const imageUrl = document.getElementById('formImageUrl').value;

  let title, description, ingredients, instructions;

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
  } else {
    title = document.getElementById('formTitle_input').value.trim();
    description = document.getElementById('formDesc').value.trim();
    instructions = document.getElementById('formInstructions').value.trim();
    ingredients = formIngredients.filter(i => i.name.trim());

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
    // Detect the language of the input text
    const inputLang = detectInputLang(title + ' ' + instructions);

    // We need to produce HE and EN versions for the DB
    let titleHe, titleEn, descHe, descEn, instrHe, instrEn, ingrHe, ingrEn;

    if (inputLang === 'he') {
      titleHe = title;
      descHe = description;
      instrHe = instructions;
      ingrHe = ingredients;
      // Translate to EN
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
      // Translate to HE
      [titleHe, descHe, instrHe] = await Promise.all([
        translateText(title, 'en', 'he'),
        description ? translateText(description, 'en', 'he') : Promise.resolve(''),
        instructions ? translateText(instructions, 'en', 'he') : Promise.resolve(''),
      ]);
      ingrHe = await Promise.all(ingredients.map(async (ingr) => ({
        ...ingr, name: await translateText(ingr.name, 'en', 'he')
      })));
    } else {
      // Input is in another language (it, ru, de, nl)
      // Translate to both EN and HE
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
    };

    if (id) {
      await fetch(`/api/recipes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } else {
      await fetch('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }

    document.getElementById('formModal').classList.add('hidden');
    await loadAndRender();
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

  // Detect input language and translate to HE and EN
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
  const dir = getLangDir(lang);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  await loadTranslations(lang);
  updateUIText();
  renderFilterLabels();
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
}

// === Load & Render ===
async function loadAndRender() {
  await fetchRecipes();
  renderRecipes();
  renderFilterLabels();
}

// === Init ===
async function init() {
  await loadTranslations(lang);
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

init();
