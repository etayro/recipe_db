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

// === Unit Conversion ===
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'L', 'tsp', 'tbsp', 'cup', 'pcs'];

const conversions = {
  // metric -> imperial
  g: { to: 'oz', factor: 1 / 28.3495 },
  kg: { to: 'lbs', factor: 2.20462 },
  ml: { to: 'fl oz', factor: 1 / 29.5735 },
  L: { to: 'cups', factor: 4.22675 },
  // imperial -> metric
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
    if (conv) {
      const newQty = Math.round(ingr.qty * conv.factor * 100) / 100;
      return { ...ingr, qty: newQty, unit: conv.to };
    }
  } else if (toSystem === 'metric' && imperialUnits.has(unit)) {
    const conv = conversions[unit];
    if (conv) {
      const newQty = Math.round(ingr.qty * conv.factor * 100) / 100;
      return { ...ingr, qty: newQty, unit: conv.to };
    }
  }
  return ingr;
}

function formatQty(qty) {
  if (qty == null || qty === 0) return '';
  if (qty % 1 === 0) return String(Math.round(qty));
  return String(Math.round(qty * 100) / 100);
}

// === UI Text ===
const uiText = {
  he: {
    title: 'המטבח של הפוכים',
    langBtn: 'EN',
    searchPlaceholder: 'חפש מתכונים, תוויות או מרכיבים...',
    recipesTitle: 'מתכונים',
    triedLabel: 'הצג רק מנוסים',
    tried: 'נוסה ✓',
    notTried: 'לא נוסה',
    formTitleNew: 'מתכון חדש',
    formTitleEdit: 'עריכת מתכון',
    freetext: 'טקסט חופשי',
    manual: 'ידני',
    freetextLabel: 'הדביקו מתכון כאן',
    freetextPlaceholder: 'הדביקו מתכון מלא כאן - הכותרת, המרכיבים והוראות ההכנה יזוהו אוטומטית...',
    titleLabel: 'שם המתכון',
    descLabel: 'תיאור',
    ingredientsLabel: 'מרכיבים',
    instructionsLabel: 'הוראות הכנה',
    imageLabel: 'תמונה',
    imagePlaceholder: 'קישור לתמונה...',
    browse: 'עיון',
    labels: 'תוויות',
    triedCheck: 'ניסינו',
    rating: 'דירוג (1-10)',
    save: 'שמור',
    edit: 'עריכה',
    delete: 'מחיקה',
    deleteConfirm: 'בטוח למחוק את המתכון?',
    ingredients: 'מרכיבים',
    instructions: 'הוראות הכנה',
    empty: 'לא נמצאו מתכונים',
    addIngredient: '+ הוסף מרכיב',
    ingredientName: 'שם מרכיב',
    newLabelHePlaceholder: 'תווית חדשה בעברית',
    newLabelEnPlaceholder: 'New label in English',
    metric: 'מטרי',
    imperial: 'אימפריאלי',
    translating: 'מתרגם...',
  },
  en: {
    title: "Hafuchim's Kitchen",
    langBtn: 'עב',
    searchPlaceholder: 'Search recipes, labels or ingredients...',
    recipesTitle: 'Recipes',
    triedLabel: 'Show only tried',
    tried: 'Tried ✓',
    notTried: 'Not tried',
    formTitleNew: 'New Recipe',
    formTitleEdit: 'Edit Recipe',
    freetext: 'Free Text',
    manual: 'Manual',
    freetextLabel: 'Paste recipe here',
    freetextPlaceholder: 'Paste a full recipe here - title, ingredients and instructions will be detected automatically...',
    titleLabel: 'Recipe name',
    descLabel: 'Description',
    ingredientsLabel: 'Ingredients',
    instructionsLabel: 'Instructions',
    imageLabel: 'Image',
    imagePlaceholder: 'Image URL...',
    browse: 'Browse',
    labels: 'Labels',
    triedCheck: 'Tried',
    rating: 'Rating (1-10)',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirm: 'Are you sure you want to delete this recipe?',
    ingredients: 'Ingredients',
    instructions: 'Instructions',
    empty: 'No recipes found',
    addIngredient: '+ Add ingredient',
    ingredientName: 'Ingredient name',
    newLabelHePlaceholder: 'תווית חדשה בעברית',
    newLabelEnPlaceholder: 'New label in English',
    metric: 'Metric',
    imperial: 'Imperial',
    translating: 'Translating...',
  }
};

function t(key) {
  return uiText[lang][key] || key;
}

function labelDisplay(label) {
  const name = lang === 'he' ? label.name_he : label.name_en;
  return label.emoji ? `${label.emoji} ${name}` : name;
}

function labelName(label) {
  return lang === 'he' ? label.name_he : label.name_en;
}

function recipeProp(recipe, prop) {
  return recipe[`${prop}_${lang}`] || recipe[`${prop}_he`] || '';
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

  // Smart search with fuzzy support
  const searchText = document.getElementById('searchInput').value.trim();
  if (searchText) {
    const { detectedLabelIds, remainingTerms } = parseSearch(searchText);
    if (detectedLabelIds.length > 0) {
      const existing = params.get('labels');
      const merged = existing ? existing + ',' + detectedLabelIds.join(',') : detectedLabelIds.join(',');
      params.set('labels', merged);
    }
    // Send all terms as search (backend does fuzzy matching now)
    if (remainingTerms.length > 0) {
      params.set('search', remainingTerms.join(' '));
    }
  }

  const res = await fetch('/api/recipes?' + params.toString());
  recipes = await res.json();
}

function parseSearch(text) {
  // Split by commas, spaces, or mixed
  const tokens = text.split(/[\s,،]+/).map(t => t.trim()).filter(Boolean);
  const detectedLabelIds = [];
  const remainingTerms = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    // Check exact label match (name only, not emoji)
    const matchedLabel = labels.find(l =>
      l.name_he === token ||
      l.name_en.toLowerCase() === lower
    );
    if (matchedLabel) {
      detectedLabelIds.push(matchedLabel.id);
    } else {
      remainingTerms.push(token);
    }
  }

  return { detectedLabelIds, remainingTerms };
}

// === Translation ===
async function translateText(text, from, to) {
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

// === Free Text Parser ===
function parseFreeText(text) {
  const lines = text.split('\n').map(l => l.trim());
  let title = '';
  let description = '';
  let ingredients = [];
  let instructions = '';

  const ingrHeaders = /^(ingredients|מרכיבים|חומרים|רכיבים)/i;
  const instrHeaders = /^(instructions|הוראות|אופן ההכנה|הכנה|directions|steps|שלבי הכנה|method|preparation)/i;
  const sectionHeader = /^(.+):\s*$/;

  let section = 'title'; // title -> description -> ingredients -> instructions
  let foundTitle = false;

  for (const line of lines) {
    if (!line) continue;

    // Check for section headers
    if (ingrHeaders.test(line) || (sectionHeader.test(line) && ingrHeaders.test(line.replace(':', '')))) {
      section = 'ingredients';
      continue;
    }
    if (instrHeaders.test(line) || (sectionHeader.test(line) && instrHeaders.test(line.replace(':', '')))) {
      section = 'instructions';
      continue;
    }

    if (!foundTitle) {
      title = line;
      foundTitle = true;
      section = 'description';
      continue;
    }

    if (section === 'description') {
      // Check if this looks like an ingredient line (starts with number or bullet)
      if (/^[\d½¼¾⅓⅔⅛•\-–]/.test(line) || /^\d/.test(line)) {
        section = 'ingredients';
      }
    }

    if (section === 'ingredients') {
      // Check if we've hit instructions (numbered steps like "1.", prose paragraphs)
      if (/^(שלב|step)\s*\d/i.test(line)) {
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

  return {
    title,
    description,
    ingredients,
    instructions: instructions.trim(),
  };
}

function parseIngredientLine(line) {
  // Remove leading bullets, dashes, numbers with dots/parentheses
  line = line.replace(/^[\-–•·*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();

  // Try to extract quantity and unit
  // Patterns: "200g flour", "200 g flour", "2 cups milk", "½ tsp salt", "3 ביצים"
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

  // Handle "1 ½" or "1½"
  for (const [frac, val] of Object.entries(fractions)) {
    if (str.includes(frac)) {
      const whole = parseFloat(str.replace(frac, '').trim()) || 0;
      return whole + val;
    }
  }

  // Handle "1/2"
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
      <div class="recipe-card-title">${recipeProp(r, 'title')}</div>
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
  renderDetailContent();
  document.getElementById('detailModal').classList.remove('hidden');
}

function renderDetailContent() {
  const recipe = currentDetailRecipe;
  if (!recipe) return;

  const content = document.getElementById('detailContent');
  const hasImage = recipe.image_url && recipe.image_url.trim();
  const ingredients = parseIngredients(recipeProp(recipe, 'ingredients'));

  content.innerHTML = `
    <div class="detail-title">${recipeProp(recipe, 'title')}</div>
    ${hasImage ? `<img class="detail-image" src="${recipe.image_url}" alt="${recipeProp(recipe, 'title')}">` : ''}
    ${recipeProp(recipe, 'description') ? `<p class="detail-description">${recipeProp(recipe, 'description')}</p>` : ''}
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
    <div class="detail-instructions">${recipeProp(recipe, 'instructions')}</div>
    <div class="detail-actions">
      <button class="btn-edit" onclick="openEditForm(${recipe.id})">${t('edit')}</button>
      <button class="btn-delete" onclick="deleteRecipe(${recipe.id})">${t('delete')}</button>
    </div>
  `;

  // Unit toggle listeners
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

  // Sync changes back to formIngredients
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

  // Fill manual fields in current language
  document.getElementById('formTitle_input').value = recipeProp(recipe, 'title');
  document.getElementById('formDesc').value = recipeProp(recipe, 'description');
  document.getElementById('formInstructions').value = recipeProp(recipe, 'instructions');
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

  formIngredients = parseIngredients(recipeProp(recipe, 'ingredients'));
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
      alert(lang === 'he' ? 'יש להזין טקסט מתכון' : 'Please enter recipe text');
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
      alert(lang === 'he' ? 'יש להזין שם מתכון' : 'Please enter a recipe name');
      return;
    }
    if (ingredients.length === 0) {
      alert(lang === 'he' ? 'יש להזין מרכיבים' : 'Please add ingredients');
      return;
    }
    if (!instructions) {
      alert(lang === 'he' ? 'יש להזין הוראות הכנה' : 'Please enter instructions');
      return;
    }
  }

  // Show saving state
  const submitBtn = document.getElementById('formSubmitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = t('translating');
  submitBtn.disabled = true;

  try {
    // Translate to the other language
    const fromLang = lang === 'he' ? 'he' : 'en';
    const toLang = lang === 'he' ? 'en' : 'he';

    const [translatedTitle, translatedDesc, translatedInstr] = await Promise.all([
      translateText(title, fromLang, toLang),
      description ? translateText(description, fromLang, toLang) : Promise.resolve(''),
      instructions ? translateText(instructions, fromLang, toLang) : Promise.resolve(''),
    ]);

    // Translate ingredient names
    const translatedIngredients = await Promise.all(
      ingredients.map(async (ingr) => {
        const translatedName = await translateText(ingr.name, fromLang, toLang);
        return { ...ingr, name: translatedName };
      })
    );

    const body = {
      title_he: lang === 'he' ? title : translatedTitle,
      title_en: lang === 'en' ? title : translatedTitle,
      description_he: lang === 'he' ? description : translatedDesc,
      description_en: lang === 'en' ? description : translatedDesc,
      ingredients_he: JSON.stringify(lang === 'he' ? ingredients : translatedIngredients),
      ingredients_en: JSON.stringify(lang === 'en' ? ingredients : translatedIngredients),
      instructions_he: lang === 'he' ? instructions : translatedInstr,
      instructions_en: lang === 'en' ? instructions : translatedInstr,
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
  const heInput = document.getElementById('newLabelHe');
  const enInput = document.getElementById('newLabelEn');
  const he = heInput.value.trim();
  const en = enInput.value.trim();
  if (!he || !en) return;

  const res = await fetch('/api/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name_he: he, name_en: en }),
  });
  const newLabel = await res.json();
  labels.push(newLabel);
  selectedFormLabels.add(newLabel.id);

  heInput.value = '';
  enInput.value = '';
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
function toggleLanguage() {
  lang = lang === 'he' ? 'en' : 'he';
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  updateUIText();
  renderFilterLabels();
  renderRecipes();
}

function updateUIText() {
  document.getElementById('appTitle').textContent = t('title');
  document.getElementById('langToggle').textContent = t('langBtn');
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
  document.getElementById('newLabelHe').placeholder = t('newLabelHePlaceholder');
  document.getElementById('newLabelEn').placeholder = t('newLabelEnPlaceholder');
}

// === Load & Render ===
async function loadAndRender() {
  await fetchRecipes();
  renderRecipes();
  renderFilterLabels();
}

// === Init ===
async function init() {
  await fetchLabels();
  await loadAndRender();

  // Event listeners
  document.getElementById('langToggle').addEventListener('click', toggleLanguage);
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
